-- 10_security_fix_function_search_path.sql
-- Aplicada a la DB el 31/07/2026 (migración 10_security_fix_function_search_path).
-- Resuelve el advisor "Function Search Path Mutable" (34 funciones): un search_path
-- mutable permite ataques de shadowing de esquema contra funciones SECURITY DEFINER.
-- Fija un search_path explícito que cubre los esquemas que cualquier función podría
-- tocar (public: tablas; auth: users/identities; extensions: crypt/gen_salt), sin
-- romper la resolución de nombres. Idempotente: omite funciones que ya lo tienen.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, auth, extensions, pg_temp',
      r.proname, r.args
    );
  END LOOP;
END $$;
