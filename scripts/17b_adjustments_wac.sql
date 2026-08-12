-- =============================================================================
-- 17b_adjustments_wac.sql — Ajustes Fase 2B (costo promedio ponderado).
--
-- Riesgo MEDIO. Requiere: 17a_adjustments_numeracion.sql aplicado.
--
-- Alcance:
--   1. create_adjustment v2b: además de numerar, recalcula products.cost
--      con WAC al procesar items 'incrementar' con cost>0.
--      Orden crítico documentado en docs/INVENTORY-ADJUSTMENTS-SPEC.md §5.1.1.
--
-- No cambia firma (mismos 3 params). CREATE OR REPLACE.
-- No incluye contabilidad con motivos (Fase 2C).
--
-- Reversión en void: NO se revierte products.cost (D5). La UI del botón
-- "Anular" ya lo advierte (spec §1 punto 6).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION create_adjustment(
    p_warehouse_id UUID,
    p_notes        TEXT,
    p_items        JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_role         TEXT;
    v_user_site    UUID;
    v_site_id      UUID;
    v_adj_id       UUID;
    v_numero       INTEGER;
    v_item         RECORD;
    v_delta        INTEGER;
    v_total        NUMERIC := 0;
    v_cost_before  NUMERIC;
    v_stock_before INTEGER;
    v_new_cost     NUMERIC;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado') THEN
        RAISE EXCEPTION 'Sin permisos para crear ajustes de inventario.';
    END IF;
    IF p_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'La bodega es obligatoria.';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'El ajuste no tiene ítems.';
    END IF;

    SELECT w.site_id INTO v_site_id
      FROM warehouses w WHERE w.warehouse_id = p_warehouse_id;
    IF v_site_id IS NULL THEN
        RAISE EXCEPTION 'La bodega % no existe o no tiene sede asignada.', p_warehouse_id;
    END IF;
    IF v_role = 'encargado' AND v_user_site IS DISTINCT FROM v_site_id THEN
        RAISE EXCEPTION 'Solo puedes crear ajustes en tu sede.';
    END IF;

    UPDATE adjustment_counters SET last_numero = last_numero + 1
     WHERE site_id = v_site_id RETURNING last_numero INTO v_numero;
    IF v_numero IS NULL THEN
        INSERT INTO adjustment_counters (site_id, last_numero) VALUES (v_site_id, 1)
          ON CONFLICT (site_id) DO UPDATE SET last_numero = adjustment_counters.last_numero + 1
          RETURNING last_numero INTO v_numero;
    END IF;

    SELECT COALESCE(SUM((i->>'cost')::NUMERIC * (i->>'quantity')::INTEGER), 0)
      INTO v_total FROM jsonb_array_elements(p_items) AS i;

    INSERT INTO inventory_adjustments
        (warehouse_id, site_id, notes, total_adjusted, created_by, numero)
    VALUES
        (p_warehouse_id, v_site_id, p_notes, v_total, v_uid, v_numero)
    RETURNING adjustment_id INTO v_adj_id;

    FOR v_item IN
        SELECT
            (i->>'product_id')::UUID    AS product_id,
            COALESCE((i->>'cost')::NUMERIC, 0) AS cost,
            (i->>'objective')::TEXT     AS objective,
            (i->>'quantity')::INTEGER   AS quantity
          FROM jsonb_array_elements(p_items) AS i
    LOOP
        IF v_item.product_id IS NULL THEN
            RAISE EXCEPTION 'Falta product_id en un ítem del ajuste.';
        END IF;
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'La cantidad debe ser > 0 (producto %).', v_item.product_id;
        END IF;
        IF v_item.cost < 0 THEN
            RAISE EXCEPTION 'El costo no puede ser negativo (producto %).', v_item.product_id;
        END IF;
        IF v_item.objective NOT IN ('incrementar','disminuir') THEN
            RAISE EXCEPTION 'Objective inválido: %.', v_item.objective;
        END IF;

        INSERT INTO adjustment_items
            (adjustment_id, product_id, cost, objective, quantity)
        VALUES
            (v_adj_id, v_item.product_id, v_item.cost, v_item.objective, v_item.quantity);

        -- =====================================================================
        -- WAC (D2, D5, D6) — solo incrementos con cost>0. Orden exacto del
        -- spec §5.1.1: LOCK products, READ stock global BEFORE, adjust
        -- kardex, calcular con valores BEFORE, UPDATE products.cost.
        -- =====================================================================
        IF v_item.objective = 'incrementar' AND v_item.cost > 0 THEN
            -- 1. Lock la fila de products del producto (serializa WAC
            -- concurrente sobre el mismo producto).
            SELECT cost INTO v_cost_before
              FROM products
             WHERE product_id = v_item.product_id
              FOR UPDATE;

            -- 2. Stock global (todas las bodegas) ANTES del delta. Ver
            -- spec §5.1.1 sobre la ventana de concurrencia con ventas.
            SELECT COALESCE(SUM(quantity), 0) INTO v_stock_before
              FROM product_stock
             WHERE product_id = v_item.product_id;
        END IF;

        v_delta := CASE WHEN v_item.objective = 'incrementar'
                        THEN  v_item.quantity ELSE -v_item.quantity END;

        -- 3. Kardex atómico por-cell.
        PERFORM adjust_warehouse_stock(
            v_item.product_id, p_warehouse_id, v_delta,
            'ajuste', 'adjustment', v_adj_id, v_uid, p_notes
        );

        -- 4. Recalcular WAC (post-adjust para asegurar que si adjust falla,
        -- no tocamos products.cost). Divisor siempre > 0 por quantity>0.
        IF v_item.objective = 'incrementar' AND v_item.cost > 0 THEN
            v_new_cost := (v_stock_before * COALESCE(v_cost_before, 0)
                          + v_item.quantity * v_item.cost)
                         / (v_stock_before + v_item.quantity);
            UPDATE products SET cost = v_new_cost
             WHERE product_id = v_item.product_id;
        END IF;
    END LOOP;

    RETURN v_adj_id;
END;
$$;

REVOKE ALL     ON FUNCTION create_adjustment(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_adjustment(UUID, TEXT, JSONB) TO authenticated;

COMMIT;
