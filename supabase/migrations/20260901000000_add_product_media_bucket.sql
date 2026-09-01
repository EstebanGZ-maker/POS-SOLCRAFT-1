-- s26 — Bucket product-media (fotos de productos)
--
-- Reproduce la configuración del bucket `product-media` de la instancia
-- baseline (nxszaxwsrtlofqimbfig). Se detectó en 2026-09-01 que la
-- instancia de Taiwy Sport (aapchdjwpqhwsquffnxn) fue aprovisionada sin
-- este bucket — el panel de Ingreso IA creó productos sin foto porque
-- no había dónde guardar las imágenes (image_url quedaba en null y el
-- upload fallaba silenciosamente). El bucket `catalog-assets` sí existía
-- porque se creó después vía la migración 20260826000001.
--
-- Config exacta del bucket (5 MB, MIMEs de imagen web):
--   - id/name: product-media
--   - public: true (SELECT abierto — la landing/catalog lee sin sesión)
--   - file_size_limit: 5242880 bytes (5 MB)
--   - allowed_mime_types: image/jpeg, image/png, image/webp, image/avif
--
-- Policies (mismo patrón que catalog-assets):
--   - SELECT público (bucket_id filter)
--   - INSERT/UPDATE/DELETE gated por is_admin_or_encargado() — encargados
--     de sede también suben foto de producto desde inventario.
--
-- ON CONFLICT DO NOTHING en el bucket para NO pisar file_size_limit si
-- alguien lo ajustó a mano para un cliente puntual (criterio explícito
-- discutido en la sesión 2026-09-01).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-media',
  'product-media',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/avif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS public_read_product_media ON storage.objects;
CREATE POLICY public_read_product_media
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS product_media_write_staff ON storage.objects;
CREATE POLICY product_media_write_staff
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-media' AND is_admin_or_encargado());

DROP POLICY IF EXISTS product_media_update_staff ON storage.objects;
CREATE POLICY product_media_update_staff
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-media' AND is_admin_or_encargado())
  WITH CHECK (bucket_id = 'product-media' AND is_admin_or_encargado());

DROP POLICY IF EXISTS product_media_delete_staff ON storage.objects;
CREATE POLICY product_media_delete_staff
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-media' AND is_admin_or_encargado());
