-- =============================================================================
-- 17e_cogs_in_sales.sql — COGS al vender + reversa en anulación.
--
-- Ver docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.4 (diseño), §6.5 (traza numérica),
-- §10.1 DN4 (contexto del método aprobado 2026-08-17).
--
-- ⚠ RELEASE TRIPLE ACOPLADO con 17c_v2 + refactor TS 2D. Ninguno se
-- puede fasear. Ver ESTADO-PENDIENTES.md §0 "GATE CONTADOR RESUELTO".
--
-- Riesgo ALTO — toca create_sale y void_sale (máximo radio de impacto
-- del sistema). Requiere: 17c_v2_adjustments_no_expense.sql aplicado
-- (para que create_adjustment con motivo esté disponible; los callers
-- TS del refactor 2D pasarán motivo='compra' consumiendo el RPC nuevo).
--
-- Alcance:
--   1. ALTER sale_items ADD unit_cost NUMERIC(12,2) NULL. Los históricos
--      quedan NULL — no se hace backfill (ventas pre-cambio nunca
--      generaron COGS y por lo tanto no hay COGS que reversar en un
--      void posterior).
--   2. create_sale v2: persiste unit_cost desde products.cost al momento
--      de la venta + emite 1 asiento agregado expense "Costo de mercancía
--      vendida" por venta. Servicios excluidos (v_item_cost=NULL para
--      ellos). Firma sin cambio.
--   3. void_sale v2: mueve/elimina el RETURN temprano cuando amount_paid=0
--      + reversa COGS leyendo sale_items.unit_cost (no products.cost vivo,
--      para reverso exacto contra descuadre por WAC intermedio).
--
-- Retroactividad: ventas históricas con unit_cost=NULL siguen sin COGS
-- (nunca lo tuvieron); el void de una venta histórica no reversa COGS
-- (no había). Comportamiento pre-cambio preservado para históricos.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. sale_items.unit_cost — nueva columna, nullable
-- =============================================================================

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2);

-- Sin backfill. Sin CHECK. Sin NOT NULL. Los históricos quedan NULL.
-- El bloque de COGS en void_sale filtra por unit_cost IS NOT NULL para
-- ignorar históricos y servicios.

-- =============================================================================
-- 2. create_sale v2 — persiste unit_cost + emite COGS agregado
-- =============================================================================
-- Firma sin cambio (13 args). CREATE OR REPLACE preserva la firma actual
-- en prod. Solo cambia el cuerpo.
-- =============================================================================

CREATE OR REPLACE FUNCTION create_sale(
    p_customer_id      UUID,
    p_total_amount     NUMERIC,
    p_items            JSONB,
    p_payment_method   TEXT    DEFAULT NULL,
    p_amount_received  NUMERIC DEFAULT NULL,
    p_seller           TEXT    DEFAULT NULL,
    p_notes            TEXT    DEFAULT NULL,
    p_site_id          UUID    DEFAULT NULL,
    p_warehouse_id     UUID    DEFAULT NULL,
    p_shift_id         UUID    DEFAULT NULL,
    p_user_id          UUID    DEFAULT NULL,
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
    -- Nuevas variables para COGS
    v_item_cost      NUMERIC;
    v_cogs_total     NUMERIC := 0;
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
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cliente no encontrado (obligatorio para fiar).';
        END IF;
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
        SELECT shift_id, site_id, status INTO v_shift
          FROM pos_shifts WHERE shift_id = p_shift_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Turno no encontrado.'; END IF;
        IF v_shift.status <> 'open' THEN
            RAISE EXCEPTION 'El turno no está abierto (status=%).', v_shift.status;
        END IF;
        IF v_shift.site_id IS DISTINCT FROM p_site_id THEN
            RAISE EXCEPTION 'El turno pertenece a otra sede que la venta.';
        END IF;
    END IF;

    IF p_site_id IS NOT NULL THEN
        UPDATE site_counters SET last_numero = last_numero + 1
         WHERE site_id = p_site_id RETURNING last_numero INTO v_numero;
    END IF;

    INSERT INTO sales (
        customer_id, total_amount, payment_method, amount_received, seller, notes,
        site_id, warehouse_id, shift_id, numero, status, is_on_account, amount_paid
    ) VALUES (
        p_customer_id, p_total_amount, v_payment_label, p_amount_received, p_seller, p_notes,
        p_site_id, p_warehouse_id, p_shift_id, v_numero, 'active', p_is_on_account, v_amount_paid
    ) RETURNING sale_id INTO v_sale_id;

    -- Loop de items: persistir unit_cost, acumular COGS, mover stock.
    FOR v_item IN
        SELECT (i->>'product_id')::UUID    AS product_id,
               (i->>'quantity')::INTEGER   AS quantity,
               (i->>'unit_price')::NUMERIC AS unit_price
          FROM jsonb_array_elements(p_items) AS i
    LOOP
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Cantidad inválida en la venta.';
        END IF;

        -- Lookup del producto (existencia + is_service) ANTES de insertar
        -- sale_items para saber si aporta COGS.
        SELECT is_service INTO v_is_service
          FROM products WHERE product_id = v_item.product_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'El producto % no existe.', v_item.product_id;
        END IF;

        -- Leer WAC (products.cost) ANTES de decrementar stock. Solo para
        -- productos físicos. Servicios → v_item_cost NULL, no aportan COGS.
        IF NOT v_is_service THEN
            SELECT cost INTO v_item_cost
              FROM products WHERE product_id = v_item.product_id;
            -- Acumular al COGS de la venta (COALESCE por si cost es NULL
            -- excepcionalmente — no aporta al total).
            v_cogs_total := v_cogs_total + (v_item.quantity * COALESCE(v_item_cost, 0));
        ELSE
            v_item_cost := NULL;   -- servicio: sin costo
        END IF;

        -- Persistir en sale_items con unit_cost (NUEVO).
        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost)
        VALUES (v_sale_id, v_item.product_id, v_item.quantity,
                COALESCE(v_item.unit_price, 0), v_item_cost);

        -- Kardex: decrementar stock (solo físicos).
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

    -- Income (patrón existente): solo si amount_paid > 0.
    IF v_amount_paid > 0 THEN
        INSERT INTO sale_payments
            (sale_id, amount, payment_method, shift_id, site_id, received_by, notes)
        VALUES (
            v_sale_id, v_amount_paid,
            COALESCE(p_payment_method, 'Desconocido'),
            p_shift_id, p_site_id, p_seller,
            CASE WHEN p_is_on_account THEN 'Abono inicial' ELSE NULL END
        );

        INSERT INTO accounting_entries
            (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            p_site_id, 'income',
            CASE WHEN p_is_on_account THEN 'Abono inicial crédito' ELSE 'Ventas POS' END,
            'Venta #' || COALESCE(v_numero::TEXT, LEFT(v_sale_id::TEXT, 8)) ||
                COALESCE(' - ' || p_payment_method, ''),
            v_amount_paid, v_sale_id
        );
    END IF;

    -- COGS (NUEVO): 1 asiento agregado expense por venta si hay items
    -- físicos con costo. Independiente de amount_paid — la mercancía sale
    -- del inventario completo, así que se reconoce el costo completo.
    IF v_cogs_total > 0 THEN
        INSERT INTO accounting_entries
            (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            p_site_id, 'expense', 'Costo de mercancía vendida',
            'COGS venta #' || COALESCE(v_numero::TEXT, LEFT(v_sale_id::TEXT, 8)),
            v_cogs_total, v_sale_id
        );
    END IF;

    RETURN v_sale_id;
END;
$$;

-- Grants sin cambio (misma firma).
REVOKE ALL     ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) TO authenticated;

-- =============================================================================
-- 3. void_sale v2 — mueve early return + reversa COGS
-- =============================================================================
-- Cambios vs v1 (prod):
--   * El RETURN temprano cuando amount_paid=0 se elimina. En su lugar,
--     los pasos 5-7 (asiento expense, customer_credits, cash refund) se
--     envuelven en un IF v_sale.amount_paid > 0.
--   * Nuevo bloque de reversa de COGS: lee sale_items.unit_cost (NULL
--     para históricos → no reversa nada), emite income "Reversión Costo
--     de mercancía vendida". Aplica siempre que exista COGS que
--     reversar, independiente del amount_paid.
-- =============================================================================

CREATE OR REPLACE FUNCTION void_sale(
    p_sale_id UUID,
    p_user_id UUID DEFAULT NULL   -- IGNORADO (D11); se usa auth.uid()
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_role          TEXT;
    v_user_site     UUID;
    v_sale          RECORD;
    v_item          RECORD;
    v_is_service    BOOLEAN;
    v_cash_refund   NUMERIC := 0;
    v_current_shift UUID;
    v_cogs_reverse  NUMERIC := 0;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para anular venta.';
    END IF;

    SELECT sale_id, customer_id, site_id, warehouse_id, total_amount,
           amount_paid, status, numero, is_on_account
      INTO v_sale
      FROM sales WHERE sale_id = p_sale_id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.'; END IF;
    IF v_sale.status = 'voided' THEN RAISE EXCEPTION 'La venta ya está anulada.'; END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM v_sale.site_id THEN
        RAISE EXCEPTION 'Solo puedes anular ventas de tu sede.';
    END IF;

    UPDATE sales SET status = 'voided' WHERE sale_id = p_sale_id;

    -- Kardex: devolver stock por-ítem (sin cambio vs v1).
    FOR v_item IN
        SELECT si.product_id, si.quantity
          FROM sale_items si WHERE si.sale_id = p_sale_id
    LOOP
        SELECT is_service INTO v_is_service
          FROM products WHERE product_id = v_item.product_id;

        IF NOT v_is_service AND v_sale.warehouse_id IS NOT NULL THEN
            PERFORM adjust_warehouse_stock(
                v_item.product_id, v_sale.warehouse_id, v_item.quantity,
                'devolucion', 'sale', p_sale_id, v_uid,
                'Anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8))
            );
        END IF;
    END LOOP;

    -- Reversa de COGS (NUEVO). Lee unit_cost persistido en sale_items
    -- (no products.cost vivo, para reverso exacto contra descuadre por
    -- WAC intermedio). Aplica siempre que exista COGS que reversar —
    -- independiente del amount_paid. Ventas históricas con unit_cost=NULL
    -- (pre-cambio) aportan 0 → no se inserta asiento (patrón "no asentar
    -- amounts=0").
    SELECT COALESCE(SUM(si.quantity * si.unit_cost), 0) INTO v_cogs_reverse
      FROM sale_items si
     WHERE si.sale_id = p_sale_id
       AND si.unit_cost IS NOT NULL;

    IF v_cogs_reverse > 0 THEN
        INSERT INTO accounting_entries
            (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            v_sale.site_id, 'income', 'Reversión Costo de mercancía vendida',
            'Anulación COGS venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
            v_cogs_reverse, p_sale_id
        );
    END IF;

    -- Bloque de compensación de INCOME + customer_credits + cash refund:
    -- solo si amount_paid > 0. Antes: RETURN temprano; ahora: envuelve
    -- para permitir que la reversa de COGS de arriba también corra en
    -- ventas a crédito sin abono (Caso C con COGS).
    IF v_sale.amount_paid > 0 THEN
        INSERT INTO accounting_entries
            (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            v_sale.site_id, 'expense',
            CASE WHEN v_sale.is_on_account THEN 'Anulación crédito' ELSE 'Anulación venta' END,
            'Anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
            v_sale.amount_paid, p_sale_id
        );

        IF v_sale.is_on_account THEN
            INSERT INTO customer_credits
                (customer_id, amount, source_type, source_sale_id, site_id, notes, created_by)
            VALUES (
                v_sale.customer_id, v_sale.amount_paid, 'void_sale', p_sale_id, v_sale.site_id,
                'Saldo a favor por anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
                v_uid
            );
        ELSE
            SELECT COALESCE(SUM(amount), 0) INTO v_cash_refund
              FROM sale_payments
             WHERE sale_id = p_sale_id
               AND status = 'active'
               AND (payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%');

            IF v_cash_refund > 0 THEN
                SELECT shift_id INTO v_current_shift
                  FROM pos_shifts
                 WHERE site_id = v_sale.site_id AND status = 'open';

                IF v_current_shift IS NULL THEN
                    RAISE EXCEPTION 'Para anular una venta con cobros en efectivo debes tener un turno abierto en la sede.';
                END IF;

                INSERT INTO cash_movements (shift_id, type, amount, description)
                VALUES (
                    v_current_shift, 'refund', v_cash_refund,
                    'Refund anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8))
                );
            END IF;
        END IF;
    END IF;
END;
$$;

REVOKE ALL     ON FUNCTION void_sale(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION void_sale(UUID, UUID) TO authenticated;

COMMIT;
