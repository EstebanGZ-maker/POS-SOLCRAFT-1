-- 20261012000001_revoke_anon_from_definer_rpcs_with_guards.sql
--
-- Segunda tanda del endurecimiento SECDEF (continúa de
-- 20261012000000_revoke_anon_from_internal_rpcs). Cierra el acceso de
-- `anon`/`PUBLIC` a 5 RPCs DEFINER que ya tienen guard interno pero cuyo
-- EXECUTE sigue abierto a anon (Supabase otorga EXECUTE a anon por default
-- privileges al crear funciones en `public`; "REVOKE FROM PUBLIC" en las
-- migraciones originales no cubre esto).
--
-- Hallazgos de auditoría (s28, 2026-10-12):
--
--   - list_orphan_product_media: DEFINER, SQL stable, SIN guard interno.
--     Hoy anon puede listar nombres de blobs huérfanos del bucket
--     product-media. Baja sensibilidad (metadata, no contenido), pero no
--     debería ser pública. Única con exposición no cubierta por guard.
--
--   - dispatch_transfer_atomic: DEFINER con
--       IF NOT is_admin_or_encargado() THEN RETURN error.
--     Rechaza anon (auth.uid()=NULL → helpers devuelven false). REVOKE
--     adicional por defensa en profundidad.
--
--   - import_products_bulk_atomic: DEFINER con
--       IF NOT is_admin_or_encargado() THEN RAISE EXCEPTION 42501.
--     Mismo caso. REVOKE por defensa.
--
--   - receive_transfer: DEFINER con
--       IF NOT (is_admin() OR (user_role()='encargado'
--                              AND has_site_access(v_dest_site))) THEN RETURN error.
--     Mismo caso. REVOKE por defensa.
--
--   - reconcile_transfer: DEFINER con
--       IF NOT (is_admin() OR user_role()='contador') THEN RETURN error.
--     Mismo caso. REVOKE por defensa.
--
-- Fuera de scope por diseño (NO tocar):
--   - public_* catálogo, place_web_order, public_get_order,
--     public_web_order_lookup: anon debe ejecutarlas (storefront público).
--   - is_admin, has_permission, has_site_access, user_role, is_global_role,
--     user_accessible_sites: helpers que usan las policies de RLS.
--   - sync_product_primary_image: trigger function (no se invoca por API).
--
-- Idempotente (misma mecánica que 20261012000000): bloque DO que itera
-- pg_proc por nombre y arma cada REVOKE/GRANT con
-- pg_get_function_identity_arguments.
--
-- Aplicar en AMBAS instancias (nxszaxwsrtlofqimbfig y aapchdjwpqhwsquffnxn).

DO $$
DECLARE
  v_target text;
  v_rec    record;
  v_sig    text;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    'list_orphan_product_media',
    'dispatch_transfer_atomic',
    'import_products_bulk_atomic',
    'receive_transfer',
    'reconcile_transfer'
  ] LOOP
    FOR v_rec IN
      SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_target
    LOOP
      v_sig := format('public.%I(%s)', v_target, v_rec.args);
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon;',
        v_sig
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;',
        v_sig
      );
      RAISE NOTICE 'Secured: %', v_sig;
    END LOOP;
  END LOOP;
END
$$;

-- =============================================================
-- Verificación post-aplicación (correr aparte):
-- Las 5 deben dar anon_exec=false; auth_exec y svc_exec en true.
-- =============================================================
--
-- SELECT
--   p.proname,
--   pg_get_function_identity_arguments(p.oid) AS args,
--   has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--   has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'list_orphan_product_media','dispatch_transfer_atomic',
--     'import_products_bulk_atomic','receive_transfer','reconcile_transfer'
--   )
-- ORDER BY p.proname, args;
