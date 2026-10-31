-- Migración: congelar costo al despachar un traslado (paso 1 de 2).
-- Fecha: 2026-10-31
-- Scope DB solamente. UI va en el paso 2.
--
-- Decisiones de Esteban:
--   - "Valor" del traslado = COSTO (no precio de venta).
--   - Se congela al momento del DESPACHO (status pendiente → en_transito).
--   - Traslados cancelados no suman en ninguna sumatoria del valor.
--   - Solo roles admin y contador verán valores en la UI (paso 2).
--
-- Cambios de DB (todos idempotentes):
--   1. transfer_items: nuevas columnas `unit_cost numeric(14,2) NULL` y
--      `cost_is_estimated boolean NOT NULL DEFAULT false`. Las dos usan
--      ADD COLUMN IF NOT EXISTS; segunda corrida es no-op.
--   2. Backfill: para los traslados existentes se setea
--      `unit_cost = products.cost actual, cost_is_estimated = true`
--      SOLO donde `unit_cost IS NULL`. Esto queda explícito como
--      "estimado": el costo real del momento del despacho no se conservó
--      para esos traslados viejos (dato perdido).
--   3. `dispatch_transfer_atomic`: `CREATE OR REPLACE` del cuerpo actual
--      agregando un UPDATE que, para TODOS los ítems del traslado,
--      congela `unit_cost = products.cost` y `cost_is_estimated = false`
--      ANTES del loop de `send_transfer_via_transit`. El cuerpo se extrajo
--      con `pg_get_functiondef` (regla 4) y solo se agrega ese UPDATE.
--      Sin DROP (preserva REVOKE EXECUTE de 20261012000001).
--
--   4. Trigger de inmutabilidad: `enforce_transfer_item_cost_frozen()` +
--      `trg_enforce_transfer_item_cost_frozen BEFORE UPDATE ON transfer_items`.
--      Rechaza cualquier UPDATE que cambie `unit_cost` o `cost_is_estimated`
--      salvo que lo haga `postgres` o `service_role` (dispatch SECDEF corre
--      como postgres; el backfill de esta migración también). SECURITY
--      INVOKER (necesita el `current_user` real). REVOKE EXECUTE a
--      PUBLIC/anon/authenticated — nadie debe invocarla fuera del trigger.
--
-- NO se toca `receive_transfer`, `reconcile_transfer`, `transfer_stock`,
-- `send_transfer_via_transit`, `receive_transfer_item` ni la tabla
-- `transfers`: la recepción no debe recomputar costo (ya está congelado al
-- despacho) y las cancelaciones se filtran en las sumatorias por `status`.
--
-- Diagnóstico pre-apply (md5 normalizado, 3 instancias):
--   dispatch_transfer_atomic md5_norm = 0fed4f6aec0a1657719980292ce0f928
--     (Solcraft = Taiwy = celulares) → mismo cuerpo lógico, OK para
--     reemplazar con el mismo script en las 3.
--   send_transfer_via_transit md5_norm = e0e33733cd673c6bbbfdec642480023e
--     (Solcraft = Taiwy = celulares) → no se toca.

-- 1. Nuevas columnas.
ALTER TABLE public.transfer_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,2) NULL;

ALTER TABLE public.transfer_items
  ADD COLUMN IF NOT EXISTS cost_is_estimated boolean NOT NULL DEFAULT false;

-- 2. Backfill de los ítems existentes sin unit_cost. Solo pisa NULL.
UPDATE public.transfer_items ti
   SET unit_cost = p.cost,
       cost_is_estimated = true
  FROM public.products p
 WHERE ti.product_id = p.product_id
   AND ti.unit_cost IS NULL;

-- 3. CREATE OR REPLACE de dispatch_transfer_atomic. Mismo cuerpo que la
--    versión actual (verificado md5_norm idéntico en las 3 instancias),
--    con un UPDATE adicional que congela unit_cost y cost_is_estimated.
CREATE OR REPLACE FUNCTION public.dispatch_transfer_atomic(p_transfer_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_transfer     RECORD;
  v_from_site    UUID;
  v_transit_wh   UUID;
  v_caller       UUID := COALESCE(p_user_id, auth.uid());
  v_item         RECORD;
  v_shortfalls   JSONB := '[]'::jsonb;
  v_moved        INTEGER := 0;
BEGIN
  IF NOT is_admin_or_encargado() THEN
    RETURN json_build_object('error',
      'Solo un administrador o encargado puede despachar traslados.');
  END IF;

  SELECT t.transfer_id, t.status, t.from_warehouse_id, t.to_warehouse_id,
         t.sent_by
    INTO v_transfer
  FROM transfers t
  WHERE t.transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Traslado no encontrado.');
  END IF;

  IF v_transfer.status <> 'pendiente' THEN
    RETURN json_build_object('error',
      format('El traslado no está pendiente (estado actual: "%s").',
             v_transfer.status));
  END IF;

  SELECT site_id INTO v_from_site
  FROM warehouses
  WHERE warehouse_id = v_transfer.from_warehouse_id;

  IF v_from_site IS NULL THEN
    RETURN json_build_object('error',
      'La bodega de origen no tiene sede asociada.');
  END IF;

  IF NOT has_site_access(v_from_site) THEN
    RETURN json_build_object('error',
      'No tienes acceso a la sede de origen de este traslado.');
  END IF;

  SELECT warehouse_id INTO v_transit_wh
  FROM warehouses WHERE is_system = TRUE LIMIT 1;

  IF v_transit_wh IS NULL THEN
    RETURN json_build_object('error',
      'No se encontró la bodega de tránsito.');
  END IF;

  FOR v_item IN
    WITH needed AS (
      SELECT ti.product_id,
             SUM(ti.quantity)::INTEGER AS need_qty
      FROM transfer_items ti
      WHERE ti.transfer_id = p_transfer_id
      GROUP BY ti.product_id
    ),
    locked_stock AS (
      SELECT ps.product_id,
             ps.quantity
      FROM product_stock ps
      WHERE ps.warehouse_id = v_transfer.from_warehouse_id
        AND ps.product_id IN (SELECT product_id FROM needed)
      ORDER BY ps.product_id
      FOR UPDATE
    )
    SELECT n.product_id,
           n.need_qty,
           COALESCE(ls.quantity, 0) AS have_qty,
           p.code,
           p.name
    FROM needed n
    LEFT JOIN locked_stock ls ON ls.product_id = n.product_id
    LEFT JOIN products p      ON p.product_id  = n.product_id
    WHERE COALESCE(ls.quantity, 0) < n.need_qty
  LOOP
    v_shortfalls := v_shortfalls || jsonb_build_object(
      'product_id', v_item.product_id,
      'code',       v_item.code,
      'name',       v_item.name,
      'needed',     v_item.need_qty,
      'available',  v_item.have_qty
    );
  END LOOP;

  IF jsonb_array_length(v_shortfalls) > 0 THEN
    RETURN json_build_object(
      'error', 'Stock insuficiente en la bodega origen. No se despachó nada.',
      'insufficient_stock', v_shortfalls
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM transfer_items WHERE transfer_id = p_transfer_id
  ) THEN
    RETURN json_build_object('error', 'El traslado no tiene ítems.');
  END IF;

  -- Congelar costo del momento del despacho sobre TODOS los ítems del
  -- traslado (pisa cualquier estimación previa que haya quedado del
  -- flujo de creación). cost_is_estimated=false marca que éste es el
  -- costo real al despachar.
  UPDATE transfer_items ti
     SET unit_cost = p.cost,
         cost_is_estimated = false
    FROM products p
   WHERE ti.transfer_id = p_transfer_id
     AND ti.product_id = p.product_id;

  FOR v_item IN
    SELECT transfer_item_id, product_id, quantity
    FROM transfer_items
    WHERE transfer_id = p_transfer_id
    ORDER BY transfer_item_id
  LOOP
    PERFORM send_transfer_via_transit(
      v_item.product_id,
      v_transfer.from_warehouse_id,
      v_transit_wh,
      v_item.quantity,
      p_transfer_id,
      v_caller
    );
    v_moved := v_moved + 1;
  END LOOP;

  UPDATE transfers
  SET status  = 'en_transito',
      sent_by = COALESCE(sent_by, v_caller)
  WHERE transfer_id = p_transfer_id;

  RETURN json_build_object(
    'success',     true,
    'moved_items', v_moved,
    'status',      'en_transito'
  );
END $function$;

-- 4. Trigger de inmutabilidad del costo congelado.
CREATE OR REPLACE FUNCTION public.enforce_transfer_item_cost_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
     OR NEW.cost_is_estimated IS DISTINCT FROM OLD.cost_is_estimated THEN
    RAISE EXCEPTION
      'El costo de un traslado se congela al despacharlo y no se puede modificar.';
  END IF;
  RETURN NEW;
END $function$;

REVOKE EXECUTE ON FUNCTION public.enforce_transfer_item_cost_frozen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_transfer_item_cost_frozen ON public.transfer_items;
CREATE TRIGGER trg_enforce_transfer_item_cost_frozen
  BEFORE UPDATE ON public.transfer_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_transfer_item_cost_frozen();
