import { z } from "zod"

export function normalizePhoneCO(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "")
  return digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits
}

export const PHONE_CO_ERROR =
  "Ingresa un celular colombiano válido: 10 dígitos que empiezan en 3."

export const phoneCORequired = z
  .string({ required_error: "El celular es obligatorio." })
  .trim()
  .min(1, "El celular es obligatorio.")
  .transform(normalizePhoneCO)
  .refine((v) => /^3\d{9}$/.test(v), { message: PHONE_CO_ERROR })
