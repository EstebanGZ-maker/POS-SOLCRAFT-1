-- 11_rls_initplan_and_permissive_cleanup.sql
-- Aplicada a la DB el 31/07/2026 (migración 11_rls_initplan_and_permissive_cleanup).
-- P2 (auth_rls_initplan): auth.uid()/is_admin() se re-evaluaban por fila. Se envuelven
--   en (select ...) para que Postgres los evalúe una sola vez por consulta.
-- P3 (multiple_permissive_policies): las políticas ALL (*_write) solapaban SELECT con
--   las read_own. Se separan en INSERT/UPDATE/DELETE para dejar un solo path de SELECT.
-- La semántica de autorización es idéntica a la original.

-- ===== user_profiles =====
DROP POLICY IF EXISTS users_read_own ON public.user_profiles;
CREATE POLICY users_read_own ON public.user_profiles
  FOR SELECT TO authenticated
  USING ((id = (select auth.uid())) OR (select is_admin()));

DROP POLICY IF EXISTS users_admin_write ON public.user_profiles;
CREATE POLICY users_admin_write_ins ON public.user_profiles
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY users_admin_write_upd ON public.user_profiles
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY users_admin_write_del ON public.user_profiles
  FOR DELETE TO authenticated USING ((select is_admin()));

-- ===== user_sites =====
DROP POLICY IF EXISTS user_sites_read_own ON public.user_sites;
CREATE POLICY user_sites_read_own ON public.user_sites
  FOR SELECT TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()));

DROP POLICY IF EXISTS user_sites_admin_write ON public.user_sites;
CREATE POLICY user_sites_admin_write_ins ON public.user_sites
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY user_sites_admin_write_upd ON public.user_sites
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY user_sites_admin_write_del ON public.user_sites
  FOR DELETE TO authenticated USING ((select is_admin()));

-- ===== customer_accounts =====
DROP POLICY IF EXISTS customer_accounts_read_own ON public.customer_accounts;
CREATE POLICY customer_accounts_read_own ON public.customer_accounts
  FOR SELECT TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()));

DROP POLICY IF EXISTS customer_accounts_write ON public.customer_accounts;
CREATE POLICY customer_accounts_write_ins ON public.customer_accounts
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = (select auth.uid())) OR (select is_admin()));
CREATE POLICY customer_accounts_write_upd ON public.customer_accounts
  FOR UPDATE TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()))
  WITH CHECK ((user_id = (select auth.uid())) OR (select is_admin()));
CREATE POLICY customer_accounts_write_del ON public.customer_accounts
  FOR DELETE TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()));
