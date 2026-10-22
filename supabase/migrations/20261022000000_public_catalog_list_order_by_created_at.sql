-- Migración: public_catalog_list ordena por "más nuevo primero".
-- Fecha: 2026-10-22
-- Motivo: el catálogo público mostraba los productos recién ingresados hasta
--         al final del listado (orden por nombre). Pasamos a
--         ORDER BY is_available DESC, created_at DESC, name
--         para que lo nuevo con stock aparezca arriba sin romper el
--         ordenamiento alfabético como desempate.
-- Base: md5(pg_get_functiondef) = c5f5c22991a2c537cbae140c7bd7dd3e en las 3
--       instancias (verificado 2026-10-22, pre-overwrite).
-- Scope: NO cambia firma ni columnas de RETURNS TABLE. Solo:
--        - agrega p.created_at al CTE `availability` (y al GROUP BY),
--          sin exponerlo en el SELECT final.
--        - reemplaza `ORDER BY is_available DESC, name` por
--          `ORDER BY is_available DESC, created_at DESC, name`.
-- Permisos: mantiene SECURITY DEFINER + search_path + GRANT a anon
--           (es RPC público del storefront, acceso anon esperado).
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.public_catalog_list(
  p_site_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_only_available boolean DEFAULT false,
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0,
  p_line text DEFAULT NULL::text,
  p_size text DEFAULT NULL::text
)
RETURNS TABLE(
  product_id uuid,
  code text,
  name text,
  price numeric,
  description text,
  image_url text,
  line text,
  size text,
  category_id uuid,
  available_sites text[],
  is_available boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  WITH availability AS (
    SELECT
      p.product_id,
      p.code::TEXT AS code,
      p.name::TEXT AS name,
      p.price,
      p.description,
      p.image_url,
      p.type_prefix::TEXT AS line,
      p.size::TEXT AS size,
      p.category_id,
      p.created_at,
      COALESCE(
        ARRAY_AGG(DISTINCT s.name::TEXT ORDER BY s.name::TEXT)
          FILTER (WHERE s.name IS NOT NULL AND ps.quantity > 0),
        ARRAY[]::TEXT[]
      ) AS available_sites,
      COALESCE(SUM(CASE
        WHEN p_site_id IS NULL AND ps.quantity > 0 THEN 1
        WHEN p_site_id IS NOT NULL AND s.site_id = p_site_id AND ps.quantity > 0 THEN 1
        ELSE 0 END), 0) > 0 AS is_available
    FROM products p
    LEFT JOIN warehouses w ON w.is_public = TRUE
    LEFT JOIN sites s ON s.site_id = w.site_id
    LEFT JOIN product_stock ps
      ON ps.product_id = p.product_id AND ps.warehouse_id = w.warehouse_id
    WHERE p.is_active = TRUE
    GROUP BY p.product_id, p.code, p.name, p.price, p.description,
             p.image_url, p.type_prefix, p.size, p.category_id, p.created_at
  )
  SELECT
    product_id, code, name, price, description, image_url,
    line, size, category_id, available_sites, is_available
  FROM availability
  WHERE (p_search IS NULL OR p_search = ''
         OR name ILIKE '%' || p_search || '%'
         OR code ILIKE '%' || p_search || '%')
    AND (p_line IS NULL OR p_line = ''
         OR line = p_line
         OR category_id::text = p_line)
    AND (p_size IS NULL OR p_size = '' OR size = p_size)
    AND (NOT p_only_available OR is_available = TRUE)
  ORDER BY is_available DESC, created_at DESC, name
  LIMIT p_limit OFFSET p_offset;
$function$;
