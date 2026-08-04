-- ###############################################################
-- ##                                                           ##
-- ##  ⚠️  LOCAL-ONLY — NO APLICAR EN PROD  ⚠️                  ##
-- ##                                                           ##
-- ##  Existe SOLO para reproducir el esquema real de prod      ##
-- ##  en el stack docker de desarrollo (supabase start).       ##
-- ##                                                           ##
-- ##  En prod estos objetos ya existen (con más columnas,      ##
-- ##  índices, RLS y triggers que este mínimo).                ##
-- ##                                                           ##
-- ##  Aplicarlo en prod: mejor caso = sobrescribe RPCs con     ##
-- ##  versiones simplificadas y rompe el flujo real.           ##
-- ##  Peor caso = pierde datos si CREATE TABLE choca con la    ##
-- ##  versión existente.                                       ##
-- ##                                                           ##
-- ##  Ver PLAN-PENDIENTES.md · M14 (drift versionado a         ##
-- ##  cerrar como scripts/15_web_orders_and_wompi_schema.sql). ##
-- ##                                                           ##
-- ###############################################################

-- =============================================================================
-- 13b_drift_wompi_local.sql — reproducción mínima de esquema Wompi para tests.
--
-- Alcance: solo lo que las 3 RPCs sensibles (apply_wompi_transaction,
-- set_web_order_payment_reference, log_payment_event) leen o escriben. FKs a
-- customers/sites/sales omitidos porque los tests no los necesitan.
-- =============================================================================

BEGIN;

-- payment_events (bitácora del webhook)
CREATE TABLE IF NOT EXISTS payment_events (
  event_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         TEXT DEFAULT 'wompi',
  transaction_id   TEXT,
  reference        TEXT,
  event_type       TEXT,
  status           TEXT,
  amount_in_cents  BIGINT,
  raw_payload      JSONB,
  signature_valid  BOOLEAN,
  processed        BOOLEAN DEFAULT FALSE,
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- web_orders (pedidos del storefront público) — mínimo funcional
CREATE TABLE IF NOT EXISTS web_orders (
  order_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               SERIAL,
  order_number         TEXT,
  total                NUMERIC NOT NULL,
  status               TEXT DEFAULT 'pending_payment',
  payment_status       TEXT DEFAULT 'pending',
  payment_method       TEXT DEFAULT 'wompi',
  wompi_reference      TEXT,
  wompi_transaction_id TEXT,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Grants base para las 3 RPCs (sin esto no funcionan bajo el rol authenticated)
GRANT ALL ON payment_events TO postgres, service_role;
GRANT SELECT, INSERT ON payment_events TO authenticated, anon;
GRANT ALL ON web_orders TO postgres, service_role;
GRANT SELECT, UPDATE ON web_orders TO authenticated, anon;
GRANT USAGE ON SEQUENCE web_orders_numero_seq TO authenticated, anon, service_role;

-- ----------------------------------------------------------------------------
-- 3 RPCs — DDL copiado literal de prod (pg_get_functiondef) 2026-08-03.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_wompi_transaction(p_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_expected BIGINT;
  v_new_payment_status TEXT;
BEGIN
  SELECT * INTO v_order FROM web_orders WHERE wompi_reference = p_reference;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Referencia desconocida: ' || p_reference);
  END IF;
  IF v_order.payment_status = 'approved' AND v_order.wompi_transaction_id = p_transaction_id THEN
    RETURN json_build_object('success', true, 'already_applied', true, 'order_number', v_order.order_number);
  END IF;
  v_expected := (v_order.total * 100)::BIGINT;
  IF p_amount_in_cents IS NOT NULL AND p_amount_in_cents <> v_expected THEN
    RETURN json_build_object('error', format('Monto no coincide: recibido %s, esperado %s.', p_amount_in_cents, v_expected));
  END IF;
  v_new_payment_status := CASE upper(p_status)
    WHEN 'APPROVED' THEN 'approved' WHEN 'DECLINED' THEN 'declined'
    WHEN 'VOIDED'   THEN 'voided'   WHEN 'ERROR'    THEN 'error'
    ELSE 'pending'
  END;
  UPDATE web_orders SET
    payment_status = v_new_payment_status,
    wompi_transaction_id = p_transaction_id,
    paid_at = CASE WHEN v_new_payment_status = 'approved' THEN NOW() ELSE paid_at END,
    status = CASE
               WHEN v_new_payment_status = 'approved' AND status = 'pending_payment' THEN 'paid'
               WHEN v_new_payment_status IN ('declined','error','voided') AND status = 'pending_payment' THEN 'pending_payment'
               ELSE status
             END,
    updated_at = NOW()
  WHERE order_id = v_order.order_id;
  RETURN json_build_object('success', true, 'order_number', v_order.order_number, 'payment_status', v_new_payment_status);
END $function$;

CREATE OR REPLACE FUNCTION public.set_web_order_payment_reference(p_order_id uuid, p_reference text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM web_orders WHERE order_id = p_order_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Pedido no encontrado.'); END IF;
  IF v_order.payment_status = 'approved' THEN
    RETURN json_build_object('error', 'Este pedido ya fue pagado.');
  END IF;
  UPDATE web_orders SET wompi_reference = p_reference, payment_method = 'wompi', updated_at = NOW()
  WHERE order_id = p_order_id;
  RETURN json_build_object('success', true, 'reference', p_reference, 'amount_in_cents', (v_order.total * 100)::BIGINT);
END $function$;

CREATE OR REPLACE FUNCTION public.log_payment_event(p_transaction_id text, p_reference text, p_event_type text, p_status text, p_amount_in_cents bigint, p_raw jsonb, p_signature_valid boolean, p_processed boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO payment_events (transaction_id, reference, event_type, status, amount_in_cents, raw_payload, signature_valid, processed, error_message)
  VALUES (p_transaction_id, p_reference, p_event_type, p_status, p_amount_in_cents, p_raw, p_signature_valid, p_processed, p_error);
$function$;

-- Grants iniciales (los mismos que tiene prod hoy — luego 14 los revoca)
GRANT EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) TO anon, authenticated, service_role;

-- Seed: 1 pedido pendiente que los tests usan
INSERT INTO web_orders (order_id, order_number, total, wompi_reference)
VALUES ('99999999-9999-9999-9999-999999999999', 'WEB-TEST-001', 150000, 'REF-TEST-001')
ON CONFLICT (order_id) DO NOTHING;

COMMIT;
