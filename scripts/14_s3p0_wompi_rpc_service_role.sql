-- =============================================================================
-- 14_s3p0_wompi_rpc_service_role.sql — Hotfix S3-P0.
--
-- Bloquea EXECUTE anon/authenticated en las 3 RPCs del flujo pago/pedido web
-- que hoy son SECURITY DEFINER expuestas por defecto. Solo service_role puede
-- invocarlas — los server-side callers (webhook Wompi y Server Actions de
-- checkout) deben usar el SUPABASE_SERVICE_ROLE_KEY.
--
-- CONTEXTO
--   apply_wompi_transaction: P0 crítico — anon puede marcar cualquier orden
--     como pagada sin firma HMAC. Aunque el route handler valida firma, la
--     RPC en sí no; anon la llama directo /rest/v1/rpc/apply_wompi_transaction.
--   set_web_order_payment_reference: P1 — anon puede setear wompi_reference de
--     cualquier order_id (UUID). Amplifica el vector anterior.
--   log_payment_event: bajar privilegio como buena higiene. Sólo el webhook la
--     usa; nadie más debería poder ensuciar la bitácora de pagos.
--
-- ORDEN DE APLICACIÓN
--   Este archivo se aplica DESPUÉS de que el refactor del caller (webhook +
--   wompi-actions) esté deployado en Vercel usando service_role. Sin el
--   refactor deployado primero, este REVOKE tumba el flujo de pago web real.
--
-- ROLLBACK: bloque comentado al final.
-- =============================================================================

BEGIN;

-- 1) apply_wompi_transaction
REVOKE EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) TO service_role;

-- 2) set_web_order_payment_reference
REVOKE EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) TO service_role;

-- 3) log_payment_event
REVOKE EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) TO service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (correr manualmente si necesitas devolver anon/authenticated).
--   Solo tiene sentido si el refactor del webhook fue revertido antes; con el
--   refactor aplicado, el webhook usa service_role y no necesita anon.
--
-- GRANT EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) TO anon, authenticated;
-- =============================================================================
