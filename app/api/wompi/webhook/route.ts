import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getWompiEnv, verifyEventChecksum } from "@/lib/wompi"

// Wompi reintenta si no recibe 2xx. Respondemos 200 salvo error real de proceso.
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const env = getWompiEnv()

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const tx = payload?.data?.transaction ?? {}
  const transactionId: string | null = tx.id ?? null
  const reference: string | null = tx.reference ?? null
  const status: string | null = tx.status ?? null
  const amountInCents: number | null = tx.amount_in_cents ?? null
  const eventType: string | null = payload?.event ?? null

  const supabase = await createServerSupabaseClient()

  const logEvent = async (valid: boolean, processed: boolean, errorMsg: string | null) => {
    try {
      await supabase.rpc("log_payment_event", {
        p_transaction_id: transactionId,
        p_reference: reference,
        p_event_type: eventType,
        p_status: status,
        p_amount_in_cents: amountInCents,
        p_raw: payload,
        p_signature_valid: valid,
        p_processed: processed,
        p_error: errorMsg,
      })
    } catch {
      /* la bitácora nunca debe tumbar el webhook */
    }
  }

  // 1. Sin secreto configurado no se puede confiar en el evento
  if (!env.eventsSecret) {
    await logEvent(false, false, "WOMPI_EVENTS_SECRET no configurado")
    return NextResponse.json({ error: "Webhook no configurado" }, { status: 503 })
  }

  // 2. Verificar la firma: rechaza eventos falsificados
  const valid = verifyEventChecksum(payload, env.eventsSecret)
  if (!valid) {
    await logEvent(false, false, "Checksum inválido")
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 })
  }

  // 3. Solo nos interesan eventos de transacción con referencia
  if (!reference || !transactionId) {
    await logEvent(true, false, "Evento sin referencia o transaction id")
    return NextResponse.json({ received: true, ignored: true })
  }

  // 4. Aplicar: el RPC valida monto e idempotencia
  const { data, error } = await supabase.rpc("apply_wompi_transaction", {
    p_reference: reference,
    p_transaction_id: transactionId,
    p_status: status,
    p_amount_in_cents: amountInCents,
  })

  if (error) {
    await logEvent(true, false, error.message)
    // 500 para que Wompi reintente
    return NextResponse.json({ error: "Error al procesar" }, { status: 500 })
  }

  const res = data as any
  if (res?.error) {
    // Error de negocio (referencia desconocida, monto distinto): no reintentar
    await logEvent(true, false, res.error)
    return NextResponse.json({ received: true, error: res.error })
  }

  await logEvent(true, true, null)
  return NextResponse.json({
    received: true,
    order_number: res.order_number,
    payment_status: res.payment_status,
  })
}

// Útil para comprobar que la URL responde al configurarla en Wompi
export async function GET() {
  const env = getWompiEnv()
  return NextResponse.json({
    ok: true,
    configured: Boolean(env.eventsSecret),
    endpoint: "wompi/webhook",
  })
}
