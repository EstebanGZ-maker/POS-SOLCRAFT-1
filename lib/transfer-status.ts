// Fuente de verdad TS para los estados válidos de transfers.status.
// DEBE mantenerse en sincronía con el CHECK constraint de la tabla:
//   supabase/migrations/20260812000000_baseline_canonical_from_prod.sql:313
//   CHECK ((status = ANY (ARRAY['pendiente','en_transito','recibido',
//                               'recibido_con_pendiente','cancelado']::text[])))
// Si el CHECK cambia, actualizar este array (y viceversa).

export const TRANSFER_STATUSES = [
  "pendiente",
  "en_transito",
  "recibido",
  "recibido_con_pendiente",
  "cancelado",
] as const

export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export function isTransferStatus(v: unknown): v is TransferStatus {
  return typeof v === "string" && (TRANSFER_STATUSES as readonly string[]).includes(v)
}

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  pendiente: "Pendiente",
  en_transito: "En tránsito",
  recibido: "Recibido",
  recibido_con_pendiente: "Recibido parcial",
  cancelado: "Cancelado",
}
