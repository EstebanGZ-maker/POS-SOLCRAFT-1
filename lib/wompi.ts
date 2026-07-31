// Utilidades de Wompi (solo servidor). No importar desde componentes cliente:
// aquí se leen secretos de entorno.
import crypto from "crypto"

// La URL de sandbox de Wompi ha cambiado entre versiones de su plataforma.
// Se puede sobreescribir con WOMPI_API_BASE sin tocar código.
export const WOMPI_SANDBOX_API =
  process.env.WOMPI_API_BASE || "https://api-sandbox.co.uwc.wompi.dev/v1"
export const WOMPI_PROD_API =
  process.env.WOMPI_API_BASE || "https://api.wompi.co/v1"
export const WOMPI_CHECKOUT_URL =
  process.env.WOMPI_CHECKOUT_URL || "https://checkout.wompi.co/p/"

export interface WompiEnv {
  publicKey: string | null
  privateKey: string | null
  integritySecret: string | null
  eventsSecret: string | null
}

export function getWompiEnv(): WompiEnv {
  return {
    publicKey: process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY || process.env.WOMPI_PUBLIC_KEY || null,
    privateKey: process.env.WOMPI_PRIVATE_KEY || null,
    integritySecret: process.env.WOMPI_INTEGRITY_SECRET || null,
    eventsSecret: process.env.WOMPI_EVENTS_SECRET || null,
  }
}

export function wompiApiBase(sandbox: boolean) {
  return sandbox ? WOMPI_SANDBOX_API : WOMPI_PROD_API
}

/**
 * Firma de integridad del Checkout Web.
 * SHA256 de: <referencia><monto_en_centavos><moneda><secreto_integridad>
 * Docs: Wompi — "Firma de integridad".
 */
export function buildIntegritySignature(input: {
  reference: string
  amountInCents: number | bigint
  currency: string
  integritySecret: string
  expirationTime?: string | null
}): string {
  const { reference, amountInCents, currency, integritySecret, expirationTime } = input
  const base = expirationTime
    ? `${reference}${amountInCents}${currency}${expirationTime}${integritySecret}`
    : `${reference}${amountInCents}${currency}${integritySecret}`
  return crypto.createHash("sha256").update(base).digest("hex")
}

/**
 * Verifica el checksum de un evento (webhook).
 * Wompi indica en signature.properties qué campos concatenar, en orden,
 * seguidos del timestamp y del secreto de eventos.
 */
export function verifyEventChecksum(payload: any, eventsSecret: string): boolean {
  try {
    const props: string[] = payload?.signature?.properties
    const checksum: string = payload?.signature?.checksum
    const timestamp = payload?.timestamp
    if (!Array.isArray(props) || !checksum || timestamp === undefined) return false

    // Resuelve rutas tipo "transaction.status" dentro de payload.data
    const concatenated = props
      .map((path) =>
        path.split(".").reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), payload.data),
      )
      .map((v) => (v === null || v === undefined ? "" : String(v)))
      .join("")

    const toHash = `${concatenated}${timestamp}${eventsSecret}`
    const computed = crypto.createHash("sha256").update(toHash).digest("hex")

    // Comparación en tiempo constante
    const a = Buffer.from(computed, "utf8")
    const b = Buffer.from(String(checksum).toLowerCase(), "utf8")
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Consulta una transacción a la API de Wompi (fuente de verdad tras el redirect). */
export async function fetchWompiTransaction(transactionId: string, sandbox: boolean) {
  const res = await fetch(`${wompiApiBase(sandbox)}/transactions/${transactionId}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  })
  if (!res.ok) return null
  const json = await res.json()
  return json?.data ?? null
}

/** Referencia única e irrepetible por intento de pago. */
export function buildReference(orderNumber: string): string {
  const rand = crypto.randomBytes(4).toString("hex")
  return `${orderNumber}-${Date.now().toString(36)}-${rand}`.toUpperCase()
}
