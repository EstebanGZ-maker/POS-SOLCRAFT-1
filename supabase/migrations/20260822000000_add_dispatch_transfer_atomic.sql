-- =====================================================================
-- dispatch_transfer_atomic: despacha atómicamente un traslado pendiente.
--
-- Reemplaza el patrón vulnerable de loop TS (INSERT stock_movements + UPDATE
-- status en round-trips separados) que causó los 2 fantasmas de s18.
-- Todo en una sola transacción: validación de rol, guard de sede,
-- pre-check agregado de stock con FOR UPDATE, movimientos vía
-- send_transfer_via_transit, y flip de status a 'en_transito'.
--
-- Si cualquier paso falla (stock insuficiente detectado en el pre-check,
-- race que hace fallar adjust_warehouse_stock, error en el UPDATE), la
-- transacción entera se revierte y el traslado sigue en 'pendiente' —
-- nunca en un estado 'en_transito' sin movimientos detrás.
--
-- Autorización: doble capa. El TS que la llama ya validó rol + sede
-- accesible, pero este RPC es SECURITY DEFINER (bypasea RLS) y debe
-- defenderse solo por si algún caller futuro invoca directo.
--   - Rol: is_admin_or_encargado()
--   - Sede: has_site_access(sede origen del transfer)
-- Ambas usan auth.uid() del JWT — funcionan desde SECURITY DEFINER.
--
-- Retorno JSON:
--   OK:  { success: true, moved_items: N, status: 'en_transito' }
--   Err: { error: '...', insufficient_stock?: [{product_id, code, name,
--                                                needed, available}] }
-- =====================================================================
CREATE OR REPLACE FUNCTION public.dispatch_transfer_atomic(
  p_transfer_id uuid,
  p_user_id     uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'auth', 'extensions', 'pg_temp'
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
  -- 1. Autorización — rol.
  --    Contador NO despacha (mismo criterio que dispatchPendingTransfer TS).
  IF NOT is_admin_or_encargado() THEN
    RETURN json_build_object('error',
      'Solo un administrador o encargado puede despachar traslados.');
  END IF;

  -- 2. Lock del transfer + lectura de metadatos.
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

  -- 3. Autorización — sede de la bodega origen.
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

  -- 4. Bodega tránsito.
  SELECT warehouse_id INTO v_transit_wh
  FROM warehouses WHERE is_system = TRUE LIMIT 1;

  IF v_transit_wh IS NULL THEN
    RETURN json_build_object('error',
      'No se encontró la bodega de tránsito.');
  END IF;

  -- 5. Pre-check agregado con lock: SUM(quantity) por producto vs
  --    product_stock del origen. FOR UPDATE congela las filas relevantes
  --    hasta el commit, eliminando la race que existía entre pre-check
  --    TS y el loop de RPCs.
  --
  --    ORDER BY ps.product_id ANTES del FOR UPDATE: garantiza orden
  --    determinístico de adquisición de locks entre transacciones
  --    concurrentes. Sin esto, dos despachos simultáneos que comparten
  --    productos podrían tomarse locks en órdenes opuestos y deadlockear.
  --
  --    Colecta TODOS los faltantes en un array (mismo UX que el TS
  --    actual: no reporta de a uno).
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

  -- 6. Verificar que el traslado tenga ítems (defensa: un pendiente sin
  --    items no debería existir, pero no cuesta nada).
  IF NOT EXISTS (
    SELECT 1 FROM transfer_items WHERE transfer_id = p_transfer_id
  ) THEN
    RETURN json_build_object('error', 'El traslado no tiene ítems.');
  END IF;

  -- 7. Loop de despacho: PERFORM la RPC existente por cada línea.
  --    send_transfer_via_transit hace INSERT stock_movements + UPDATE
  --    product_stock vía adjust_warehouse_stock. Cualquier RAISE dentro
  --    revierte toda esta tx — incluidas las líneas anteriores.
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

  -- 8. Flip de estado. Este UPDATE y los INSERTs de stock_movements
  --    commitean juntos o revierten juntos — es la garantía anti-fantasma.
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

-- Permisos: mismo patrón que send_transfer_via_transit / reconcile_transfer.
REVOKE ALL ON FUNCTION public.dispatch_transfer_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_transfer_atomic(uuid, uuid) TO authenticated;
