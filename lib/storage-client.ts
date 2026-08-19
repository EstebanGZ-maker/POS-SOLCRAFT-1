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

export type UploadResult =
  | { success: true; url: string; path: string }
  | { success: false; message: string }

// Sube una imagen directo al bucket product-media desde el navegador,
// bypaseando Server Actions y su serializador Flight/RSC (que revienta
// con "Maximum array nesting exceeded" en fotos de celular reales).
// Auth via cookie de sesión del user logueado; RLS del bucket exige
// admin/encargado + mime image/*.
export async function uploadProductImageClient(file: File): Promise<UploadResult> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
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
  const ext = EXT_BY_TYPE[file.type] ?? "jpg"
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage.from("product-media").upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    return { success: false, message: error.message }
  }

  const { data } = supabase.storage.from("product-media").getPublicUrl(path)
  return { success: true, url: data.publicUrl, path }
}
