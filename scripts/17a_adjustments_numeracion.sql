-- =============================================================================
-- 17a_adjustments_numeracion.sql — Ajustes Fase 2A (numeración).
--
-- Riesgo BAJO. Requiere: 16_inventory_adjustments_phase1.sql aplicado.
--
-- Alcance:
--   1. Tabla adjustment_counters (patrón site_counters) + seed por sede.
--   2. create_adjustment v2a: asigna numero atómicamente desde
--      adjustment_counters. Misma firma (UUID, TEXT, JSONB) que Fase 1 —
--      CREATE OR REPLACE, sin cambio de contrato para callers.
--
-- NO incluye WAC (Fase 2B) ni contabilidad con motivos (Fase 2C).
--
-- Backfill de numero para históricos: NO se hace (decisión del spec §7).
-- Los ajustes previos a esta migración quedan con numero=NULL.
--
-- Rollback: DROP FUNCTION + DROP TABLE al final, comentado.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. adjustment_counters — un contador por sede
-- =============================================================================

CREATE TABLE IF NOT EXISTS adjustment_counters (
    site_id     UUID PRIMARY KEY REFERENCES sites(site_id) ON DELETE CASCADE,
    last_numero INTEGER NOT NULL DEFAULT 0
);

-- Seed: una fila por sede existente. Idempotente.
INSERT INTO adjustment_counters (site_id, last_numero)
SELECT s.site_id, 0
  FROM sites s
 WHERE NOT EXISTS (
    SELECT 1 FROM adjustment_counters c WHERE c.site_id = s.site_id
 );

-- RLS: read a authenticated (para reportes de "próximo número"), escritura
-- cerrada (solo el RPC SECURITY DEFINER escribe).
ALTER TABLE adjustment_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "adjustment_counters_read" ON adjustment_counters;
CREATE POLICY "adjustment_counters_read" ON adjustment_counters
  FOR SELECT TO authenticated USING (true);

-- =============================================================================
-- 2. create_adjustment v2a — igual que Fase 1 pero asigna numero
-- =============================================================================

CREATE OR REPLACE FUNCTION create_adjustment(
    p_warehouse_id UUID,
    p_notes        TEXT,
    p_items        JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid        UUID := auth.uid();
    v_role       TEXT;
    v_user_site  UUID;
    v_site_id    UUID;
    v_adj_id     UUID;
    v_numero     INTEGER;
    v_item       RECORD;
    v_delta      INTEGER;
    v_total      NUMERIC := 0;
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
      FROM warehouses w
     WHERE w.warehouse_id = p_warehouse_id;
    IF v_site_id IS NULL THEN
        RAISE EXCEPTION 'La bodega % no existe o no tiene sede asignada.', p_warehouse_id;
    END IF;

    IF v_role = 'encargado' AND v_user_site IS DISTINCT FROM v_site_id THEN
        RAISE EXCEPTION 'Solo puedes crear ajustes en tu sede.';
    END IF;

    -- Numeración atómica por sede.
    UPDATE adjustment_counters
       SET last_numero = last_numero + 1
     WHERE site_id = v_site_id
    RETURNING last_numero INTO v_numero;

    IF v_numero IS NULL THEN
        -- Sede nueva sin fila en counters — seed on-the-fly.
        INSERT INTO adjustment_counters (site_id, last_numero)
        VALUES (v_site_id, 1)
        ON CONFLICT (site_id) DO UPDATE SET last_numero = adjustment_counters.last_numero + 1
        RETURNING last_numero INTO v_numero;
    END IF;

    SELECT COALESCE(SUM(
             (i->>'cost')::NUMERIC * (i->>'quantity')::INTEGER
           ), 0)
      INTO v_total
      FROM jsonb_array_elements(p_items) AS i;

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
            RAISE EXCEPTION 'Objective inválido: % (esperado incrementar|disminuir).', v_item.objective;
        END IF;

        INSERT INTO adjustment_items
            (adjustment_id, product_id, cost, objective, quantity)
        VALUES
            (v_adj_id, v_item.product_id, v_item.cost, v_item.objective, v_item.quantity);

        v_delta := CASE WHEN v_item.objective = 'incrementar'
                        THEN  v_item.quantity
                        ELSE -v_item.quantity END;

        PERFORM adjust_warehouse_stock(
            v_item.product_id,
            p_warehouse_id,
            v_delta,
            'ajuste',
            'adjustment',
            v_adj_id,
            v_uid,
            p_notes
        );
    END LOOP;

    RETURN v_adj_id;
END;
$$;

REVOKE ALL     ON FUNCTION create_adjustment(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_adjustment(UUID, TEXT, JSONB) TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK manual:
-- BEGIN;
-- CREATE OR REPLACE FUNCTION create_adjustment(...)  -- restaurar cuerpo de Fase 1
-- DROP TABLE IF EXISTS adjustment_counters;
-- COMMIT;
-- =============================================================================
