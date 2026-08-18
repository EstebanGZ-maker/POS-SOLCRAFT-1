-- =============================================================================
-- 17rollback_2c_v2_and_cogs.sql — Rollback del release triple 17c_v2 + 17e.
--
-- ⚠ Solo aplicar si el release triple (17c_v2 + 17e + TS 2D) falla y hay
-- que volver al estado post-2A+2B inmediato. NO aplicar en operación
-- normal.
--
-- Restaura las 3 RPCs a sus versiones pre-triple (snapshot de prod
-- 2026-08-17 post-2A+2B):
--   1. create_adjustment: firma 3-arg con WAC (versión de 17b),
--      sin motivo, sin asientos. DROP de la firma 4-arg introducida
--      por 17c_v2.
--   2. create_sale: versión previa a 17e (sin persistir sale_items.unit_cost,
--      sin emitir asiento COGS agregado).
--   3. void_sale: versión previa a 17e (con RETURN temprano cuando
--      amount_paid=0, sin bloque de reversa de COGS).
--
-- Las columnas nuevas se DEJAN INTACTAS (no se dropean):
--   * sale_items.unit_cost — nullable, sin CHECK. Ventas hechas post-
--     deploy con COGS tienen unit_cost≠NULL; el create_sale rollback no
--     la escribe pero tampoco falla. Ventas nuevas quedan con unit_cost
--     NULL como los históricos.
--   * accounting_entries.adjustment_id — nullable, sin CHECK. Mismo
--     argumento: dropearla implica perder trazabilidad de asientos ya
--     insertados por 17c_v2 sobre ajustes de merma.
--
-- ⚠ RIESGO CONOCIDO del rollback — void de ventas post-deploy:
-- Una venta creada mientras el triple estaba activo persistió unit_cost
-- y emitió asiento COGS. Después del rollback, void_sale (versión vieja)
-- NO reversa ese COGS — queda un expense "Costo de mercancía vendida"
-- huérfano sin su reversa. Consecuencia contable: la venta anulada
-- queda con neto ≠ 0 (income - expense_anulación + expense_COGS
-- sin reversa = -COGS). El operador debe emitir un asiento manual
-- compensatorio (income "Reversión manual COGS venta #N" por el mismo
-- monto que el expense COGS) para cerrar la cuenta.
-- Alternativa recomendada: no anular ventas del intervalo triple-activo
-- después del rollback — reaplicar el triple o dejar esas ventas
-- activas hasta decidir estrategia.
--
-- Idempotencia: CREATE OR REPLACE + DROP IF EXISTS. Correr N veces
-- deja el mismo resultado.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. create_adjustment — restaurar firma 3-arg (versión 17b, sin motivo)
-- =============================================================================

-- Drop de la firma 4-arg introducida por 17c_v2.
DROP FUNCTION IF EXISTS create_adjustment(UUID, TEXT, JSONB, TEXT);

-- Restaurar create_adjustment v2b (snapshot de prod post-2A+2B).
CREATE OR REPLACE FUNCTION create_adjustment(
    p_warehouse_id UUID, p_notes TEXT, p_items JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
    v_uid UUID := auth.uid(); v_role TEXT; v_user_site UUID; v_site_id UUID;
    v_adj_id UUID; v_numero INTEGER; v_item RECORD; v_delta INTEGER; v_total NUMERIC := 0;
    v_cost_before NUMERIC; v_stock_before INTEGER; v_new_cost NUMERIC;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
    v_role := user_role(); v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado') THEN
        RAISE EXCEPTION 'Sin permisos.'; END IF;
    IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'La bodega es obligatoria.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'El ajuste no tiene ítems.'; END IF;
    SELECT w.site_id INTO v_site_id FROM warehouses w WHERE w.warehouse_id=p_warehouse_id;
    IF v_site_id IS NULL THEN RAISE EXCEPTION 'La bodega % no existe.', p_warehouse_id; END IF;
    IF v_role='encargado' AND v_user_site IS DISTINCT FROM v_site_id THEN
        RAISE EXCEPTION 'Solo puedes crear ajustes en tu sede.'; END IF;
    UPDATE adjustment_counters SET last_numero=last_numero+1 WHERE site_id=v_site_id RETURNING last_numero INTO v_numero;
    IF v_numero IS NULL THEN
        INSERT INTO adjustment_counters (site_id, last_numero) VALUES (v_site_id, 1)
          ON CONFLICT (site_id) DO UPDATE SET last_numero=adjustment_counters.last_numero+1
          RETURNING last_numero INTO v_numero;
    END IF;
    SELECT COALESCE(SUM((i->>'cost')::NUMERIC*(i->>'quantity')::INTEGER),0) INTO v_total
      FROM jsonb_array_elements(p_items) AS i;
    INSERT INTO inventory_adjustments (warehouse_id, site_id, notes, total_adjusted, created_by, numero)
    VALUES (p_warehouse_id, v_site_id, p_notes, v_total, v_uid, v_numero) RETURNING adjustment_id INTO v_adj_id;
    FOR v_item IN SELECT (i->>'product_id')::UUID AS product_id,
            COALESCE((i->>'cost')::NUMERIC,0) AS cost, (i->>'objective')::TEXT AS objective,
            (i->>'quantity')::INTEGER AS quantity FROM jsonb_array_elements(p_items) AS i LOOP
        IF v_item.product_id IS NULL THEN RAISE EXCEPTION 'Falta product_id.'; END IF;
        IF v_item.quantity IS NULL OR v_item.quantity<=0 THEN
            RAISE EXCEPTION 'La cantidad debe ser > 0.'; END IF;
        IF v_item.cost<0 THEN RAISE EXCEPTION 'El costo no puede ser negativo.'; END IF;
        IF v_item.objective NOT IN ('incrementar','disminuir') THEN
            RAISE EXCEPTION 'Objective inválido: %.', v_item.objective; END IF;
        INSERT INTO adjustment_items (adjustment_id, product_id, cost, objective, quantity)
        VALUES (v_adj_id, v_item.product_id, v_item.cost, v_item.objective, v_item.quantity);
        IF v_item.objective='incrementar' AND v_item.cost>0 THEN
            SELECT cost INTO v_cost_before FROM products WHERE product_id=v_item.product_id FOR UPDATE;
            SELECT COALESCE(SUM(quantity),0) INTO v_stock_before FROM product_stock WHERE product_id=v_item.product_id;
        END IF;
        v_delta := CASE WHEN v_item.objective='incrementar' THEN v_item.quantity ELSE -v_item.quantity END;
        PERFORM adjust_warehouse_stock(v_item.product_id, p_warehouse_id, v_delta,
            'ajuste', 'adjustment', v_adj_id, v_uid, p_notes);
        IF v_item.objective='incrementar' AND v_item.cost>0 THEN
            v_new_cost := (v_stock_before*COALESCE(v_cost_before,0) + v_item.quantity*v_item.cost)
                        / (v_stock_before + v_item.quantity);
            UPDATE products SET cost=v_new_cost WHERE product_id=v_item.product_id;
        END IF;
    END LOOP;
    RETURN v_adj_id;
END; $$;
REVOKE ALL ON FUNCTION create_adjustment(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_adjustment(UUID, TEXT, JSONB) TO authenticated;

-- =============================================================================
-- 2. create_sale — restaurar versión pre-17e (sin unit_cost, sin COGS)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_sale(
    p_customer_id UUID, p_total_amount NUMERIC, p_items JSONB,
    p_payment_method TEXT DEFAULT NULL, p_amount_received NUMERIC DEFAULT NULL,
    p_seller TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL,
    p_site_id UUID DEFAULT NULL, p_warehouse_id UUID DEFAULT NULL,
    p_shift_id UUID DEFAULT NULL, p_user_id UUID DEFAULT NULL,
    p_is_on_account BOOLEAN DEFAULT FALSE, p_initial_payment NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
    v_uid UUID := auth.uid(); v_role TEXT; v_user_site UUID; v_sale_id UUID;
    v_item RECORD; v_is_service BOOLEAN; v_numero INTEGER;
    v_customer RECORD; v_amount_paid NUMERIC := 0; v_payment_label TEXT;
    v_shift RECORD; v_is_cash BOOLEAN;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
    v_role := user_role(); v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para registrar venta.';
    END IF;
    IF p_site_id IS NULL THEN RAISE EXCEPTION 'La venta requiere sede.'; END IF;
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
        SELECT customer_id, allows_credit, is_walk_in INTO v_customer
          FROM customers WHERE customer_id = p_customer_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado (obligatorio para fiar).'; END IF;
        IF v_customer.is_walk_in OR NOT v_customer.allows_credit THEN
            RAISE EXCEPTION 'Este cliente no puede fiar.';
        END IF;
        IF p_initial_payment IS NULL THEN v_amount_paid := 0;
        ELSIF p_initial_payment < 0 OR p_initial_payment > p_total_amount THEN
            RAISE EXCEPTION 'Abono inicial fuera de rango [0, total].';
        ELSE v_amount_paid := p_initial_payment;
        END IF;
        v_payment_label := 'crédito';
    ELSE
        v_amount_paid := p_total_amount;
        v_payment_label := p_payment_method;
    END IF;
    IF v_amount_paid > 0 THEN
        v_is_cash := (p_payment_method ILIKE '%efectivo%' OR p_payment_method ILIKE '%cash%');
        IF v_is_cash AND p_shift_id IS NULL THEN
            RAISE EXCEPTION 'Un cobro en efectivo requiere turno abierto (p_shift_id NULL no permitido).';
        END IF;
    END IF;
    IF p_shift_id IS NOT NULL THEN
        SELECT shift_id, site_id, status INTO v_shift FROM pos_shifts WHERE shift_id = p_shift_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Turno no encontrado.'; END IF;
        IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'El turno no está abierto (status=%).', v_shift.status; END IF;
        IF v_shift.site_id IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'El turno pertenece a otra sede que la venta.'; END IF;
    END IF;
    IF p_site_id IS NOT NULL THEN
        UPDATE site_counters SET last_numero = last_numero + 1 WHERE site_id = p_site_id RETURNING last_numero INTO v_numero;
    END IF;
    INSERT INTO sales (customer_id, total_amount, payment_method, amount_received, seller, notes,
        site_id, warehouse_id, shift_id, numero, status, is_on_account, amount_paid)
    VALUES (p_customer_id, p_total_amount, v_payment_label, p_amount_received, p_seller, p_notes,
        p_site_id, p_warehouse_id, p_shift_id, v_numero, 'active', p_is_on_account, v_amount_paid)
    RETURNING sale_id INTO v_sale_id;
    FOR v_item IN SELECT (i->>'product_id')::UUID AS product_id, (i->>'quantity')::INTEGER AS quantity, (i->>'unit_price')::NUMERIC AS unit_price
        FROM jsonb_array_elements(p_items) AS i LOOP
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN RAISE EXCEPTION 'Cantidad inválida en la venta.'; END IF;
        -- Rollback: NO persiste unit_cost. INSERT sin la columna → unit_cost queda NULL.
        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
        VALUES (v_sale_id, v_item.product_id, v_item.quantity, COALESCE(v_item.unit_price, 0));
        SELECT is_service INTO v_is_service FROM products WHERE product_id = v_item.product_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'El producto % no existe.', v_item.product_id; END IF;
        IF NOT v_is_service THEN
            IF p_warehouse_id IS NOT NULL THEN
                PERFORM adjust_warehouse_stock(v_item.product_id, p_warehouse_id, -v_item.quantity, 'venta', 'sale', v_sale_id, v_uid);
            ELSE PERFORM decrement_product_stock(v_item.product_id, v_item.quantity); END IF;
        END IF;
    END LOOP;
    IF v_amount_paid > 0 THEN
        INSERT INTO sale_payments (sale_id, amount, payment_method, shift_id, site_id, received_by, notes)
        VALUES (v_sale_id, v_amount_paid, COALESCE(p_payment_method, 'Desconocido'), p_shift_id, p_site_id, p_seller,
            CASE WHEN p_is_on_account THEN 'Abono inicial' ELSE NULL END);
        INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
        VALUES (p_site_id, 'income',
            CASE WHEN p_is_on_account THEN 'Abono inicial crédito' ELSE 'Ventas POS' END,
            'Venta #' || COALESCE(v_numero::TEXT, LEFT(v_sale_id::TEXT, 8)) || COALESCE(' - ' || p_payment_method, ''),
            v_amount_paid, v_sale_id);
    END IF;
    -- Rollback: NO emite asiento COGS.
    RETURN v_sale_id;
END; $$;
REVOKE ALL ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) TO authenticated;

-- =============================================================================
-- 3. void_sale — restaurar versión pre-17e (early return + sin reversa COGS)
-- =============================================================================

CREATE OR REPLACE FUNCTION void_sale(
    p_sale_id UUID, p_user_id UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
    v_uid UUID := auth.uid(); v_role TEXT; v_user_site UUID; v_sale RECORD;
    v_item RECORD; v_is_service BOOLEAN; v_cash_refund NUMERIC := 0; v_current_shift UUID;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
    v_role := user_role(); v_user_site := user_site_id();
    IF v_role NOT IN ('admin','encargado','vendedor') THEN RAISE EXCEPTION 'Sin permisos para anular venta.'; END IF;
    SELECT sale_id, customer_id, site_id, warehouse_id, total_amount, amount_paid, status, numero, is_on_account
      INTO v_sale FROM sales WHERE sale_id = p_sale_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.'; END IF;
    IF v_sale.status = 'voided' THEN RAISE EXCEPTION 'La venta ya está anulada.'; END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM v_sale.site_id THEN
        RAISE EXCEPTION 'Solo puedes anular ventas de tu sede.';
    END IF;
    UPDATE sales SET status = 'voided' WHERE sale_id = p_sale_id;
    FOR v_item IN SELECT si.product_id, si.quantity FROM sale_items si WHERE si.sale_id = p_sale_id LOOP
        SELECT is_service INTO v_is_service FROM products WHERE product_id = v_item.product_id;
        IF NOT v_is_service AND v_sale.warehouse_id IS NOT NULL THEN
            PERFORM adjust_warehouse_stock(v_item.product_id, v_sale.warehouse_id, v_item.quantity,
                'devolucion', 'sale', p_sale_id, v_uid,
                'Anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)));
        END IF;
    END LOOP;
    -- Rollback: RETURN temprano si amount_paid=0. NO reversa COGS.
    IF v_sale.amount_paid = 0 THEN RETURN; END IF;
    INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
    VALUES (v_sale.site_id, 'expense',
        CASE WHEN v_sale.is_on_account THEN 'Anulación crédito' ELSE 'Anulación venta' END,
        'Anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
        v_sale.amount_paid, p_sale_id);
    IF v_sale.is_on_account THEN
        INSERT INTO customer_credits (customer_id, amount, source_type, source_sale_id, site_id, notes, created_by)
        VALUES (v_sale.customer_id, v_sale.amount_paid, 'void_sale', p_sale_id, v_sale.site_id,
            'Saldo a favor por anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)), v_uid);
    ELSE
        SELECT COALESCE(SUM(amount), 0) INTO v_cash_refund FROM sale_payments
         WHERE sale_id = p_sale_id AND status = 'active'
           AND (payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%');
        IF v_cash_refund > 0 THEN
            SELECT shift_id INTO v_current_shift FROM pos_shifts WHERE site_id = v_sale.site_id AND status = 'open';
            IF v_current_shift IS NULL THEN
                RAISE EXCEPTION 'Para anular una venta con cobros en efectivo debes tener un turno abierto en la sede.';
            END IF;
            INSERT INTO cash_movements (shift_id, type, amount, description)
            VALUES (v_current_shift, 'refund', v_cash_refund,
                'Refund anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)));
        END IF;
    END IF;
END; $$;
REVOKE ALL ON FUNCTION void_sale(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION void_sale(UUID, UUID) TO authenticated;

COMMIT;

-- =============================================================================
-- Recordatorio post-rollback (procedimiento manual, NO SQL):
--
-- Si hubo ventas creadas durante el intervalo triple-activo (persistieron
-- unit_cost + emitieron asiento COGS), y se anulan DESPUÉS del rollback:
--   * El void_sale rollback no reversa el COGS → queda expense huérfano.
--   * Emitir asiento manual compensatorio:
--       INSERT INTO accounting_entries (site_id, entry_type, category,
--         description, amount, sale_id)
--       VALUES (<site>, 'income', 'Reversión manual COGS venta #N',
--         'Reversión manual post-rollback', <cogs_amount>, <sale_id>);
--   * Documentar en notas contables.
-- Alternativa: reaplicar el release triple para restaurar el void_sale
-- que sí reversa COGS.
-- =============================================================================
