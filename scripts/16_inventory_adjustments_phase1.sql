-- =============================================================================
-- 16_inventory_adjustments_phase1.sql — Ajustes de inventario, Fase 1.
--
-- Alcance (spec: docs/INVENTORY-ADJUSTMENTS-SPEC.md):
--   1. ALTER inventory_adjustments COMPLETO (esquema listo para Fase 2 sin
--      migración adicional): site_id, numero, status, motivo, created_by,
--      updated_at. `numero` y `motivo` quedan NULL/inertes en Fase 1.
--   2. Backfill de site_id para históricos.
--   3. Índice único parcial de numeración (inerte hasta Fase 2).
--   4. Trigger updated_at (patrón existente del repo).
--   5. RPC atómico create_adjustment (SECDEF + auth.uid() + rol/sede).
--      Reemplaza el Promise.all no-transaccional actual. NO toca contabilidad
--      ni costo (queda para Fase 2). Comportamiento contable idéntico al
--      createAdjustment actual (o sea, no asienta nada).
--   6. RPC atómico void_adjustment (SECDEF). Reemplaza deleteAdjustment.
--      Marca status='voided' + revierte stock. Sin asiento compensatorio ni
--      warning de WAC (esos van en Fase 2).
--   7. Cerrar RLS de escritura de inventory_adjustments y adjustment_items.
--      Escritura EXCLUSIVA vía RPC.
--
-- FUERA DE ALCANCE (Fase 2):
--   - Cableado de motivo → asiento contable (compra/sobrante/correccion).
--   - Recálculo WAC en products.cost.
--   - adjustment_counters + generación de numero.
--   - FK adjustment_id en accounting_entries.
--   - Migrar ingressNewProduct al RPC común.
--
-- FUERA DE ALCANCE (código app, mismo commit):
--   - Server Actions createAdjustment/deleteAdjustment pasan a delegar al RPC
--     (firma pública sin cambio).
--   - receiveMerchandise sigue delegando a createAdjustment (sin cambio).
--   - getAdjustments filtra WHERE status='active' para preservar la lista
--     visible al usuario (los voided desaparecen de la UI como con DELETE).
--
-- Rollback: DROP FUNCTIONs al final, comentado. La reversión de columnas
-- requiere DROP COLUMN + restaurar policies antiguas.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. inventory_adjustments — nuevas columnas
-- =============================================================================

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS site_id    UUID REFERENCES sites(site_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS numero     INTEGER,
  ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS motivo     TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- CHECKs idempotentes.
DO $ck_status$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_adjustments_status_check'
      AND table_name = 'inventory_adjustments'
  ) THEN
    ALTER TABLE inventory_adjustments
      ADD CONSTRAINT inventory_adjustments_status_check
      CHECK (status IN ('active','voided'));
  END IF;
END
$ck_status$;

DO $ck_motivo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_adjustments_motivo_check'
      AND table_name = 'inventory_adjustments'
  ) THEN
    ALTER TABLE inventory_adjustments
      ADD CONSTRAINT inventory_adjustments_motivo_check
      CHECK (motivo IS NULL OR motivo IN ('compra','sobrante','correccion'));
  END IF;
END
$ck_motivo$;

-- Backfill: derivar site_id desde warehouse_id para históricos.
UPDATE inventory_adjustments a
   SET site_id = w.site_id
  FROM warehouses w
 WHERE a.warehouse_id = w.warehouse_id
   AND a.site_id IS NULL;

-- Numeración: única por (site_id, numero) cuando numero no es NULL.
-- Inerte hasta que Fase 2 empiece a llenarla.
CREATE UNIQUE INDEX IF NOT EXISTS idx_adjustments_numero_site
  ON inventory_adjustments (site_id, numero)
  WHERE numero IS NOT NULL;

-- Trigger updated_at — reutiliza update_updated_at_column() que ya existe
-- (definida en 00_schema.sql para customers/products/product_stock).
DROP TRIGGER IF EXISTS update_inventory_adjustments_updated_at ON inventory_adjustments;
CREATE TRIGGER update_inventory_adjustments_updated_at
  BEFORE UPDATE ON inventory_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. RLS: cerrar escritura de inventory_adjustments y adjustment_items.
--    A partir de aquí solo escribe el RPC SECURITY DEFINER.
-- =============================================================================

DROP POLICY IF EXISTS "inventory_adjustments_write"  ON inventory_adjustments;
DROP POLICY IF EXISTS "inventory_adjustments_update" ON inventory_adjustments;
-- SELECT queda como está (patrón permisivo actual).

DROP POLICY IF EXISTS "adjustment_items_write"  ON adjustment_items;
DROP POLICY IF EXISTS "adjustment_items_update" ON adjustment_items;

-- =============================================================================
-- 3. RPC create_adjustment — atómico, SECURITY DEFINER, sin contabilidad
-- =============================================================================

CREATE OR REPLACE FUNCTION create_adjustment(
    p_warehouse_id UUID,
    p_notes        TEXT,
    p_items        JSONB    -- [{ product_id, cost, objective, quantity }]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid        UUID := auth.uid();
    v_role       TEXT;
    v_user_site  UUID;
    v_site_id    UUID;
    v_adj_id     UUID;
    v_item       RECORD;
    v_delta      INTEGER;
    v_total      NUMERIC := 0;
    v_item_count INTEGER;
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

    -- Resolver la sede desde la bodega.
    SELECT w.site_id INTO v_site_id
      FROM warehouses w
     WHERE w.warehouse_id = p_warehouse_id;
    IF v_site_id IS NULL THEN
        RAISE EXCEPTION 'La bodega % no existe o no tiene sede asignada.', p_warehouse_id;
    END IF;

    -- encargado solo puede ajustar en su sede.
    IF v_role = 'encargado' AND v_user_site IS DISTINCT FROM v_site_id THEN
        RAISE EXCEPTION 'Solo puedes crear ajustes en tu sede.';
    END IF;

    -- Total del ajuste (SUM(cost * quantity), sin importar objective —
    -- refleja el valor movido, no un ingreso/egreso neto).
    SELECT COALESCE(SUM(
             (i->>'cost')::NUMERIC * (i->>'quantity')::INTEGER
           ), 0),
           COUNT(*)
      INTO v_total, v_item_count
      FROM jsonb_array_elements(p_items) AS i;

    -- Insertar header. motivo y numero quedan NULL en Fase 1 (cablearán en
    -- Fase 2). status='active' por default. created_by=auth.uid().
    INSERT INTO inventory_adjustments
        (warehouse_id, site_id, notes, total_adjusted, created_by)
    VALUES
        (p_warehouse_id, v_site_id, p_notes, v_total, v_uid)
    RETURNING adjustment_id INTO v_adj_id;

    -- Iterar ítems: validar, insertar item, mover kardex.
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

        -- Kardex atómico por-cell. adjust_warehouse_stock RAISE si stock
        -- quedaría negativo; el RAISE aborta la transacción entera.
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

-- =============================================================================
-- 4. RPC void_adjustment — atómico, SECURITY DEFINER, solo stock
-- =============================================================================

CREATE OR REPLACE FUNCTION void_adjustment(
    p_adjustment_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid        UUID := auth.uid();
    v_role       TEXT;
    v_user_site  UUID;
    v_adj        RECORD;
    v_item       RECORD;
    v_delta      INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado') THEN
        RAISE EXCEPTION 'Sin permisos para anular ajustes.';
    END IF;

    -- Lock del header para evitar carrera con otra anulación / edición.
    SELECT adjustment_id, warehouse_id, site_id, status
      INTO v_adj
      FROM inventory_adjustments
     WHERE adjustment_id = p_adjustment_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ajuste no encontrado.';
    END IF;
    IF v_adj.status = 'voided' THEN
        RAISE EXCEPTION 'El ajuste ya está anulado.';
    END IF;
    IF v_role = 'encargado' AND v_user_site IS DISTINCT FROM v_adj.site_id THEN
        RAISE EXCEPTION 'Solo puedes anular ajustes de tu sede.';
    END IF;

    -- Marcar voided. El trigger updated_at se dispara solo.
    UPDATE inventory_adjustments
       SET status = 'voided'
     WHERE adjustment_id = p_adjustment_id;

    -- Reversar kardex por-ítem con delta invertido.
    FOR v_item IN
        SELECT product_id, objective, quantity
          FROM adjustment_items
         WHERE adjustment_id = p_adjustment_id
    LOOP
        v_delta := CASE WHEN v_item.objective = 'incrementar'
                        THEN -v_item.quantity
                        ELSE  v_item.quantity END;

        PERFORM adjust_warehouse_stock(
            v_item.product_id,
            v_adj.warehouse_id,
            v_delta,
            'ajuste',
            'adjustment',
            p_adjustment_id,
            v_uid,
            'Reversión por anulación de ajuste'
        );
    END LOOP;
END;
$$;

REVOKE ALL     ON FUNCTION void_adjustment(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION void_adjustment(UUID) TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK manual (correr solo si algo se rompe post-aplicación):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS void_adjustment(UUID);
-- DROP FUNCTION IF EXISTS create_adjustment(UUID, TEXT, JSONB);
--
-- -- Restaurar policies antiguas de escritura:
-- CREATE POLICY "inventory_adjustments_write" ON inventory_adjustments
--   FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
-- CREATE POLICY "inventory_adjustments_update" ON inventory_adjustments
--   FOR UPDATE TO authenticated USING (is_admin_or_encargado());
-- CREATE POLICY "adjustment_items_write" ON adjustment_items
--   FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
-- CREATE POLICY "adjustment_items_update" ON adjustment_items
--   FOR UPDATE TO authenticated USING (is_admin_or_encargado());
--
-- -- DROP de columnas requiere que estés seguro de no perder trazabilidad
-- -- (status='voided' se pierde). Solo si el rollback es total.
-- -- DROP TRIGGER IF EXISTS update_inventory_adjustments_updated_at ON inventory_adjustments;
-- -- DROP INDEX IF EXISTS idx_adjustments_numero_site;
-- -- ALTER TABLE inventory_adjustments
-- --   DROP COLUMN IF EXISTS updated_at,
-- --   DROP COLUMN IF EXISTS created_by,
-- --   DROP COLUMN IF EXISTS motivo,
-- --   DROP COLUMN IF EXISTS status,
-- --   DROP COLUMN IF EXISTS numero,
-- --   DROP COLUMN IF EXISTS site_id;
-- COMMIT;
-- =============================================================================
