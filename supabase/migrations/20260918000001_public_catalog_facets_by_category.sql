-- s25 — Reescribir public_catalog_facets para agrupar por category_id.
--
-- Esta migración se APLICÓ en producción el 2026-08-31 21:57:28 UTC a
-- ambas instancias (nxszaxwsrtlofqimbfig y aapchdjwpqhwsquffnxn) vía el
-- MCP de Supabase con el nombre `catalog_facets_by_category`, pero NUNCA
-- se versionó en `supabase/migrations/`. Durante el aprovisionamiento de
-- `celulares-carmen` el 2026-10-14 se detectó la deriva (hash del repo
-- vs hash de Taiwy Sport para `public_catalog_facets` no coincidía).
-- Se recupera acá el SQL exacto del `statements[1]` de
-- `supabase_migrations.schema_migrations` de Taiwy Sport (versión
-- `20260831215728`) y se formaliza como migración versionada para que
-- clientes futuros nazcan con la versión correcta.
--
-- La migración original de MCP incluía además un segundo CREATE OR
-- REPLACE para `public_catalog_list` que agregaba `category_id` al
-- filtro `p_line`. ESE BLOQUE NO SE INCLUYE acá porque la migración
-- `20260918000000_align_catalog_grouping_by_name_price_category.sql`
-- ya reescribió `public_catalog_list` con el shape final (RETURNS
-- TABLE con la columna `category_id` expuesta). Re-aplicar la versión
-- de 2026-08-31 regresaría a un RETURNS TABLE sin `category_id` y
-- rompería `catalog-grid.tsx`.
--
-- La función queda como SECURITY DEFINER con search_path controlado;
-- EXECUTE a anon se mantiene por diseño (es RPC del storefront
-- público).

CREATE OR REPLACE FUNCTION public.public_catalog_facets()
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'lines', COALESCE((
      SELECT json_agg(
        json_build_object('code', t.category_id::text, 'name', c.name, 'count', t.n)
        ORDER BY c.name
      )
      FROM (
        SELECT p.category_id, COUNT(*) AS n
        FROM products p
        WHERE p.is_active AND p.category_id IS NOT NULL
        GROUP BY p.category_id
      ) t
      JOIN categories c ON c.category_id = t.category_id
    ), '[]'::json),
    'sizes', COALESCE((
      SELECT json_agg(DISTINCT size::TEXT ORDER BY size::TEXT)
      FROM products WHERE is_active AND size IS NOT NULL
    ), '[]'::json)
  );
$function$;
