-- s24 — Modelo 3D del hero configurable por instancia
--
-- Agrega `catalog_model_url` a business_settings + crea el bucket
-- `catalog-assets` para alojar los .glb (y en el futuro otros assets
-- grandes del catálogo, tipo logo hi-res).
--
-- Fallback en TS: si `catalog_model_url` es null/"", el hero renderiza
-- el diamante procedural (sin GLB, sin BackgroundLogo). No hay .glb
-- estático en /public: cada instancia sube el suyo.
--
-- El bucket es público (SELECT abierto) porque el catálogo se sirve
-- sin sesión. INSERT/UPDATE/DELETE gated por is_admin() — solo el
-- admin toca branding.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS catalog_model_url text;

CREATE OR REPLACE FUNCTION public.public_commerce_config()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'business_name', business_name,
    'phone', phone,
    'email', email,
    'address', address,
    'logo_url', logo_url,
    'whatsapp_number', whatsapp_number,
    'whatsapp_enabled', COALESCE(whatsapp_enabled, TRUE),
    'cod_enabled', COALESCE(cod_enabled, TRUE),
    'wompi_enabled', COALESCE(wompi_enabled, FALSE),
    'wompi_public_key', wompi_public_key,
    'pickup_enabled', COALESCE(pickup_enabled, TRUE),
    'delivery_enabled', COALESCE(delivery_enabled, TRUE),
    'shipping_cost', COALESCE(shipping_cost, 0),
    'free_shipping_over', free_shipping_over,
    'catalog_tagline', catalog_tagline,
    'catalog_hero_subtitle', catalog_hero_subtitle,
    'catalog_store_title', catalog_store_title,
    'catalog_model_url', catalog_model_url
  )
  FROM business_settings WHERE id = 1;
$function$;

-- Bucket para assets del catálogo (modelo 3D, en el futuro logos hi-res,
-- etc.). 100 MB por archivo, MIMEs para .glb (algunos browsers/OS lo
-- entregan como octet-stream) e imágenes por si más adelante migramos
-- logo_url acá también.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'catalog-assets',
  'catalog-assets',
  true,
  104857600,
  ARRAY['model/gltf-binary', 'application/octet-stream',
        'image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies: SELECT público, INSERT/UPDATE/DELETE solo admin.
DROP POLICY IF EXISTS "catalog_assets_public_read" ON storage.objects;
CREATE POLICY "catalog_assets_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'catalog-assets');

DROP POLICY IF EXISTS "catalog_assets_admin_insert" ON storage.objects;
CREATE POLICY "catalog_assets_admin_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'catalog-assets' AND public.is_admin());

DROP POLICY IF EXISTS "catalog_assets_admin_update" ON storage.objects;
CREATE POLICY "catalog_assets_admin_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'catalog-assets' AND public.is_admin());

DROP POLICY IF EXISTS "catalog_assets_admin_delete" ON storage.objects;
CREATE POLICY "catalog_assets_admin_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'catalog-assets' AND public.is_admin());
