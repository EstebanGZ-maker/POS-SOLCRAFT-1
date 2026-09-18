-- s27 — Alinear agrupación del catálogo por (name, price, category_id)
--
-- Contexto: el catálogo público mostraba una tarjeta por cada variante de
-- talla, generando duplicados visuales del mismo producto (mismo nombre,
-- mismo precio, misma categoría, distinta talla). Se agrupa cliente-side
-- en components/catalog/catalog-grid.tsx por (name, price, category_id),
-- pero el RPC public_catalog_list no devolvía category_id — se agrega acá.
--
-- Además se ALINEA public_product_sizes al mismo criterio de agrupación.
-- Antes usaba (type_prefix, name) — más laxa y desalineada con la fuente
-- única de categorización cerrada en s25. Cambiar a (name, price,
-- category_id) evita divergencia entre grid ("estas 3 son familia") y
-- ficha ("estas 5 son familia").
--
-- Impacto: getProductSizes es consumido SOLO por app/catalog/[code]/page.tsx
-- (verificado por grep antes de aplicar). Con los datos actuales el
-- comportamiento observable no cambia porque los productos que comparten
-- (type_prefix, name) casi siempre comparten también (price, category_id).
--
-- public_catalog_list agrega category_id a RETURNS TABLE — Postgres NO
-- permite CREATE OR REPLACE cuando cambia la lista de columnas de RETURNS
-- TABLE, así que DROP + CREATE. La firma de argumentos NO cambia (mismos
-- 7 params con mismos defaults), así que los consumidores (Supabase JS
-- client con .rpc()) siguen funcionando sin update.
--
-- public_product_sizes mantiene RETURNS TABLE idéntico, solo cambia el
-- JOIN interno — CREATE OR REPLACE alcanza para esa.

DROP FUNCTION IF EXISTS public.public_catalog_list(
  uuid, text, boolean, integer, integer, text, text
);

CREATE FUNCTION public.public_catalog_list(
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
             p.image_url, p.type_prefix, p.size, p.category_id
  )
  SELECT *
  FROM availability
  WHERE (p_search IS NULL OR p_search = ''
         OR name ILIKE '%' || p_search || '%'
         OR code ILIKE '%' || p_search || '%')
    AND (p_line IS NULL OR p_line = ''
         OR line = p_line
         OR category_id::text = p_line)
    AND (p_size IS NULL OR p_size = '' OR size = p_size)
    AND (NOT p_only_available OR is_available = TRUE)
  ORDER BY is_available DESC, name
  LIMIT p_limit OFFSET p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.public_product_sizes(p_code text)
RETURNS TABLE(code text, size text, price numeric, is_available boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT name, price, category_id
    FROM products WHERE code = p_code AND is_active LIMIT 1
  )
  SELECT
    p.code::TEXT,
    p.size::TEXT,
    p.price,
    COALESCE(SUM(CASE WHEN ps.quantity > 0 THEN 1 ELSE 0 END), 0) > 0 AS is_available
  FROM products p
  JOIN base b
    ON b.name IS NOT DISTINCT FROM p.name
   AND b.price IS NOT DISTINCT FROM p.price
   AND b.category_id IS NOT DISTINCT FROM p.category_id
  LEFT JOIN warehouses w ON w.is_public = TRUE
  LEFT JOIN product_stock ps
    ON ps.product_id = p.product_id AND ps.warehouse_id = w.warehouse_id
  WHERE p.is_active = TRUE
  GROUP BY p.code, p.size, p.price
  ORDER BY p.size;
$function$;
