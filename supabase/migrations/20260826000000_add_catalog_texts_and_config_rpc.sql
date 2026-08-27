-- s24 — Textos configurables del catálogo público
--
-- Agrega dos campos editables desde /settings/receipt que reemplazan los
-- literales hardcodeados de la landing y el pie del catálogo:
--   · catalog_tagline       — frase de portada (landing + footer)
--   · catalog_hero_subtitle — subtítulo bajo el título del hero
--
-- Ambos son nullable. Los fallbacks se resuelven en TS (mismo patrón que
-- el default "Mi negocio" para business_name):
--   · catalog_tagline null → "Tienda en línea"
--   · catalog_hero_subtitle null/"" → no se renderiza el <p>

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS catalog_tagline text,
  ADD COLUMN IF NOT EXISTS catalog_hero_subtitle text;

-- El RPC público expone ambos al catálogo (que no lee business_settings
-- directo por RLS). Mismo shape que antes + 2 keys nuevas.
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
    'catalog_hero_subtitle', catalog_hero_subtitle
  )
  FROM business_settings WHERE id = 1;
$function$;
