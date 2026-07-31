"use client"

/**
 * Comprime una imagen en el navegador antes de subirla.
 * Una foto de celular pesa 4–8 MB; esto la deja en ~150–300 KB.
 *
 * Usa Canvas, sin dependencias externas. Devuelve un data URL WebP
 * (con respaldo a JPEG si el navegador no soporta WebP).
 */

export interface CompressOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
}

export interface CompressResult {
  dataUrl: string
  mimeType: string
  originalBytes: number
  compressedBytes: number
  width: number
  height: number
}

const DEFAULTS: Required<CompressOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
}

/** ¿El navegador puede exportar WebP desde canvas? */
function supportsWebp(): boolean {
  try {
    const c = document.createElement("canvas")
    c.width = 1
    c.height = 1
    return c.toDataURL("image/webp").startsWith("data:image/webp")
  } catch {
    return false
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("No se pudo leer la imagen."))
    }
    img.src = url
  })
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const opts = { ...DEFAULTS, ...options }

  if (!file.type.startsWith("image/")) {
    throw new Error("El archivo no es una imagen.")
  }

  const img = await loadImage(file)

  // Escalar manteniendo proporción, sin agrandar imágenes pequeñas
  const ratio = Math.min(opts.maxWidth / img.width, opts.maxHeight / img.height, 1)
  const width = Math.max(1, Math.round(img.width * ratio))
  const height = Math.max(1, Math.round(img.height * ratio))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No se pudo procesar la imagen.")

  // Fondo blanco: los PNG con transparencia se verían negros en JPEG
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, 0, 0, width, height)

  const mimeType = supportsWebp() ? "image/webp" : "image/jpeg"
  const dataUrl = canvas.toDataURL(mimeType, opts.quality)

  // Tamaño real del base64 resultante
  const base64 = dataUrl.split(",")[1] ?? ""
  const compressedBytes = Math.round((base64.length * 3) / 4)

  return {
    dataUrl,
    mimeType,
    originalBytes: file.size,
    compressedBytes,
    width,
    height,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
