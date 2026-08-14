-- 09_security_revoke_anon_sensitive_fns.sql
-- Aplicada a la DB el 31/07/2026 (migración 09_security_revoke_anon_sensitive_fns).
-- Cierra el advisor "Public Can Execute SECURITY DEFINER Function" para las
-- funciones sensibles: quita EXECUTE de anon y PUBLIC, conservando 'authenticated'
-- porque la app las invoca con la sesión del usuario (anon key + cookies).
-- Cada función valida internamente el rol (admin/staff); esto es defensa en
-- profundidad para que un anónimo no pueda ni alcanzarlas vía /rest/v1/rpc.
--
-- NOTA: NO se tocan las funciones public_* del catálogo ni las de checkout/Wompi
-- (apply_wompi_transaction, place/create_web_order, public_get_order, ...) porque
-- el storefront y el webhook las invocan sin sesión (rol anon) por diseño.

REVOKE EXECUTE ON FUNCTION public.admin_create_user(text,text,text,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_password(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fulfill_web_order(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_online_order_status(uuid,text,uuid,text) FROM PUBLIC, anon;

-- handle_new_user es un trigger de auth.users: nadie debe invocarlo por RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
