-- =============================================================================
-- 17_validation_phase2.sql — Validación local de la Fase 2 de ajustes.
--
-- Requisitos previos (aplicados EN ORDEN sobre la DB local):
--   * scripts/16_inventory_adjustments_phase1.sql
--   * scripts/17a_adjustments_numeracion.sql
--   * scripts/17b_adjustments_wac.sql
--   * scripts/17c_adjustments_contabilidad.sql
--
-- Alcance de tests:
--   T1. Numeración secuencial por sede desde 1 (2A).
--   T2. WAC correcto tras 2 incrementos consecutivos del mismo producto (2B).
--   T3. WAC NO cambia al disminuir (D2).
--   T4. Asiento correcto por cada motivo (2C):
--       T4a. motivo='compra' → 1 expense "Compra de mercancía".
--       T4b. motivo='sobrante' → 1 income "Sobrante de inventario".
--       T4c. motivo='correccion' → sin asiento del bloque incrementos.
--       T4d. Disminuciones → 1 expense "Merma / Ajuste negativo" (independiente
--            del motivo).
--       T4e. Mixto (incrementos+disminuciones) → 2 asientos.
--   T5. Validaciones de motivo:
--       T5a. Ajuste con incrementos y motivo NULL → RAISE.
--       T5b. Ajuste 100% disminuciones y motivo NOT NULL → RAISE.
--       T5c. motivo='correccion' con notes vacío → RAISE.
--       T5d. motivo inválido → RAISE.
--   T6. void_adjustment compensa asientos pero NO revierte products.cost (D5).
--       Ejecuta verify_adjustment_accounting_integrity() → 0 filas.
--   T7. Numeración post-void: el siguiente ajuste tras un void mantiene el
--       counter avanzando (no se reutiliza el numero de un void).
--   T8. verify_kardex_integrity() delta = 0 tras todo el escenario.
--
-- Todo dentro de una transacción con ROLLBACK final. Nada persiste.
-- LOCAL ÚNICAMENTE. No aplicar a prod desde aquí.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _snap AS
SELECT (SELECT COUNT(*) FROM verify_kardex_integrity()) AS kardex_pre;

DO $$
DECLARE
    v_admin      UUID;
    v_site       UUID;
    v_wh         UUID;
    v_prod       UUID;
    v_prod2      UUID;
    v_adj_compra    UUID;
    v_adj_sobrante  UUID;
    v_adj_correc    UUID;
    v_adj_merma     UUID;
    v_adj_mixto     UUID;
    v_num_first  INTEGER;
    v_num_second INTEGER;
    v_cost_after INTEGER;
    v_num INTEGER;
    v_cost_before NUMERIC;
    v_ok BOOLEAN;
    v_expense_count INT;
    v_income_count  INT;
    v_bad INT;
BEGIN
    -- =========================================================================
    -- Bootstrap auth + seed
    -- =========================================================================
    INSERT INTO auth.users (id, email)
    VALUES ('22222222-0000-0000-0000-000000000001', 'admin+val17@test')
    ON CONFLICT (id) DO NOTHING;
    v_admin := '22222222-0000-0000-0000-000000000001';

    INSERT INTO sites (name, is_central) VALUES ('Sede Val17', FALSE)
      RETURNING site_id INTO v_site;

    INSERT INTO warehouses (site_id, name, is_primary) VALUES (v_site, 'Principal Val17', TRUE)
      RETURNING warehouse_id INTO v_wh;

    -- adjustment_counters para la sede nueva (17a puede haber quedado sin
    -- seed para esta sede si se creó DESPUÉS del apply de 17a — probamos
    -- que el on-the-fly INSERT del RPC funciona).
    -- No insertamos manualmente; que el RPC lo cree.

    INSERT INTO user_profiles (id, email, full_name, role, site_id)
    VALUES (v_admin, 'admin+val17@test', 'Admin V17', 'admin', NULL)
    ON CONFLICT (id) DO UPDATE SET role = 'admin';

    -- Productos con cost=1000 y stock inicial vía apertura kardex.
    INSERT INTO products (name, code, unit, cost, price, is_service, is_active, stock_quantity)
      VALUES ('Prod Val17 #1', 'V17-01', 'Unidad', 1000, 2000, FALSE, TRUE, 0)
      RETURNING product_id INTO v_prod;
    INSERT INTO products (name, code, unit, cost, price, is_service, is_active, stock_quantity)
      VALUES ('Prod Val17 #2', 'V17-02', 'Unidad', 500, 1200, FALSE, TRUE, 0)
      RETURNING product_id INTO v_prod2;

    PERFORM adjust_warehouse_stock(v_prod,  v_wh, 10, 'apertura', 'seed', NULL, v_admin, 'seed val17');
    PERFORM adjust_warehouse_stock(v_prod2, v_wh, 20, 'apertura', 'seed', NULL, v_admin, 'seed val17');

    -- Contexto auth admin.
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM set_config('request.jwt.claims',
             jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

    -- =========================================================================
    -- T1 — Numeración secuencial desde 1
    -- =========================================================================
    v_adj_compra := create_adjustment(
        v_wh, 'test T1 compra 1',
        jsonb_build_array(jsonb_build_object(
          'product_id', v_prod, 'cost', 2000, 'objective', 'incrementar', 'quantity', 5)),
        'compra'
    );
    SELECT numero INTO v_num_first FROM inventory_adjustments WHERE adjustment_id = v_adj_compra;
    IF v_num_first <> 1 THEN
        RAISE EXCEPTION 'T1: primer numero = %, se esperaba 1', v_num_first;
    END IF;

    v_adj_sobrante := create_adjustment(
        v_wh, 'test T1 sobrante 1',
        jsonb_build_array(jsonb_build_object(
          'product_id', v_prod2, 'cost', 500, 'objective', 'incrementar', 'quantity', 3)),
        'sobrante'
    );
    SELECT numero INTO v_num_second FROM inventory_adjustments WHERE adjustment_id = v_adj_sobrante;
    IF v_num_second <> 2 THEN
        RAISE EXCEPTION 'T1: segundo numero = %, se esperaba 2', v_num_second;
    END IF;
    RAISE NOTICE '✓ T1 OK: numeración 1,2 secuencial por sede.';

    -- =========================================================================
    -- T2 — WAC tras 2 incrementos consecutivos del mismo producto
    -- Estado: v_prod tiene stock=15 (10 seed + 5 T1), cost=(10*1000 + 5*2000)/15 = 1333.33
    -- =========================================================================
    SELECT cost INTO v_cost_before FROM products WHERE product_id = v_prod;
    IF ROUND(v_cost_before, 2) <> ROUND(15000.0/15, 2) THEN
        RAISE EXCEPTION 'T2 setup: WAC v_prod post-T1 = %, se esperaba %', v_cost_before, ROUND(15000.0/15, 2);
    END IF;

    -- Segundo incremento: 5 unidades a cost=3000. WAC nuevo:
    -- (15 * 1333.33 + 5 * 3000) / 20 = (20000 + 15000) / 20 = 1750
    PERFORM create_adjustment(
        v_wh, 'test T2 segundo incremento',
        jsonb_build_array(jsonb_build_object(
          'product_id', v_prod, 'cost', 3000, 'objective', 'incrementar', 'quantity', 5)),
        'compra'
    );
    SELECT cost INTO v_cost_before FROM products WHERE product_id = v_prod;
    IF ROUND(v_cost_before, 0) <> 1750 THEN
        RAISE EXCEPTION 'T2: WAC v_prod = %, se esperaba 1750', v_cost_before;
    END IF;
    RAISE NOTICE '✓ T2 OK: WAC recalculado (15*1333.33+5*3000)/20=1750.';

    -- =========================================================================
    -- T3 — WAC NO cambia al disminuir (D2)
    -- Estado: v_prod stock=20 cost=1750
    -- Disminución de 3 unidades → stock=17, cost DEBE seguir en 1750
    -- =========================================================================
    PERFORM create_adjustment(
        v_wh, 'test T3 merma',
        jsonb_build_array(jsonb_build_object(
          'product_id', v_prod, 'cost', 1750, 'objective', 'disminuir', 'quantity', 3)),
        NULL   -- 100% disminuciones → motivo NULL
    );
    SELECT cost INTO v_cost_before FROM products WHERE product_id = v_prod;
    IF v_cost_before <> 1750 THEN
        RAISE EXCEPTION 'T3: WAC cambió al disminuir (= %), no debía', v_cost_before;
    END IF;
    RAISE NOTICE '✓ T3 OK: WAC intacto tras disminución.';

    -- =========================================================================
    -- T4a — motivo='compra' → 1 expense
    -- v_adj_compra ya se creó. Debe tener 1 asiento expense de amount=10000
    -- (5*2000). No debe tener income.
    -- =========================================================================
    SELECT COUNT(*) FILTER (WHERE entry_type='expense'),
           COUNT(*) FILTER (WHERE entry_type='income')
      INTO v_expense_count, v_income_count
      FROM accounting_entries WHERE adjustment_id = v_adj_compra;
    IF v_expense_count <> 1 OR v_income_count <> 0 THEN
        RAISE EXCEPTION 'T4a: compra debe tener 1 expense y 0 income (got %/%)', v_expense_count, v_income_count;
    END IF;
    IF (SELECT amount FROM accounting_entries
         WHERE adjustment_id = v_adj_compra AND entry_type='expense'
           AND category='Compra de mercancía') <> 10000 THEN
        RAISE EXCEPTION 'T4a: amount incorrecto';
    END IF;
    RAISE NOTICE '✓ T4a OK: compra → 1 expense "Compra de mercancía" amount=10000.';

    -- =========================================================================
    -- T4b — motivo='sobrante' → 1 income
    -- v_adj_sobrante: 3*500=1500 income
    -- =========================================================================
    SELECT COUNT(*) FILTER (WHERE entry_type='income'),
           COUNT(*) FILTER (WHERE entry_type='expense')
      INTO v_income_count, v_expense_count
      FROM accounting_entries WHERE adjustment_id = v_adj_sobrante;
    IF v_income_count <> 1 OR v_expense_count <> 0 THEN
        RAISE EXCEPTION 'T4b: sobrante debe tener 1 income y 0 expense (got %/%)', v_income_count, v_expense_count;
    END IF;
    IF (SELECT amount FROM accounting_entries
         WHERE adjustment_id = v_adj_sobrante AND entry_type='income'
           AND category='Sobrante de inventario') <> 1500 THEN
        RAISE EXCEPTION 'T4b: amount incorrecto';
    END IF;
    RAISE NOTICE '✓ T4b OK: sobrante → 1 income "Sobrante" amount=1500.';

    -- =========================================================================
    -- T4c — motivo='correccion' → sin asiento del bloque incrementos
    -- =========================================================================
    v_adj_correc := create_adjustment(
        v_wh, 'error de captura histórico',   -- notes obligatorio si correccion
        jsonb_build_array(jsonb_build_object(
          'product_id', v_prod2, 'cost', 500, 'objective', 'incrementar', 'quantity', 2)),
        'correccion'
    );
    IF EXISTS (SELECT 1 FROM accounting_entries WHERE adjustment_id = v_adj_correc) THEN
        RAISE EXCEPTION 'T4c: correccion NO debe generar asiento';
    END IF;
    RAISE NOTICE '✓ T4c OK: correccion → 0 asientos.';

    -- =========================================================================
    -- T4d — Disminuciones puras → 1 expense de merma (motivo=NULL)
    -- =========================================================================
    v_adj_merma := create_adjustment(
        v_wh, 'test T4d merma',
        jsonb_build_array(jsonb_build_object(
          'product_id', v_prod2, 'cost', 500, 'objective', 'disminuir', 'quantity', 2)),
        NULL
    );
    IF (SELECT COUNT(*) FROM accounting_entries WHERE adjustment_id = v_adj_merma
        AND entry_type='expense' AND category='Merma / Ajuste negativo') <> 1 THEN
        RAISE EXCEPTION 'T4d: merma → 1 expense esperado';
    END IF;
    IF (SELECT amount FROM accounting_entries WHERE adjustment_id = v_adj_merma) <> 1000 THEN
        RAISE EXCEPTION 'T4d: amount merma incorrecto';
    END IF;
    RAISE NOTICE '✓ T4d OK: 100%% disminución → 1 expense "Merma" amount=1000.';

    -- =========================================================================
    -- T4e — Mixto incrementos+disminuciones (motivo='compra') → 2 asientos
    -- =========================================================================
    v_adj_mixto := create_adjustment(
        v_wh, 'test T4e mixto',
        jsonb_build_array(
          jsonb_build_object('product_id', v_prod,  'cost', 1000, 'objective', 'incrementar', 'quantity', 2),
          jsonb_build_object('product_id', v_prod2, 'cost',  500, 'objective', 'disminuir',   'quantity', 1)
        ),
        'compra'
    );
    IF (SELECT COUNT(*) FROM accounting_entries WHERE adjustment_id = v_adj_mixto) <> 2 THEN
        RAISE EXCEPTION 'T4e: mixto debe tener 2 asientos';
    END IF;
    IF (SELECT COUNT(*) FROM accounting_entries WHERE adjustment_id = v_adj_mixto
        AND category='Compra de mercancía' AND amount=2000) <> 1 THEN
        RAISE EXCEPTION 'T4e: bloque incrementos (compra) faltante o mal';
    END IF;
    IF (SELECT COUNT(*) FROM accounting_entries WHERE adjustment_id = v_adj_mixto
        AND category='Merma / Ajuste negativo' AND amount=500) <> 1 THEN
        RAISE EXCEPTION 'T4e: bloque merma faltante o mal';
    END IF;
    RAISE NOTICE '✓ T4e OK: mixto → 2 asientos (compra 2000 + merma 500).';

    -- =========================================================================
    -- T5 — Validaciones RAISE
    -- =========================================================================
    -- T5a: incremento sin motivo
    v_ok := TRUE;
    BEGIN
      PERFORM create_adjustment(v_wh, 't5a',
        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'cost', 100, 'objective', 'incrementar', 'quantity', 1)),
        NULL);
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'T5a: incremento sin motivo debía abortar'; END IF;

    -- T5b: 100% disminuciones con motivo NOT NULL
    v_ok := TRUE;
    BEGIN
      PERFORM create_adjustment(v_wh, 't5b',
        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'cost', 100, 'objective', 'disminuir', 'quantity', 1)),
        'compra');
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'T5b: 100%% disminución con motivo debía abortar'; END IF;

    -- T5c: correccion sin notes
    v_ok := TRUE;
    BEGIN
      PERFORM create_adjustment(v_wh, '',
        jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'cost', 500, 'objective', 'incrementar', 'quantity', 1)),
        'correccion');
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'T5c: correccion sin notes debía abortar'; END IF;

    -- T5d: motivo inválido
    v_ok := TRUE;
    BEGIN
      PERFORM create_adjustment(v_wh, 't5d',
        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'cost', 100, 'objective', 'incrementar', 'quantity', 1)),
        'motivo_random');
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'T5d: motivo inválido debía abortar'; END IF;

    RAISE NOTICE '✓ T5 OK: 4 validaciones de motivo rechazan correctamente.';

    -- =========================================================================
    -- T6 — void_adjustment compensa asientos pero NO revierte WAC (D5)
    -- Anulamos v_adj_compra (5*2000=10000 expense original).
    -- Después: 2 asientos con adjustment_id = v_adj_compra, uno expense
    -- (original) + uno income (Reversión). Net = 0.
    -- products.cost NO debe reajustarse — sigue en 1750 (post-T2/T3).
    -- =========================================================================
    v_cost_before := (SELECT cost FROM products WHERE product_id = v_prod);

    PERFORM void_adjustment(v_adj_compra);

    IF (SELECT status FROM inventory_adjustments WHERE adjustment_id = v_adj_compra) <> 'voided' THEN
        RAISE EXCEPTION 'T6: status != voided';
    END IF;
    -- Debe haber 2 asientos ahora referenciados a v_adj_compra
    IF (SELECT COUNT(*) FROM accounting_entries WHERE adjustment_id = v_adj_compra) <> 2 THEN
        RAISE EXCEPTION 'T6: se esperaban 2 asientos post-void (original + reversión)';
    END IF;
    -- Uno debe ser 'Reversión Compra de mercancía' income
    IF (SELECT COUNT(*) FROM accounting_entries WHERE adjustment_id = v_adj_compra
        AND entry_type='income' AND category='Reversión Compra de mercancía' AND amount=10000) <> 1 THEN
        RAISE EXCEPTION 'T6: reversión income faltante';
    END IF;
    -- WAC NO cambió
    IF (SELECT cost FROM products WHERE product_id = v_prod) <> v_cost_before THEN
        RAISE EXCEPTION 'T6: products.cost cambió al voider (=%), NO debía (D5)',
                         (SELECT cost FROM products WHERE product_id = v_prod);
    END IF;
    -- verify_adjustment_accounting_integrity retorna 0 filas
    IF (SELECT COUNT(*) FROM verify_adjustment_accounting_integrity()) <> 0 THEN
        RAISE EXCEPTION 'T6: verify_adjustment_accounting_integrity reportó descuadre en voids';
    END IF;
    RAISE NOTICE '✓ T6 OK: void compensa asiento, WAC intacto, verify=0.';

    -- =========================================================================
    -- T7 — Numeración post-void avanza
    -- Después de crear 6 ajustes (compra, sobrante, T2-2nd, correc, merma,
    -- mixto), el próximo debería ser #7. Void de v_adj_compra no libera su
    -- numero.
    -- =========================================================================
    v_num := (SELECT last_numero FROM adjustment_counters WHERE site_id = v_site);
    IF v_num <> 6 THEN
        RAISE EXCEPTION 'T7: counter tras 6 ajustes = %, se esperaba 6', v_num;
    END IF;

    PERFORM create_adjustment(v_wh, 'test T7 next',
        jsonb_build_array(jsonb_build_object(
          'product_id', v_prod2, 'cost', 500, 'objective', 'incrementar', 'quantity', 1)),
        'compra');
    IF (SELECT last_numero FROM adjustment_counters WHERE site_id = v_site) <> 7 THEN
        RAISE EXCEPTION 'T7: counter tras 7mo ajuste != 7';
    END IF;
    RAISE NOTICE '✓ T7 OK: numeración post-void = 7 (void no libera numero).';

    -- =========================================================================
    -- T8 — Invariante kardex delta = 0
    -- =========================================================================
    v_bad := (SELECT COUNT(*) FROM verify_kardex_integrity())
           - (SELECT kardex_pre FROM _snap);
    IF v_bad <> 0 THEN
        RAISE EXCEPTION 'T8: verify_kardex_integrity delta = % (esperado 0)', v_bad;
    END IF;
    RAISE NOTICE '✓ T8 OK: invariante kardex intacta.';

    RAISE NOTICE '================================================================';
    RAISE NOTICE 'FASE 2 AJUSTES — VALIDACIÓN LOCAL: OK (T1..T8 pasaron).';
    RAISE NOTICE '⚠ compra→expense inmediato aún PENDIENTE OK CONTADOR.';
    RAISE NOTICE '================================================================';
END $$;

ROLLBACK;
