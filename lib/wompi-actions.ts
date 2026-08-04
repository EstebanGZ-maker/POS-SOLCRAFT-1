"use server"

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server"
import {
  getWompiEnv, buildIntegritySignature, buildReference,
  fetchWompiTransaction, WOMPI_CHECKOUT_URL,
} from "@/lib/wompi"

export interface WompiCheckoutResult {
  success: boolean
  message?: string
  checkoutUrl?: string
  reference?: string
}

/** ¿Está Wompi configurado y habilitado? Sin exponer secretos. */
export async function getWompiStatus() {
  const env = getWompiEnv()
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("business_settings")
    .select("wompi_enabled, wompi_public_key, wompi_sandbox")
    .eq("id", 1)
    .maybeSingle()

  const publicKey = (data as any)?.wompi_public_key || env.publicKey
  const missing: string[] = []
  if (!publicKey) missing.push("Llave pública")
  if (!env.integritySecret) missing.push("WOMPI_INTEGRITY_SECRET")
  if (!env.eventsSecret) missing.push("WOMPI_EVENTS_SECRET")

  return {
    enabled: Boolean((data as any)?.wompi_enabled),
    sandbox: (data as any)?.wompi_sandbox ?? true,
    configured: missing.length === 0,
    missing,
    hasPublicKey: Boolean(publicKey),
  }
}

/**
 * Genera el enlace de pago de Wompi para un pedido existente.
 * El monto lo determina el servidor a partir del pedido — nunca el cliente.
 */
export async function createWompiCheckout(orderId: string): Promise<WompiCheckoutResult> {
  const env = getWompiEnv()
  const supabase = await createServerSupabaseClient()

  const { data: settings } = await supabase
    .from("business_settings")
    .select("wompi_enabled, wompi_public_key, wompi_sandbox")
    .eq("id", 1)
    .maybeSingle()

  if (!(settings as any)?.wompi_enabled) {
    return { success: false, message: "El pago con tarjeta no está habilitado." }
  }

  const publicKey = (settings as any)?.wompi_public_key || env.publicKey
  if (!publicKey || !env.integritySecret) {
    return {
      success: false,
      message: "La pasarela no está configurada. Falta la llave pública o el secreto de integridad.",
    }
  }

  // El pedido es la fuente de verdad del monto
  const { data: order } = await supabase
    .from("web_orders")
    .select("order_id, order_number, total, status, payment_status, guest_name, guest_phone, guest_email")
    .eq("order_id", orderId)
    .maybeSingle()

  if (!order) return { success: false, message: "Pedido no encontrado." }
  if ((order as any).payment_status === "approved") {
    return { success: false, message: "Este pedido ya fue pagado." }
  }
  if ((order as any).status === "cancelled") {
    return { success: false, message: "Este pedido fue cancelado." }
  }

  const totalPesos = Number((order as any).total)
  if (!Number.isFinite(totalPesos) || totalPesos <= 0) {
    return { success: false, message: "El total del pedido no es válido." }
  }
  const amountInCents = Math.round(totalPesos * 100)
  const currency = "COP"
  const reference = buildReference((order as any).order_number)

  // Guarda la referencia contra el pedido (la usa el webhook para reconciliar).
  // set_web_order_payment_reference está revocada para anon/authenticated
  // desde S3-P0: se llama con service_role. La autorización de esta acción
  // vive en este Server Action (el caller ya cargó el pedido por orderId
  // y validó estado); el RPC solo persiste.
  const admin = createServiceRoleSupabaseClient()
  const { data: refRes, error: refErr } = await admin.rpc("set_web_order_payment_reference", {
    p_order_id: orderId,
    p_reference: reference,
  })
  if (refErr) return { success: false, message: refErr.message }
  if ((refRes as any)?.error) return { success: false, message: (refRes as any).error }

  const signature = buildIntegritySignature({
    reference,
    amountInCents,
    currency,
    integritySecret: env.integritySecret,
  })

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000"

  const params = new URLSearchParams({
    "public-key": publicKey,
    currency,
    "amount-in-cents": String(amountInCents),
    reference,
    "signature:integrity": signature,
    "redirect-url": `${baseUrl}/catalog/order/${encodeURIComponent((order as any).order_number)}/pago`,
  })

  const email = (order as any).guest_email
  if (email) params.set("customer-data:email", email)
  const name = (order as any).guest_name
  if (name) params.set("customer-data:full-name", name)
  const phone = (order as any).guest_phone
  if (phone) params.set("customer-data:phone-number", String(phone).replace(/\D/g, ""))

  return {
    success: true,
    checkoutUrl: `${WOMPI_CHECKOUT_URL}?${params.toString()}`,
    reference,
  }
}

/**
 * Verifica una transacción contra la API de Wompi y aplica el resultado.
 * Se usa al volver del redirect; el webhook es la confirmación autoritativa.
 */
export async function verifyAndApplyTransaction(transactionId: string) {
  const supabase = await createServerSupabaseClient()

  const { data: settings } = await supabase
    .from("business_settings")
    .select("wompi_sandbox")
    .eq("id", 1)
    .maybeSingle()

  const sandbox = (settings as any)?.wompi_sandbox ?? true
  const tx = await fetchWompiTransaction(transactionId, sandbox)

  if (!tx) {
    return { success: false, message: "No se pudo verificar la transacción con Wompi." }
  }

  // apply_wompi_transaction está revocada para anon/authenticated desde
  // S3-P0. El monto ya está verificado por fetchWompiTransaction contra la
  // API real de Wompi (arriba); acá persistimos con service_role.
  const admin = createServiceRoleSupabaseClient()
  const { data, error } = await admin.rpc("apply_wompi_transaction", {
    p_reference: tx.reference,
    p_transaction_id: tx.id,
    p_status: tx.status,
    p_amount_in_cents: tx.amount_in_cents,
  })

  if (error) return { success: false, message: error.message }
  const res = data as any
  if (res?.error) return { success: false, message: res.error }

  return {
    success: true,
    status: String(tx.status || "").toUpperCase(),
    paymentStatus: res.payment_status,
    orderNumber: res.order_number,
  }
}
