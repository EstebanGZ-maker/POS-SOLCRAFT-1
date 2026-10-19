// Funciones puras cliente-safe: construyen el estado del IngressItem a
// partir del rubro + la respuesta de la IA. **Sin dependencias pesadas**
// (no zod, no supabase, no next): importables desde el navegador y
// desde el servidor.
//
// Esteban dejó dicho que estas funciones son la fuente de verdad del
// mapeo rubro → IngressItem; el panel NO reconstruye expresiones a
// mano. Los tests `--behavior` en `tests/snapshots/rubro-ropa/run.mjs`
// comparan la salida contra el oráculo evaluado del código pre-refactor
// (git show 1aff84b:components/central/ai-ingress-panel.tsx).

import { getRubroUIBundle, type RubroId, RUBRO_IDS } from "@/lib/rubro-ui"

/**
 * Campos del IngressItem (sin `id/file/dataUrl/status/savedCode/errorMsg/code`
 * que son estado de UI, no datos del producto).
 *
 * NOTA DE DOMINIO: los nombres `type_prefix` y `size` se mantienen a lo
 * largo del dominio por simplicidad (`next_product_code` + `products`
 * table + ingressNewProduct funcionan igual para ambos rubros). Pero
 * en el perfil `tecnologia`:
 *   - `type_prefix` representa la MARCA (2 alfanuméricos: IP, SA, etc.)
 *   - `size` representa la REFERENCIA del modelo (ej. "17PM", "TUNE520BT")
 * El label de la UI varía con el perfil (ver `profile.ui.labels`).
 */
export interface IngressItemFields {
  name: string
  type_prefix: string
  category: string
  description: string
  size: string
  color: string
  price: number
  cost: number
  quantity: number
}

/** Normaliza una cadena a mayúsculas + alfanuméricos solamente + length cap. */
function normalizeAlnum(input: unknown, maxLen: number): string {
  const s = typeof input === "string" ? input : ""
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, maxLen)
}

/**
 * Devuelve el estado inicial de un IngressItem recién creado — lo que
 * antes vivía inline en `handleFiles()` como
 * `const newItem: IngressItem = { ..., type_prefix: "XX", size: "M", ... }`.
 *
 * Para ropa: `type_prefix: "XX"`, `size: "M"`. Para tecnología: ambos "".
 * Los valores salen del perfil (`profile.ui.clientFallbacks.initial`) —
 * nunca hardcoded acá.
 */
export function createInitialItem(rubro: RubroId): IngressItemFields {
  const fb = getRubroUIBundle(rubro).ui.clientFallbacks.initial
  if (rubro === "ropa") {
    return {
      name: "",
      type_prefix: String(fb.type_prefix ?? "XX"),
      category: "",
      description: "",
      size: String(fb.size ?? "M"),
      color: String(fb.color ?? ""),
      price: Number(fb.price ?? 0),
      cost: Number(fb.cost ?? 0),
      quantity: Number(fb.quantity ?? 1),
    }
  }
  if (rubro === "tecnologia") {
    return {
      name: "",
      type_prefix: String(fb.brand_prefix ?? ""),
      category: "",
      description: "",
      size: String(fb.reference ?? ""),
      color: String(fb.color ?? ""),
      price: Number(fb.price ?? 0),
      cost: Number(fb.cost ?? 0),
      quantity: Number(fb.quantity ?? 1),
    }
  }
  throw new Error(`createInitialItem: rubro desconocido "${rubro as string}"`)
}

/**
 * Mapea la respuesta del modelo IA al estado del IngressItem — reemplaza
 * el inline `update(id, { name: product.name ?? "", type_prefix:
 * (product.type_prefix ?? "XX").toUpperCase().slice(0, 4), ... })` de
 * `analyze()`.
 *
 * Para ropa: PRESERVA las expresiones del main pre-refactor byte-por-byte
 * (ver `tests/snapshots/rubro-ropa/outputs/client-fallbacks.json` y el
 * oráculo del `--behavior`).
 *
 * Para tecnología: lee `product.brand_prefix` y `product.reference` del
 * esquema tecnología, normaliza (uppercase + alfanum + length cap:
 * marca 2, referencia 20). Si la IA no devuelve el campo o devuelve
 * algo inválido, el valor queda **vacío** — nunca cae a "XX" ni "M".
 */
export function applyAnalysisToItem(
  product: unknown,
  rubro: RubroId,
): Partial<IngressItemFields> {
  const p = (product && typeof product === "object" ? product : {}) as Record<string, unknown>
  if (rubro === "ropa") {
    const type_prefix_raw = typeof p.type_prefix === "string" ? p.type_prefix : "XX"
    const size_raw = typeof p.size === "string" ? p.size : "M"
    return {
      name: typeof p.name === "string" ? p.name : "",
      type_prefix: type_prefix_raw.toUpperCase().slice(0, 4),
      category: typeof p.category === "string" ? p.category : "",
      description: typeof p.description === "string" ? p.description : "",
      size: size_raw.toUpperCase(),
      color: typeof p.color === "string" ? p.color : "",
      price: Math.round(typeof p.suggested_price === "number" ? p.suggested_price : 0),
      cost: Math.round(typeof p.suggested_cost === "number" ? p.suggested_cost : 0),
      quantity: typeof p.quantity === "number" ? p.quantity : 1,
    }
  }
  if (rubro === "tecnologia") {
    const bundle = getRubroUIBundle("tecnologia")
    return {
      name: typeof p.name === "string" ? p.name : "",
      type_prefix: normalizeAlnum(p.brand_prefix, bundle.typePrefixMaxLength),
      category: typeof p.category === "string" ? p.category : "",
      description: typeof p.description === "string" ? p.description : "",
      size: normalizeAlnum(p.reference, bundle.referenceMaxLength ?? Infinity),
      color: typeof p.color === "string" ? p.color : "",
      // No price / no cost: dejan los valores actuales del formulario
      // (los defaults de createInitialItem = 0).
      quantity: typeof p.quantity === "number" ? p.quantity : 1,
    }
  }
  throw new Error(`applyAnalysisToItem: rubro desconocido "${rubro as string}"`)
}

/**
 * Validación server-side para los campos del código antes de generarlo.
 * `ingressNewProduct` la invoca para rubros que requieren shape estricto
 * (hoy solo tecnología). Devuelve null si pasa, string con el motivo si
 * rechaza.
 *
 * No se confía ni en el cliente ni en el modelo — el servidor es el
 * que decide si (marca, referencia) forman un código válido.
 */
export function validateItemForRubro(
  item: { type_prefix: string; size: string },
  rubro: RubroId,
): string | null {
  if (rubro === "ropa") {
    return null
  }
  if (rubro === "tecnologia") {
    const bundle = getRubroUIBundle("tecnologia")
    const brandMax = bundle.typePrefixMaxLength
    const refMax = bundle.referenceMaxLength ?? 0
    const brand = (item.type_prefix || "").toUpperCase()
    const ref = (item.size || "").toUpperCase()
    const brandRe = new RegExp(`^[A-Z0-9]{${brandMax}}$`)
    const refRe = new RegExp(`^[A-Z0-9]{1,${refMax}}$`)
    if (!brandRe.test(brand)) {
      return `La marca (prefijo) debe tener exactamente ${brandMax} caracteres alfanuméricos en mayúsculas (ej: IP, SA, HO).`
    }
    if (!refRe.test(ref)) {
      return `La referencia debe tener entre 1 y ${refMax} caracteres alfanuméricos en mayúsculas, sin espacios ni símbolos (ej: 17PM, TUNE520BT).`
    }
    return null
  }
  // Rubro desconocido: no se puede validar — se rechaza explícitamente.
  // Antes devolvía null, lo que dejaba pasar valores que ingressNewProduct
  // armaba sin schema conocido.
  return `Rubro desconocido "${rubro as string}". Esperado: ${RUBRO_IDS.join(" | ")}.`
}
