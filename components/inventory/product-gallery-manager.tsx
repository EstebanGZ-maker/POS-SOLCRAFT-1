"use client"

import { useRef, useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { compressImage, formatBytes } from "@/lib/image-compress"
import {
  uploadProductMedia, getProductImages, addProductImage,
  setPrimaryProductImage, deleteProductImage, reorderProductImages,
} from "@/lib/inventory-actions"
import {
  ImagePlus, Loader2, Star, Trash2, ArrowLeft, ArrowRight, ImageOff,
} from "lucide-react"

const MAX_IMAGES = 8

export function ProductGalleryManager({ productId }: { productId: string }) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  const { data: images = [], mutate } = useSWR(
    productId ? ["product-images", productId] : null,
    () => getProductImages(productId),
  )

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      toast({
        title: "Límite alcanzado",
        description: `Máximo ${MAX_IMAGES} fotos por producto.`,
        variant: "destructive",
      })
      return
    }

    const toProcess = Array.from(files).slice(0, room)
    if (files.length > room) {
      toast({
        title: "Algunas fotos se omitieron",
        description: `Solo caben ${room} más (máximo ${MAX_IMAGES}).`,
      })
    }

    setBusy(true)
    let ok = 0
    let saved = 0

    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i]
      setProgress(`Procesando ${i + 1} de ${toProcess.length}…`)
      try {
        const compressed = await compressImage(file)
        saved += compressed.originalBytes - compressed.compressedBytes

        const up = await uploadProductMedia(compressed.dataUrl)
        if (!up.success || !up.url) {
          toast({ title: `Error con ${file.name}`, description: up.message, variant: "destructive" })
          continue
        }

        const res = await addProductImage({
          product_id: productId,
          url: up.url,
          storage_path: (up as any).path ?? null,
          alt_text: null,
        })
        if (!res.success) {
          toast({ title: `Error con ${file.name}`, description: res.message, variant: "destructive" })
          continue
        }
        ok++
      } catch (e: any) {
        toast({
          title: `No se pudo procesar ${file.name}`,
          description: e?.message || "Error desconocido",
          variant: "destructive",
        })
      }
    }

    setBusy(false)
    setProgress(null)
    if (fileRef.current) fileRef.current.value = ""

    if (ok > 0) {
      toast({
        title: `${ok} foto(s) agregada(s)`,
        description: saved > 0 ? `Se ahorraron ${formatBytes(saved)} al comprimir.` : undefined,
      })
      mutate()
    }
  }

  async function makePrimary(imageId: string) {
    const res = await setPrimaryProductImage(imageId, productId)
    if (!res.success) {
      toast({ title: "Error", description: res.message, variant: "destructive" })
      return
    }
    mutate()
  }

  async function remove(imageId: string) {
    const res = await deleteProductImage(imageId)
    toast({
      title: res.success ? "Imagen eliminada" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) mutate()
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...(images as any[])]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    // Optimista: reordena en pantalla y persiste después
    mutate(next, { revalidate: false })
    const res = await reorderProductImages(productId, next.map((i) => i.image_id))
    if (!res.success) {
      toast({ title: "Error", description: res.message, variant: "destructive" })
    }
    mutate()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">
          Fotos del producto
          <span className="ml-1.5 font-normal text-muted-foreground">
            ({images.length}/{MAX_IMAGES})
          </span>
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busy || images.length >= MAX_IMAGES}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          Agregar
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {progress && (
        <p className="text-xs text-muted-foreground">{progress}</p>
      )}

      {images.length === 0 ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
        >
          <ImageOff className="h-8 w-8 opacity-40" />
          <span className="text-sm">Sin fotos. Haz clic para agregar.</span>
          <span className="text-xs">Se comprimen automáticamente antes de subir.</span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {(images as any[]).map((img, idx) => (
            <div
              key={img.image_id}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt_text || ""} className="h-full w-full object-cover" />

              {img.is_primary && (
                <Badge className="absolute left-1 top-1 gap-1 px-1.5 py-0 text-[9px]">
                  <Star className="h-2.5 w-2.5 fill-current" /> Principal
                </Badge>
              )}

              {/* Controles al pasar el cursor */}
              <div className="absolute inset-0 flex flex-col justify-between bg-black/55 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex justify-end gap-1">
                  {!img.is_primary && (
                    <button
                      type="button"
                      title="Marcar como principal"
                      onClick={() => makePrimary(img.image_id)}
                      className="rounded bg-white/15 p-1 text-white hover:bg-white/30"
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Eliminar"
                    onClick={() => remove(img.image_id)}
                    className="rounded bg-red-500/80 p-1 text-white hover:bg-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex justify-center gap-1">
                  <button
                    type="button"
                    title="Mover antes"
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    className="rounded bg-white/15 p-1 text-white hover:bg-white/30 disabled:opacity-30"
                  >
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    title="Mover después"
                    disabled={idx === images.length - 1}
                    onClick={() => move(idx, 1)}
                    className="rounded bg-white/15 p-1 text-white hover:bg-white/30 disabled:opacity-30"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        La foto principal es la que aparece en el catálogo y en el POS.
      </p>
    </div>
  )
}
