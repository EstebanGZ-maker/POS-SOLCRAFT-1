#!/usr/bin/env node
/**
 * smoke-s3p0.mjs — valida los 5 tests A-E del hotfix S3-P0 contra el stack
 * local (docker supabase + pnpm dev en :3000).
 *
 * PRE: aplicar 13b_drift_wompi_local.sql + 14_s3p0_wompi_rpc_service_role.sql.
 *      dev server local corriendo con .env.local apuntando al docker y con
 *      WOMPI_EVENTS_SECRET + SUPABASE_SERVICE_ROLE_KEY seteados.
 */
import { createClient } from "@supabase/supabase-js"
import crypto from "node:crypto"

const URL = "http://127.0.0.1:54321"
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const WOMPI_EVENTS_SECRET = "test-events-secret-local"
const BASE = "http://localhost:3000"
const ORDER_ID = "99999999-9999-9999-9999-999999999999"
const REFERENCE = "REF-TEST-001"
const TOTAL_CENTS = 15000000

const anon = createClient(URL, ANON, { auth: { persistSession: false } })

let pass = 0, fail = 0
function report(name, ok, detail = "") {
  const icon = ok ? "✅" : "❌"
  console.log(`${icon} ${name}${detail ? " — " + detail : ""}`)
  ok ? pass++ : fail++
}

// ---------------- TEST A ----------------
{
  const { error } = await anon.rpc("apply_wompi_transaction", {
    p_reference: REFERENCE, p_transaction_id: "FAKE",
    p_status: "APPROVED", p_amount_in_cents: TOTAL_CENTS,
  })
  const denied = error && /permission denied/i.test(error.message)
  report("A · anon → apply_wompi_transaction → permission denied", denied,
    error ? error.message.slice(0, 80) : "(sin error — anon SÍ pudo ejecutar)")
}

// ---------------- TEST B ----------------
{
  const { error } = await anon.rpc("set_web_order_payment_reference", {
    p_order_id: ORDER_ID, p_reference: "HACK",
  })
  const denied = error && /permission denied/i.test(error.message)
  report("B · anon → set_web_order_payment_reference → permission denied", denied,
    error ? error.message.slice(0, 80) : "(sin error — anon SÍ pudo ejecutar)")
}

// ---------------- TEST E ----------------
{
  const { error } = await anon.rpc("log_payment_event", {
    p_transaction_id: "X", p_reference: "X", p_event_type: "X",
    p_status: "X", p_amount_in_cents: 0, p_raw: {}, p_signature_valid: false,
    p_processed: false, p_error: null,
  })
  const denied = error && /permission denied/i.test(error.message)
  report("E · anon → log_payment_event → permission denied", denied,
    error ? error.message.slice(0, 80) : "(sin error — anon SÍ pudo ejecutar)")
}

// ---------------- TEST D (firma inválida — hazlo antes que C para no dejar la orden approved sin querer) ----------------
{
  const payload = {
    event: "transaction.updated",
    timestamp: 1730000000,
    data: { transaction: { id: "TX-BAD", status: "APPROVED", reference: REFERENCE, amount_in_cents: TOTAL_CENTS } },
    signature: { properties: ["transaction.id","transaction.status","transaction.amount_in_cents"], checksum: "abcd1234-wrong" },
  }
  const resp = await fetch(`${BASE}/api/wompi/webhook`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  })
  const body = await resp.json().catch(() => ({}))
  const ok401 = resp.status === 401 && /firma inválida/i.test(body.error || "")
  report("D · webhook con firma inválida → 401 rechazado", ok401,
    `status=${resp.status} body=${JSON.stringify(body).slice(0,80)}`)
}

// ---------------- TEST C (firma válida — orden pasa a approved) ----------------
{
  // Resetear el pedido a pending por si un test anterior lo tocó
  const svc = createClient(URL,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
    { auth: { persistSession: false } })
  await svc.from("web_orders")
    .update({ payment_status: "pending", status: "pending_payment", wompi_transaction_id: null, paid_at: null })
    .eq("order_id", ORDER_ID)

  const timestamp = Math.floor(Date.now() / 1000)
  const props = ["transaction.id","transaction.status","transaction.amount_in_cents"]
  const values = ["TX-GOOD", "APPROVED", String(TOTAL_CENTS)]
  const concatenated = values.join("")
  const checksum = crypto.createHash("sha256")
    .update(`${concatenated}${timestamp}${WOMPI_EVENTS_SECRET}`).digest("hex")

  const payload = {
    event: "transaction.updated", timestamp,
    data: { transaction: { id: "TX-GOOD", status: "APPROVED", reference: REFERENCE, amount_in_cents: TOTAL_CENTS } },
    signature: { properties: props, checksum },
  }
  const resp = await fetch(`${BASE}/api/wompi/webhook`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  })
  const body = await resp.json().catch(() => ({}))
  const status200 = resp.status === 200 && body.payment_status === "approved"

  const { data: after } = await svc.from("web_orders")
    .select("payment_status, status, wompi_transaction_id").eq("order_id", ORDER_ID).single()
  const dbOk = after?.payment_status === "approved" && after?.wompi_transaction_id === "TX-GOOD"

  report("C · webhook con firma válida → 200 + orden approved en DB", status200 && dbOk,
    `http=${resp.status} response=${JSON.stringify(body).slice(0,60)} db=${JSON.stringify(after)}`)
}

console.log(`\n${pass}/${pass+fail} passed`)
process.exit(fail === 0 ? 0 : 1)
