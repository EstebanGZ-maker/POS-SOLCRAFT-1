-- 20261012000000_revoke_anon_from_internal_rpcs.sql
--
-- Cierra el acceso de rol `anon` a 10 RPCs internos que hoy tienen EXECUTE
-- heredado desde PUBLIC (ACL `=X/postgres`). Mantiene `place_web_order`
-- intacta: es la que el storefront público usa como anon (checkout).
--
-- Hallazgo de auditoría SECDEF (s28, 2026-10-12):
--   * Verificado con has_function_privilege que anon tiene EXECUTE efectivo
--     en las 11 funciones vía PUBLIC → `REVOKE ... FROM anon` solo no
--     alcanza; hay que REVOCAR también a PUBLIC.
--   * Exploitabilidad real al momento de aplicar: BAJA.
--       - Las 8 INVOKER están cubiertas por RLS: tablas con RLS enabled y
--         ZERO policies para anon → default-deny. Internamente devuelven
--         0 filas o RAISE EXCEPTION. No alteran inventario, no filtran
--         cifras.
--       - 2 DEFINER (create_web_order, public_place_order) sin referencias
--         en el repo (no están en uso). Se revocan por higiene; se dejan
--         vivas por si existe algún consumidor SQL no mapeado. Candidatas
--         a DROP en una limpieza posterior.
--   * `place_web_order` SÍ está activa en el storefront
--     (`lib/catalog-actions.ts:138`) → se preserva su EXECUTE para anon.
--
-- Idempotente:
--   - El bloque DO itera `pg_proc` por nombre dentro de `public`. Si una
--     función no existe en la instancia, simplemente no entra al loop.
--   - `pg_get_function_identity_arguments(oid)` resuelve sobrecargas: el
--     REVOKE/GRANT se aplica a CADA sobrecarga que exista con ese nombre.
--   - REVOKE/GRANT son no-op cuando el estado ya es el deseado.
--
-- Aplicar en AMBAS instancias (nxszaxwsrtlofqimbfig y aapchdjwpqhwsquffnxn).

DO $$
DECLARE
  v_target text;
  v_rec    record;
  v_sig    text;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    -- 8 INVOKER del backlog (candado adicional sobre RLS)
    'adjust_warehouse_stock',
    'transfer_stock',
    'decrement_product_stock',
    'receive_transfer_item',
    'send_transfer_via_transit',
    'next_product_code',
    'get_low_stock_products',
    'get_sales_summary',
    -- 2 DEFINER sin uso en el repo (quedan sin anon, no se dropean)
    'create_web_order',
    'public_place_order'
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
-- Verificación post-aplicación (correr aparte después de aplicar).
-- Las 10 revocadas deben dar is_anon_exec=false; place_web_order
-- debe seguir en true. authenticated y service_role deben estar
-- en true en TODAS.
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
--     'adjust_warehouse_stock','transfer_stock','decrement_product_stock',
--     'receive_transfer_item','send_transfer_via_transit','next_product_code',
--     'get_low_stock_products','get_sales_summary',
--     'create_web_order','public_place_order',
--     'place_web_order'
--   )
-- ORDER BY p.proname, args;
