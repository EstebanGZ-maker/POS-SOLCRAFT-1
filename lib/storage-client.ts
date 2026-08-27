"use client"

import { createClient } from "@/lib/supabase/client"

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
}

// Algunos pickers (cámara Android vía intent, archivos sin extensión) entregan
// File.type vacío o "application/octet-stream". El bucket product-media es
// imagen-only por RLS, así que normalizamos a image/jpeg — sino Supabase lo
// persiste como octet-stream y Gemini lo rechaza aguas abajo.
function normalizeImageType(rawType: string): string {
  if (!rawType || rawType === "application/octet-stream") return "image/jpeg"
  return rawType
}

export type UploadResult =
  | { success: true; url: string; path: string }
  | { success: false; message: string }

// Sube una imagen directo al bucket product-media desde el navegador,
// bypaseando Server Actions y su serializador Flight/RSC (que revienta
// con "Maximum array nesting exceeded" en fotos de celular reales).
// Auth via cookie de sesión del user logueado; RLS del bucket exige
// admin/encargado + mime image/*.
export async function uploadProductImageClient(file: File): Promise<UploadResult> {
  const contentType = normalizeImageType(file.type)
  if (!ALLOWED_IMAGE_TYPES.includes(contentType as any)) {
    return { success: false, message: "Solo se admiten imágenes JPG, PNG, WebP o AVIF." }
  }
  if (file.size === 0) {
    return { success: false, message: "El archivo está vacío." }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return { success: false, message: `La imagen pesa ${mb} MB. El máximo es 5 MB.` }
  }

  const supabase = createClient()
  const ext = EXT_BY_TYPE[contentType] ?? "jpg"
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage.from("product-media").upload(path, file, {
    contentType,
    upsert: false,
  })
  if (error) {
    return { success: false, message: error.message }
  }

  const { data } = supabase.storage.from("product-media").getPublicUrl(path)
  return { success: true, url: data.publicUrl, path }
}

// ─────────────── Modelos 3D del hero (bucket catalog-assets) ───────────────
//
// Los .glb son órdenes de magnitud más grandes que las fotos de producto
// (nuestro ejemplo original pesaba ~62 MB antes de comprimir con Draco).
// El bucket es distinto de product-media (imagen-only, límite 5 MB).
//
// El upload es admin-only por policy — el bucket es branding, no contenido
// operativo. Auth via cookie de sesión del user logueado; RLS lo verifica.

const MAX_MODEL_BYTES = 100 * 1024 * 1024 // 100 MB
const MODEL_WARN_BYTES = 20 * 1024 * 1024 // 20 MB — avisa que conviene comprimir

export type ModelUploadResult =
  | { success: true; url: string; path: string; sizeBytes: number; warning?: string }
  | { success: false; message: string }

export async function uploadCatalogModelClient(file: File): Promise<ModelUploadResult> {
  // Muchos OS entregan el .glb como application/octet-stream porque no
  // tienen el MIME registrado. La extensión es el chequeo confiable.
  const name = file.name.toLowerCase()
  if (!name.endsWith(".glb")) {
    return { success: false, message: "El archivo debe tener extensión .glb (glTF Binary)." }
  }
  if (file.size === 0) {
    return { success: false, message: "El archivo está vacío." }
  }
  if (file.size > MAX_MODEL_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return { success: false, message: `El modelo pesa ${mb} MB. El máximo es 100 MB.` }
  }

  const supabase = createClient()
  const path = `models/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.glb`
  const { error } = await supabase.storage.from("catalog-assets").upload(path, file, {
    contentType: "model/gltf-binary",
    upsert: false,
  })
  if (error) {
    return { success: false, message: error.message }
  }

  const { data } = supabase.storage.from("catalog-assets").getPublicUrl(path)
  const result: ModelUploadResult = {
    success: true,
    url: data.publicUrl,
    path,
    sizeBytes: file.size,
  }
  if (file.size > MODEL_WARN_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    result.warning =
      `El modelo pesa ${mb} MB. Considera comprimirlo con Draco o Meshopt ` +
      `(gltf-transform draco input.glb output.glb) para acelerar la carga del catálogo.`
  }
  return result
}

