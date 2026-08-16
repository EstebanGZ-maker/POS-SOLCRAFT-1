-- =============================================================================
-- 18_credit_phase3.sql — Ventas a crédito, Fase 3 (CxC + abonos + redención).
--
-- Alcance (spec: docs/CREDIT-SALES-SPEC.md §4.2, §6.1, §8 Fase 3, §9 D9/D14):
--   1. register_payment(sale_id, amount, method, shift_id?, notes?) SECDEF.
--      Guard D9: método cash + shift_id NULL → RAISE. Lock FOR UPDATE de sale.
--      Asienta income 'Abono crédito'.
--   2. apply_customer_credit(sale_id, amount, shift_id?) SECDEF (Fase 3 spec).
--      Redención de saldo a favor. Lock FOR UPDATE de sale + de credits.
--      D14 bloqueante: asienta income 'Redención saldo a favor'.
--   3. create_sale v3 (endurecida): guard D9 server-side para cobro cash sin
--      turno; validación de p_shift_id (open + misma sede) cuando viene.
--      Hoy el guard vivía solo cliente-side (deuda Fase 2A). Cerrada aquí.
--
-- Sin cambios de esquema: sale_payments, customer_credits, sales.is_on_account,
-- sales.amount_paid, sales.balance_due, customers.allows_credit ya existen
-- desde Fase 1 (script 15).
--
-- Invariante preservado: verify_credit_integrity() = 0 filas post-apply y tras
-- cualquier operación de esta fase. Verify_kardex_integrity() sin cambio (los
-- RPCs de Fase 3 no tocan stock).
--
-- Idempotencia: todo es CREATE OR REPLACE; se puede re-aplicar.
--
-- Rollback: al pie del archivo (comentado). Restaura create_sale v2 desde
-- script 15; DROPs de register_payment / apply_customer_credit.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. register_payment — abonos posteriores a ventas a crédito
-- =============================================================================
--
-- Semántica:
--   - Lock FOR UPDATE de la venta (evita carrera entre dos abonos que sumen
--     más que balance_due).
--   - Valida: status='active', amount>0, amount<=balance_due.
--   - Guard D9: método ILIKE '%efectivo%|%cash%' AND shift_id NULL → RAISE.
--   - Si p_shift_id viene: valida status='open' + mismo site_id que la venta.
--   - received_by = user_profiles.full_name de auth.uid() (D11).
--   - INSERT sale_payments + UPDATE sales.amount_paid + INSERT accounting_entry
--     income 'Abono crédito' amount = p_amount.
--   - Retorna { payment_id, new_amount_paid, new_balance_due }.
--
-- No requiere is_on_account=true: un abono válido sobre venta contado con
-- balance_due>0 sería trivialmente rechazado (contado ya tiene balance_due=0
-- por construcción del create_sale v2). Aceptamos abonar cualquier venta con
-- saldo pendiente — más simple y sin riesgo.

CREATE OR REPLACE FUNCTION register_payment(
    p_sale_id         UUID,
    p_amount          NUMERIC,
    p_payment_method  TEXT,
    p_shift_id        UUID DEFAULT NULL,
    p_notes           TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid            UUID := auth.uid();
    v_role           TEXT;
    v_user_site      UUID;
    v_sale           RECORD;
    v_shift          RECORD;
    v_payment_id     UUID;
    v_received_by    TEXT;
    v_is_cash        BOOLEAN;
    v_new_amount     NUMERIC;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para registrar abono.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'El monto del abono debe ser mayor que cero.';
    END IF;
    IF p_payment_method IS NULL OR btrim(p_payment_method) = '' THEN
        RAISE EXCEPTION 'El método de pago es obligatorio.';
    END IF;

    SELECT sale_id, customer_id, site_id, total_amount, amount_paid,
           balance_due, status, numero, is_on_account
      INTO v_sale
      FROM sales
     WHERE sale_id = p_sale_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venta no encontrada.';
    END IF;
    IF v_sale.status <> 'active' THEN
        RAISE EXCEPTION 'La venta no está activa (status=%).', v_sale.status;
    END IF;

    IF v_role IN ('encargado','vendedor')
       AND v_user_site IS DISTINCT FROM v_sale.site_id THEN
        RAISE EXCEPTION 'Solo puedes abonar ventas de tu sede.';
    END IF;

    IF p_amount > v_sale.balance_due THEN
        RAISE EXCEPTION
          'El abono (%) excede el saldo pendiente (%).',
          p_amount, v_sale.balance_due;
    END IF;

    -- Guard D9: método cash requiere turno.
    v_is_cash := (p_payment_method ILIKE '%efectivo%'
                  OR p_payment_method ILIKE '%cash%');
    IF v_is_cash AND p_shift_id IS NULL THEN
        RAISE EXCEPTION
          'Un abono en efectivo requiere turno abierto (p_shift_id NULL no permitido).';
    END IF;

    -- Si viene turno: debe estar abierto y en la misma sede.
    IF p_shift_id IS NOT NULL THEN
        SELECT shift_id, site_id, status
          INTO v_shift
          FROM pos_shifts
         WHERE shift_id = p_shift_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Turno no encontrado.';
        END IF;
        IF v_shift.status <> 'open' THEN
            RAISE EXCEPTION 'El turno no está abierto (status=%).', v_shift.status;
        END IF;
        IF v_shift.site_id IS DISTINCT FROM v_sale.site_id THEN
            RAISE EXCEPTION 'El turno pertenece a otra sede que la venta.';
        END IF;
    END IF;

    -- received_by derivado de auth.uid() (D11): sin parámetro del cliente.
    SELECT COALESCE(NULLIF(btrim(full_name), ''), email)
      INTO v_received_by
      FROM user_profiles
     WHERE id = v_uid;

    INSERT INTO sale_payments
        (sale_id, amount, payment_method, shift_id, site_id, received_by, notes)
    VALUES
        (p_sale_id, p_amount, p_payment_method, p_shift_id, v_sale.site_id,
         v_received_by, p_notes)
    RETURNING payment_id INTO v_payment_id;

    UPDATE sales
       SET amount_paid = amount_paid + p_amount
     WHERE sale_id = p_sale_id;

    v_new_amount := v_sale.amount_paid + p_amount;

    INSERT INTO accounting_entries
        (site_id, entry_type, category, description, amount, sale_id)
    VALUES (
        v_sale.site_id,
        'income',
        'Abono crédito',
        'Abono venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8))
            || ' - ' || p_payment_method,
        p_amount,
        p_sale_id
    );

    RETURN jsonb_build_object(
        'payment_id',       v_payment_id,
        'new_amount_paid',  v_new_amount,
        'new_balance_due',  v_sale.total_amount - v_new_amount
    );
END;
$$;

REVOKE ALL     ON FUNCTION register_payment(UUID,NUMERIC,TEXT,UUID,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION register_payment(UUID,NUMERIC,TEXT,UUID,TEXT) TO authenticated;

-- =============================================================================
-- 2. apply_customer_credit — redención de saldo a favor (Fase 3 spec)
-- =============================================================================
--
-- D14 bloqueante (spec §6.1): DEBE asentar income por el monto aplicado,
-- aunque no entre plata nueva. Sin eso la P&L queda 1:1 debajo del cash real
-- total del ciclo (traza numérica: la venta anulada asentó expense por lo
-- pagado; sin este income la redención no restablece la simetría).
--
-- El método del sale_payment se guarda como 'credito_favor' — NO cash → no
-- infla arqueo (get_shift_balance clasifica cash por ILIKE efectivo|cash).
--
-- Concurrencia: lock FOR UPDATE de customer_credits del cliente (serializa
-- dos redenciones paralelas del mismo saldo). El sale también va FOR UPDATE
-- (mismo patrón que register_payment).

CREATE OR REPLACE FUNCTION apply_customer_credit(
    p_sale_id         UUID,
    p_credit_amount   NUMERIC,
    p_shift_id        UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid              UUID := auth.uid();
    v_role             TEXT;
    v_user_site        UUID;
    v_sale             RECORD;
    v_shift            RECORD;
    v_credit_balance   NUMERIC := 0;
    v_payment_id       UUID;
    v_received_by      TEXT;
    v_new_amount       NUMERIC;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para redimir saldo a favor.';
    END IF;

    IF p_credit_amount IS NULL OR p_credit_amount <= 0 THEN
        RAISE EXCEPTION 'El monto a redimir debe ser mayor que cero.';
    END IF;

    SELECT sale_id, customer_id, site_id, total_amount, amount_paid,
           balance_due, status, numero
      INTO v_sale
      FROM sales
     WHERE sale_id = p_sale_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venta no encontrada.';
    END IF;
    IF v_sale.status <> 'active' THEN
        RAISE EXCEPTION 'La venta no está activa (status=%).', v_sale.status;
    END IF;

    IF v_role IN ('encargado','vendedor')
       AND v_user_site IS DISTINCT FROM v_sale.site_id THEN
        RAISE EXCEPTION 'Solo puedes redimir saldo en ventas de tu sede.';
    END IF;

    IF p_credit_amount > v_sale.balance_due THEN
        RAISE EXCEPTION
          'El monto a redimir (%) excede el saldo pendiente de la venta (%).',
          p_credit_amount, v_sale.balance_due;
    END IF;

    -- Lock del saldo del cliente. Serializa redenciones paralelas.
    -- Postgres no permite FOR UPDATE con función agregada, así que
    -- lockeamos las filas primero y luego computamos el SUM.
    PERFORM 1
      FROM customer_credits
     WHERE customer_id = v_sale.customer_id
     FOR UPDATE;
    SELECT COALESCE(SUM(amount), 0)
      INTO v_credit_balance
      FROM customer_credits
     WHERE customer_id = v_sale.customer_id;

    IF v_credit_balance < p_credit_amount THEN
        RAISE EXCEPTION
          'Saldo a favor insuficiente (disponible: %, solicitado: %).',
          v_credit_balance, p_credit_amount;
    END IF;

    -- Si viene turno (opcional para redención): validar open + misma sede.
    IF p_shift_id IS NOT NULL THEN
        SELECT shift_id, site_id, status
          INTO v_shift
          FROM pos_shifts
         WHERE shift_id = p_shift_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Turno no encontrado.';
        END IF;
        IF v_shift.status <> 'open' THEN
            RAISE EXCEPTION 'El turno no está abierto (status=%).', v_shift.status;
        END IF;
        IF v_shift.site_id IS DISTINCT FROM v_sale.site_id THEN
            RAISE EXCEPTION 'El turno pertenece a otra sede que la venta.';
        END IF;
    END IF;

    SELECT COALESCE(NULLIF(btrim(full_name), ''), email)
      INTO v_received_by
      FROM user_profiles
     WHERE id = v_uid;

    -- 1) sale_payments con método 'credito_favor' (NO cash — no infla arqueo).
    INSERT INTO sale_payments
        (sale_id, amount, payment_method, shift_id, site_id, received_by, notes)
    VALUES (
        p_sale_id, p_credit_amount, 'credito_favor', p_shift_id,
        v_sale.site_id, v_received_by,
        'Redención saldo a favor'
    ) RETURNING payment_id INTO v_payment_id;

    -- 2) customer_credits negativo: consume saldo.
    INSERT INTO customer_credits
        (customer_id, amount, source_type, source_sale_id, site_id, notes, created_by)
    VALUES (
        v_sale.customer_id,
        -p_credit_amount,
        'redemption',
        p_sale_id,
        v_sale.site_id,
        'Redención en venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
        v_uid
    );

    -- 3) UPDATE sales.amount_paid.
    UPDATE sales
       SET amount_paid = amount_paid + p_credit_amount
     WHERE sale_id = p_sale_id;

    v_new_amount := v_sale.amount_paid + p_credit_amount;

    -- 4) Income D14 bloqueante — restablece la simetría con el expense del void.
    INSERT INTO accounting_entries
        (site_id, entry_type, category, description, amount, sale_id)
    VALUES (
        v_sale.site_id,
        'income',
        'Redención saldo a favor',
        'Redención en venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
        p_credit_amount,
        p_sale_id
    );

    RETURN jsonb_build_object(
        'payment_id',        v_payment_id,
        'new_amount_paid',   v_new_amount,
        'new_balance_due',   v_sale.total_amount - v_new_amount,
        'remaining_credit',  v_credit_balance - p_credit_amount
    );
END;
$$;

REVOKE ALL     ON FUNCTION apply_customer_credit(UUID,NUMERIC,UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION apply_customer_credit(UUID,NUMERIC,UUID) TO authenticated;

-- =============================================================================
-- 3. create_sale v3 — hardening D9 (shift_id obligatorio si abono cash)
-- =============================================================================
--
-- Diff vs v2 (script 15): añade guard D9 justo antes del INSERT en
-- sale_payments; si p_shift_id viene, valida open + misma sede. Toda otra
-- semántica intacta.
--
-- La deuda D9 en create_sale es lo que quedó abierto en Fase 2A (fiar desde
-- POS): el guard vivía cliente-side (payment-dialog.tsx desactiva el botón).
-- Aquí cierra server-side y el cliente pasa a defensa en profundidad.

CREATE OR REPLACE FUNCTION create_sale(
    p_customer_id      UUID,
    p_total_amount     NUMERIC,
    p_items            JSONB,
    p_payment_method   TEXT DEFAULT NULL,
    p_amount_received  NUMERIC DEFAULT NULL,
    p_seller           TEXT DEFAULT NULL,
    p_notes            TEXT DEFAULT NULL,
    p_site_id          UUID DEFAULT NULL,
    p_warehouse_id     UUID DEFAULT NULL,
    p_shift_id         UUID DEFAULT NULL,
    p_user_id          UUID DEFAULT NULL,
    p_is_on_account    BOOLEAN DEFAULT FALSE,
    p_initial_payment  NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid            UUID := auth.uid();
    v_role           TEXT;
    v_user_site      UUID;
    v_sale_id        UUID;
    v_item           RECORD;
    v_is_service     BOOLEAN;
    v_numero         INTEGER;
    v_customer       RECORD;
    v_amount_paid    NUMERIC := 0;
    v_payment_label  TEXT;
    v_shift          RECORD;
    v_is_cash        BOOLEAN;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para registrar venta.';
    END IF;
    IF p_site_id IS NULL THEN
        RAISE EXCEPTION 'La venta requiere sede.';
    END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM p_site_id THEN
        RAISE EXCEPTION 'Solo puedes registrar ventas en tu sede.';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La venta no tiene productos.';
    END IF;
    IF p_total_amount < 0 THEN
        RAISE EXCEPTION 'El total de la venta no puede ser negativo.';
    END IF;

    IF p_is_on_account THEN
        SELECT customer_id, allows_credit, is_walk_in
          INTO v_customer
          FROM customers
         WHERE customer_id = p_customer_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cliente no encontrado (obligatorio para fiar).';
        END IF;
        IF v_customer.is_walk_in OR NOT v_customer.allows_credit THEN
            RAISE EXCEPTION 'Este cliente no puede fiar.';
        END IF;

        IF p_initial_payment IS NULL THEN
            v_amount_paid := 0;
        ELSIF p_initial_payment < 0 OR p_initial_payment > p_total_amount THEN
            RAISE EXCEPTION 'Abono inicial fuera de rango [0, total].';
        ELSE
            v_amount_paid := p_initial_payment;
        END IF;

        v_payment_label := 'crédito';
    ELSE
        v_amount_paid := p_total_amount;
        v_payment_label := p_payment_method;
    END IF;

    -- Guard D9 (hardening Fase 3): un cobro cash requiere turno.
    -- Aplica a contado con método cash, o a fiado con abono inicial cash.
    IF v_amount_paid > 0 THEN
        v_is_cash := (p_payment_method ILIKE '%efectivo%'
                      OR p_payment_method ILIKE '%cash%');
        IF v_is_cash AND p_shift_id IS NULL THEN
            RAISE EXCEPTION
              'Un cobro en efectivo requiere turno abierto (p_shift_id NULL no permitido).';
        END IF;
    END IF;

    -- Si viene turno: debe estar abierto y en la misma sede.
    IF p_shift_id IS NOT NULL THEN
        SELECT shift_id, site_id, status
          INTO v_shift
          FROM pos_shifts
         WHERE shift_id = p_shift_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Turno no encontrado.';
        END IF;
        IF v_shift.status <> 'open' THEN
            RAISE EXCEPTION 'El turno no está abierto (status=%).', v_shift.status;
        END IF;
        IF v_shift.site_id IS DISTINCT FROM p_site_id THEN
            RAISE EXCEPTION 'El turno pertenece a otra sede que la venta.';
        END IF;
    END IF;

    IF p_site_id IS NOT NULL THEN
        UPDATE site_counters
           SET last_numero = last_numero + 1
         WHERE site_id = p_site_id
        RETURNING last_numero INTO v_numero;
    END IF;

    INSERT INTO sales (
        customer_id, total_amount, payment_method, amount_received,
        seller, notes, site_id, warehouse_id, shift_id, numero, status,
        is_on_account, amount_paid
    ) VALUES (
        p_customer_id, p_total_amount, v_payment_label, p_amount_received,
        p_seller, p_notes, p_site_id, p_warehouse_id, p_shift_id, v_numero, 'active',
        p_is_on_account, v_amount_paid
    ) RETURNING sale_id INTO v_sale_id;

    FOR v_item IN
        SELECT
            (i ->> 'product_id')::UUID    AS product_id,
            (i ->> 'quantity')::INTEGER   AS quantity,
            (i ->> 'unit_price')::NUMERIC AS unit_price
        FROM jsonb_array_elements(p_items) AS i
    LOOP
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Cantidad inválida en la venta.';
        END IF;

        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
        VALUES (v_sale_id, v_item.product_id, v_item.quantity, COALESCE(v_item.unit_price, 0));

        SELECT is_service INTO v_is_service
          FROM products WHERE product_id = v_item.product_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'El producto % no existe.', v_item.product_id;
        END IF;

        IF NOT v_is_service THEN
            IF p_warehouse_id IS NOT NULL THEN
                PERFORM adjust_warehouse_stock(
                    v_item.product_id, p_warehouse_id, -v_item.quantity,
                    'venta', 'sale', v_sale_id, v_uid
                );
            ELSE
                PERFORM decrement_product_stock(v_item.product_id, v_item.quantity);
            END IF;
        END IF;
    END LOOP;

    IF v_amount_paid > 0 THEN
        INSERT INTO sale_payments
            (sale_id, amount, payment_method, shift_id, site_id, received_by, notes)
        VALUES (
            v_sale_id, v_amount_paid,
            COALESCE(p_payment_method, 'Desconocido'),
            p_shift_id, p_site_id, p_seller,
            CASE WHEN p_is_on_account THEN 'Abono inicial' ELSE NULL END
        );

        INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            p_site_id,
            'income',
            CASE WHEN p_is_on_account THEN 'Abono inicial crédito' ELSE 'Ventas POS' END,
            'Venta #' || COALESCE(v_numero::TEXT, LEFT(v_sale_id::TEXT, 8)) ||
                COALESCE(' - ' || p_payment_method, ''),
            v_amount_paid,
            v_sale_id
        );
    END IF;

    RETURN v_sale_id;
END;
$$;

REVOKE ALL     ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK manual (correr solo si algo se rompe post-aplicación en branch):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS register_payment(UUID,NUMERIC,TEXT,UUID,TEXT);
-- DROP FUNCTION IF EXISTS apply_customer_credit(UUID,NUMERIC,UUID);
-- -- create_sale: restaurar la versión v2 desde scripts/15_credit_sales_phase1.sql
-- --   (la diferencia es solo el bloque "Guard D9" añadido en Fase 3).
-- COMMIT;
-- =============================================================================
