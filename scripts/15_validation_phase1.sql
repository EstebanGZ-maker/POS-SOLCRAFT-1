-- =============================================================================
-- 15_validation_phase1.sql — Validación de la Fase 1 en el branch.
--
-- Requisitos previos:
--   * scripts/15_credit_sales_phase1.sql ya aplicado.
--   * Existe al menos una sede y una bodega en el branch (los seeds del
--     branch de Supabase suelen tener ambos).
--
-- Este script:
--   1. Verifica invariantes: verify_credit_integrity() y
--      verify_kardex_integrity() deben retornar 0 filas.
--   2. Paridad get_shift_balance ↔ close_shift sobre datos sintéticos con
--      mezcla de ventas cash / no-cash / a cuenta / anuladas.
--   3. Assert Caso A cross-turno: la venta contado anulada en turno T2
--      genera cash_movement refund en T2 y no altera el snapshot de T1.
--   4. Assert Caso B: venta fiado con abono cash anulada NO baja el arqueo
--      y emite customer_credits.
--
-- Todo corre en una transacción con ROLLBACK al final: no persiste nada.
-- Cualquier assertion fallida ROLLBACK vía RAISE EXCEPTION.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Invariantes globales
-- ---------------------------------------------------------------------------

-- Se capturan snapshots de invariantes; luego el escenario debe cerrar con
-- delta 0 respecto al snapshot. verify_kardex puede reportar filas
-- pre-existentes por el seed demo (product_stock sin stock_movements) — eso
-- no es defecto de Fase 1, y se filtra por delta.
CREATE TEMP TABLE _snap_invariants AS
SELECT (SELECT COUNT(*) FROM verify_credit_integrity()) AS credit_pre,
       (SELECT COUNT(*) FROM verify_kardex_integrity()) AS kardex_pre;

DO $$
DECLARE v_bad_credit INT; v_pre_credit INT;
BEGIN
    SELECT COUNT(*) INTO v_bad_credit FROM verify_credit_integrity();
    SELECT credit_pre INTO v_pre_credit FROM _snap_invariants;
    IF v_bad_credit <> 0 THEN
        RAISE EXCEPTION 'verify_credit_integrity() base = %, debía ser 0 (sin sales previas).', v_bad_credit;
    END IF;
    RAISE NOTICE 'ℹ verify_kardex_integrity() base = % (pre-existente del seed demo, se comparará por delta).',
                 (SELECT kardex_pre FROM _snap_invariants);
    RAISE NOTICE '✓ verify_credit_integrity() base = 0.';
END $$;

-- ---------------------------------------------------------------------------
-- 2..4. Escenario sintético — usamos SET LOCAL ROLE para simular usuario
--
-- OJO: estas RPCs son SECURITY DEFINER + auth.uid(). En un branch nuevo sin
-- JWT real, auth.uid() devuelve NULL y las RPC abortan. Para probar
-- end-to-end desde SQL puro necesitamos bypassar el chequeo de auth
-- llamando a las funciones desde una función-helper que ejecute como
-- superusuario y setee session vars, O bien probar la lógica de cálculo
-- llamando get_shift_balance con datos insertados vía INSERT directo.
--
-- Estrategia elegida: probamos la MATEMÁTICA del cálculo (get_shift_balance
-- vs close_shift devuelven el mismo expected_cash sobre el mismo dataset)
-- vía INSERT directo saltándonos las RPC transaccionales. El E2E de las RPC
-- con auth va en Playwright (paso separado en Fase 1).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_admin  UUID;
    v_site   UUID;
    v_wh     UUID;
    v_cust   UUID;
    v_shift1 UUID; v_shift2 UUID;
    v_sale_cash UUID; v_sale_card UUID; v_sale_credit UUID; v_sale_void UUID;
    v_bal_json JSONB;
    v_bal_expected NUMERIC;
    v_close_expected NUMERIC;
BEGIN
    -- Bootstrap del contexto de auth para que auth.uid() no sea NULL en las
    -- SECDEF. Requerimos un admin en user_profiles.
    SELECT id INTO v_admin FROM user_profiles WHERE role = 'admin' LIMIT 1;
    IF v_admin IS NULL THEN
        RAISE EXCEPTION 'No hay admin en user_profiles — validación imposible.';
    END IF;
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

    -- Tomamos la primera sede y bodega existentes en el branch.
    SELECT site_id INTO v_site FROM sites LIMIT 1;
    IF v_site IS NULL THEN
        RAISE EXCEPTION 'No hay sedes en el branch — no se puede validar.';
    END IF;
    SELECT warehouse_id INTO v_wh FROM warehouses WHERE site_id = v_site LIMIT 1;
    SELECT customer_id INTO v_cust FROM customers WHERE is_walk_in = FALSE
      AND allows_credit = TRUE LIMIT 1;
    IF v_cust IS NULL THEN
        INSERT INTO customers (name, phone, allows_credit)
        VALUES ('Cliente Validación 15', '3001112222', TRUE)
        RETURNING customer_id INTO v_cust;
    END IF;

    -- Cerrar temporalmente cualquier turno abierto para no chocar con el
    -- unique index one_open_shift_per_site en la validación.
    UPDATE pos_shifts SET status='closed', closed_at=NOW()
     WHERE site_id = v_site AND status='open';

    -- Turno 1
    INSERT INTO pos_shifts (site_id, warehouse_id, initial_cash, opened_by, status)
    VALUES (v_site, v_wh, 100000, 'validation', 'open')
    RETURNING shift_id INTO v_shift1;

    -- Venta contado cash: 50k
    INSERT INTO sales (customer_id, total_amount, payment_method, site_id,
                       warehouse_id, shift_id, is_on_account, amount_paid, status)
    VALUES (v_cust, 50000, 'Efectivo', v_site, v_wh, v_shift1, FALSE, 50000, 'active')
    RETURNING sale_id INTO v_sale_cash;
    INSERT INTO sale_payments (sale_id, amount, payment_method, shift_id, site_id, notes)
    VALUES (v_sale_cash, 50000, 'Efectivo', v_shift1, v_site, 'validation');

    -- Venta contado tarjeta: 80k (payment_method='Crédito Visa' — D8: no debe
    -- clasificarse como cash a pesar del texto "crédito")
    INSERT INTO sales (customer_id, total_amount, payment_method, site_id,
                       warehouse_id, shift_id, is_on_account, amount_paid, status)
    VALUES (v_cust, 80000, 'Crédito Visa', v_site, v_wh, v_shift1, FALSE, 80000, 'active')
    RETURNING sale_id INTO v_sale_card;
    INSERT INTO sale_payments (sale_id, amount, payment_method, shift_id, site_id, notes)
    VALUES (v_sale_card, 80000, 'Crédito Visa', v_shift1, v_site, 'validation');

    -- Venta fiado 100k con abono inicial 30k cash
    INSERT INTO sales (customer_id, total_amount, payment_method, site_id,
                       warehouse_id, shift_id, is_on_account, amount_paid, status)
    VALUES (v_cust, 100000, 'crédito', v_site, v_wh, v_shift1, TRUE, 30000, 'active')
    RETURNING sale_id INTO v_sale_credit;
    INSERT INTO sale_payments (sale_id, amount, payment_method, shift_id, site_id, notes)
    VALUES (v_sale_credit, 30000, 'Efectivo', v_shift1, v_site, 'abono inicial');

    -- Movimiento manual: expense 5k (gasto operativo)
    INSERT INTO cash_movements (shift_id, type, amount, description)
    VALUES (v_shift1, 'expense', 5000, 'validation gasto');

    -- === Test 1: get_shift_balance sobre T1 ===
    v_bal_json := get_shift_balance(v_shift1);
    v_bal_expected := (v_bal_json->>'expected_cash')::NUMERIC;

    -- Manual: 100000 + 50000 + 30000 + 0 - 5000 - 0 = 175000
    -- (la tarjeta va a non_cash_in_shift, no suma al expected)
    IF v_bal_expected <> 175000 THEN
        RAISE EXCEPTION 'get_shift_balance T1: esperado 175000, obtenido %', v_bal_expected;
    END IF;
    IF (v_bal_json->>'cash_in_shift')::NUMERIC <> 80000 THEN
        RAISE EXCEPTION 'cash_in_shift T1: esperado 80000 (50k+30k), obtenido %',
            (v_bal_json->>'cash_in_shift')::NUMERIC;
    END IF;
    IF (v_bal_json->>'non_cash_in_shift')::NUMERIC <> 80000 THEN
        RAISE EXCEPTION 'non_cash_in_shift T1: esperado 80000 (tarjeta), obtenido % (D8: payment_method label "crédito Visa" no debe clasificar como cash)',
            (v_bal_json->>'non_cash_in_shift')::NUMERIC;
    END IF;
    RAISE NOTICE '✓ get_shift_balance T1 = 175000 OK; D8 respetado.';

    -- === Test 2: paridad close_shift vs get_shift_balance ===
    -- close_shift consume el mismo cálculo internamente; el expected_cash
    -- que persiste debe coincidir 1:1 con el que devuelve get_shift_balance.
    v_close_expected := (close_shift(v_shift1, 175000, 'validation', 'test')->>'expected_cash')::NUMERIC;
    IF v_close_expected <> v_bal_expected THEN
        RAISE EXCEPTION 'Paridad rota: close_shift=% vs get_shift_balance=%',
            v_close_expected, v_bal_expected;
    END IF;
    RAISE NOTICE '✓ Paridad close_shift ↔ get_shift_balance OK (%)', v_close_expected;

    -- === Test 3: Caso A cross-turno ===
    -- Abrimos T2 y anulamos la venta cash de T1 desde T2.
    INSERT INTO pos_shifts (site_id, warehouse_id, initial_cash, opened_by, status)
    VALUES (v_site, v_wh, 50000, 'validation-t2', 'open')
    RETURNING shift_id INTO v_shift2;

    PERFORM void_sale(v_sale_cash);

    -- T1 ya cerrado: su expected_cash guardado no cambia
    IF (SELECT expected_cash FROM pos_shifts WHERE shift_id = v_shift1) <> 175000 THEN
        RAISE EXCEPTION 'Snapshot T1 cambió — no debía (D5)';
    END IF;

    -- T2: debe tener un cash_movement refund 50000
    IF NOT EXISTS (
        SELECT 1 FROM cash_movements
         WHERE shift_id = v_shift2 AND type='refund' AND amount = 50000
    ) THEN
        RAISE EXCEPTION 'Caso A cross-turno: no se registró refund en T2';
    END IF;

    -- sale_payments de la venta cash: siguen active (no se tocaron)
    IF NOT EXISTS (
        SELECT 1 FROM sale_payments
         WHERE sale_id = v_sale_cash AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caso A: sale_payments no debía marcarse voided';
    END IF;

    -- T2 balance: 50000 (initial) + 0 (nada de ventas) - 0 - 0 - 50000 (refund) = 0
    v_bal_json := get_shift_balance(v_shift2);
    IF (v_bal_json->>'expected_cash')::NUMERIC <> 0 THEN
        RAISE EXCEPTION 'T2 expected_cash: esperado 0, obtenido %',
            (v_bal_json->>'expected_cash')::NUMERIC;
    END IF;
    RAISE NOTICE '✓ Caso A cross-turno OK: T1 intacto, T2 refund aplicado.';

    -- === Test 4: Caso B (fiado anulado) NO baja arqueo, emite credit ===
    -- Anulamos la venta a cuenta (creada en T1) desde T2.
    -- Balance de T2 antes de la anulación
    v_bal_expected := (get_shift_balance(v_shift2)->>'expected_cash')::NUMERIC;

    PERFORM void_sale(v_sale_credit);

    -- Post-void: expected_cash de T2 no debe cambiar (Caso B no genera refund)
    IF (get_shift_balance(v_shift2)->>'expected_cash')::NUMERIC <> v_bal_expected THEN
        RAISE EXCEPTION 'Caso B: T2 expected_cash cambió por anular fiado (no debía)';
    END IF;

    -- sale_payments del fiado: siguen active (Caso B no los toca)
    IF NOT EXISTS (
        SELECT 1 FROM sale_payments
         WHERE sale_id = v_sale_credit AND status = 'active' AND amount = 30000
    ) THEN
        RAISE EXCEPTION 'Caso B: sale_payments del fiado no debía anularse';
    END IF;

    -- customer_credits emitido por 30000
    IF NOT EXISTS (
        SELECT 1 FROM customer_credits
         WHERE source_sale_id = v_sale_credit
           AND source_type = 'void_sale'
           AND amount = 30000
    ) THEN
        RAISE EXCEPTION 'Caso B: customer_credits no se emitió (30000)';
    END IF;

    -- Sin cash_movement refund por la anulación del fiado en T2
    IF EXISTS (
        SELECT 1 FROM cash_movements
         WHERE shift_id = v_shift2 AND type = 'refund' AND amount = 30000
    ) THEN
        RAISE EXCEPTION 'Caso B: se creó cash_movement refund, no debía';
    END IF;
    RAISE NOTICE '✓ Caso B OK: fiado anulado no mueve caja, emite credit.';

    -- === Test 5: Post-todo, invariantes delta 0 respecto al snapshot ===
    IF (SELECT COUNT(*) FROM verify_credit_integrity()) <> 0 THEN
        RAISE EXCEPTION 'verify_credit_integrity() falla tras el escenario (delta > 0).';
    END IF;
    DECLARE v_delta_kardex INT;
    BEGIN
      v_delta_kardex := (SELECT COUNT(*) FROM verify_kardex_integrity())
                     - (SELECT kardex_pre FROM _snap_invariants);
      IF v_delta_kardex <> 0 THEN
          RAISE EXCEPTION 'verify_kardex_integrity() delta = % (esperado 0). Fase 1 introdujo descuadre.', v_delta_kardex;
      END IF;
    END;
    RAISE NOTICE '✓ Invariantes OK post-escenario (credit=0, kardex delta=0).';

    RAISE NOTICE '================================================================';
    RAISE NOTICE 'FASE 1 VALIDACIÓN: OK (todos los assertions pasaron).';
    RAISE NOTICE '================================================================';
END $$;

ROLLBACK;
