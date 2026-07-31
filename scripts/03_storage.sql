-- ============================================================================
-- POS-SOLCRAFT — Storage
-- Bucket público "product-media" para imágenes de productos
-- (lib/inventory-actions.ts → uploadProductMedia).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-media', 'product-media', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

-- Lectura pública (las URLs de imagen se usan en el POS y catálogos)
DROP POLICY IF EXISTS "public_read_product_media" ON storage.objects;
CREATE POLICY "public_read_product_media" ON storage.objects
    FOR SELECT USING (bucket_id = 'product-media');

-- Escritura solo para usuarios autenticados
DROP POLICY IF EXISTS "authenticated_write_product_media" ON storage.objects;
CREATE POLICY "authenticated_write_product_media" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-media');

DROP POLICY IF EXISTS "authenticated_update_product_media" ON storage.objects;
CREATE POLICY "authenticated_update_product_media" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS "authenticated_delete_product_media" ON storage.objects;
CREATE POLICY "authenticated_delete_product_media" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'product-media');
