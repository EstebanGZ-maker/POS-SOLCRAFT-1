"use client"

import type React from "react"
import { useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { uploadProductMedia, ingressNewProduct } from "@/lib/inventory-actions"
import { Sparkles, Camera, Loader2, Trash2, Check, ImageIcon, Video, RefreshCw } from "lucide-react"

type ItemStatus = "analyzing" | "ready" | "saving" | "done" | "error"

type IngressItem = {
  id: string
  dataUrl: string
  mediaType: string
  isVideo: boolean
  status: ItemStatus
  savedCode?: string
  errorMsg?: string
  // editable fields
  name: string
  type_prefix: string
  category: string
  description: string
  size: string
  color: string
  price: number
  cost: number
  quantity: number
  code: string // manual override; empty = auto
}

const PREFIX_HINTS =
  "CA=Camisa · PA=Pantalón · CH=Chaqueta · VE=Vestido · FA=Falda · BL=Blusa · BU=Buzo · SU=Suéter · SH=Short · ZA=Zapato · AC=Accesorio"

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function codePreview(item: IngressItem) {
  const prefix = (item.type_prefix || "XX").toUpperCase()
  const size = (item.size || "U").toUpperCase()
  const thousands = Math.round((item.price || 0) / 1000)
  return `${prefix}-${size}-${thousands}-##`
}

export function AiIngressPanel({
  centralWarehouseId,
  centralSiteId,
  onIngressed,
}: {
  centralWarehouseId: string
  centralSiteId: string
  onIngressed?: () => void
}) {
  const { toast } = useToast()
  const [items, setItems] = useState<IngressItem[]>([])
  const [savingAll, setSavingAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const update = (id: string, patch: Partial<IngressItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  async function analyze(id: string, dataUrl: string, mediaType: string) {
    try {
      const res = await fetch("/api/analyze-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, mediaType }),
      })
      if (!res.ok) throw new Error("analysis failed")
      const { product } = await res.json()
      update(id, {
        status: "ready",
        name: product.name ?? "",
        type_prefix: (product.type_prefix ?? "XX").toUpperCase().slice(0, 4),
        category: product.category ?? "",
        description: product.description ?? "",
        size: (product.size ?? "M").toUpperCase(),
        color: product.color ?? "",
        price: Math.round(product.suggested_price ?? 0),
        cost: Math.round(product.suggested_cost ?? 0),
        quantity: product.quantity ?? 1,
      })
    } catch {
      update(id, {
        status: "ready",
        errorMsg: "La IA no pudo analizar el archivo. Completa los datos manualmente.",
      })
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      const dataUrl = await fileToDataUrl(file)
      const isVideo = file.type.startsWith("video")
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const newItem: IngressItem = {
        id,
        dataUrl,
        mediaType: file.type,
        isVideo,
        status: "analyzing",
        name: "",
        type_prefix: "XX",
        category: "",
        description: "",
        size: "M",
        color: "",
        price: 0,
        cost: 0,
        quantity: 1,
        code: "",
      }
      setItems((prev) => [...prev, newItem])
      analyze(id, dataUrl, file.type)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function saveItem(item: IngressItem): Promise<{ ok: boolean; code?: string }> {
    update(item.id, { status: "saving", errorMsg: undefined })
    // Wrap TODO en try/catch: si uploadProductMedia o ingressNewProduct
    // throwean (network, auth, exception no-esperada del RPC), el ítem
    // quedaba en "saving" permanente con spinner infinito y el toast
    // global nunca se disparaba — silent failure real.
    try {
      let imageUrl: string | null = null
      const ext = item.isVideo ? "mp4" : "jpg"
      const up = await uploadProductMedia(item.dataUrl, ext)
      if (up.success) imageUrl = up.url ?? null

      const res = await ingressNewProduct(
        {
          name: item.name,
          type_prefix: item.type_prefix,
          category: item.category,
          description: item.description,
          size: item.size,
          color: item.color,
          price: item.price,
          cost: item.cost,
          quantity: item.quantity,
          image_url: imageUrl,
          code: item.code.trim() || null,
        },
        centralWarehouseId,
        centralSiteId,
      )
      if (res.success) {
        update(item.id, { status: "done", savedCode: res.code })
        return { ok: true, code: res.code }
      }
      update(item.id, { status: "error", errorMsg: res.message })
      return { ok: false }
    } catch (e: any) {
      const msg = e?.message || "Error inesperado al ingresar el producto."
      update(item.id, { status: "error", errorMsg: msg })
      return { ok: false }
    }
  }

  async function ingressAll() {
    const pending = items.filter((it) => it.status === "ready" || it.status === "error")
    if (pending.length === 0) return
    // validate
    const invalid = pending.find((it) => !it.name.trim() || it.price <= 0)
    if (invalid) {
      toast({
        title: "Datos incompletos",
        description: "Cada producto necesita nombre y un precio mayor a 0.",
        variant: "destructive",
      })
      return
    }
    setSavingAll(true)
    const savedCodes: string[] = []
    for (const it of pending) {
      const r = await saveItem(it)
      if (r.ok && r.code) savedCodes.push(r.code)
    }
    setSavingAll(false)
    const ok = savedCodes.length
    const failed = pending.length - ok
    // Preview de códigos: los primeros 3 completos y "…" si hay más, para
    // que el usuario confirme visualmente qué se creó sin ir a validar.
    const codesPreview =
      savedCodes.length > 3
        ? `${savedCodes.slice(0, 3).join(", ")} y ${savedCodes.length - 3} más`
        : savedCodes.join(", ")
    if (ok > 0 && failed === 0) {
      toast({
        title: `${ok} producto(s) ingresado(s)`,
        description: `Códigos: ${codesPreview}`,
      })
      onIngressed?.()
    } else if (ok > 0 && failed > 0) {
      // Fallo parcial: reporta ambos lados. Neutral (no destructive) porque
      // parte tuvo éxito; el detalle por-ítem sigue en cada card en rojo.
      toast({
        title: `${ok} ingresado(s), ${failed} con error`,
        description: `Creados: ${codesPreview}. Revisa las tarjetas en rojo para el detalle de los fallidos.`,
      })
      onIngressed?.()
    } else {
      // ok === 0: todos fallaron. Sin este toast global el usuario solo
      // veía errorMsg inline en cada card y podía parecer "no pasó nada".
      toast({
        title: `No se pudo ingresar ${failed} producto(s)`,
        description: "Revisa cada tarjeta para ver el mensaje de error.",
        variant: "destructive",
      })
    }
  }

  const readyCount = items.filter((it) => it.status === "ready" || it.status === "error").length

  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/15 p-2.5">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Ingreso inteligente con IA</h3>
              <p className="max-w-xl text-sm text-muted-foreground">
                Sube fotos o videos de las prendas. La IA detecta el tipo, la descripción, la talla y sugiere el precio
                y costo. Cada producto recibe un código único como{" "}
                <span className="font-mono font-medium text-foreground">CA-M-95-00</span>.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <Camera className="mr-2 h-4 w-4" />
              Subir foto / video
            </Button>
          </div>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="rounded-full bg-muted p-4">
              <ImageIcon className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Aún no has subido archivos. Toma una foto de la prenda o sube un video para comenzar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {items.length} archivo(s) · {readyCount} listo(s) para ingresar
            </p>
            <Button onClick={ingressAll} disabled={savingAll || readyCount === 0}>
              {savingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Ingresar todo ({readyCount})
            </Button>
          </div>

          <div className="grid gap-4">
            {items.map((item) => (
              <Card key={item.id} className={item.status === "done" ? "border-emerald-500/40 bg-emerald-500/5" : ""}>
                <CardContent className="flex flex-col gap-4 py-4 lg:flex-row">
                  {/* Media preview */}
                  <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-lg bg-muted lg:h-44 lg:w-44">
                    {item.isVideo ? (
                      <video src={item.dataUrl} className="h-full w-full object-cover" muted playsInline controls />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.dataUrl || "/placeholder.svg"} alt={item.name || "Producto"} className="h-full w-full object-cover" />
                    )}
                    <Badge variant="secondary" className="absolute left-2 top-2 gap-1">
                      {item.isVideo ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                      {item.isVideo ? "Video" : "Foto"}
                    </Badge>
                  </div>

                  {/* Fields */}
                  <div className="min-w-0 flex-1">
                    {item.status === "analyzing" ? (
                      <div className="flex h-full items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analizando con IA…
                      </div>
                    ) : item.status === "done" ? (
                      <div className="flex h-full flex-col items-start justify-center gap-2">
                        <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                          <Check className="h-3 w-3" /> Ingresado
                        </Badge>
                        <p className="text-sm text-muted-foreground">
                          Código asignado:{" "}
                          <span className="font-mono font-semibold text-foreground">{item.savedCode}</span>
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {item.errorMsg && (
                          <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                            {item.errorMsg}
                          </p>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <Label className="text-xs">Nombre del producto</Label>
                            <Input
                              value={item.name}
                              onChange={(e) => update(item.id, { name: e.target.value })}
                              placeholder="Ej: Camisa manga larga"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Tipo (prefijo)</Label>
                            <Input
                              value={item.type_prefix}
                              maxLength={4}
                              onChange={(e) => update(item.id, { type_prefix: e.target.value.toUpperCase() })}
                              placeholder="CA"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Categoría</Label>
                            <Input
                              value={item.category}
                              onChange={(e) => update(item.id, { category: e.target.value })}
                              placeholder="Camisas"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Talla</Label>
                            <Input
                              value={item.size}
                              onChange={(e) => update(item.id, { size: e.target.value.toUpperCase() })}
                              placeholder="M"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Color</Label>
                            <Input
                              value={item.color}
                              onChange={(e) => update(item.id, { color: e.target.value })}
                              placeholder="Azul"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Precio de venta (COP)</Label>
                            <MoneyInput
                              value={item.price}
                              onChange={(n) => update(item.id, { price: n ?? 0 })}
                              placeholder="95.000"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Costo de adquisición (COP)</Label>
                            <MoneyInput
                              value={item.cost}
                              onChange={(n) => update(item.id, { cost: n ?? 0 })}
                              placeholder="45.000"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Cantidad a ingresar</Label>
                            <Input
                              type="number"
                              value={item.quantity || ""}
                              onChange={(e) => update(item.id, { quantity: Number(e.target.value) })}
                              placeholder="1"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label className="text-xs">Código de identificación</Label>
                            <Input
                              value={item.code}
                              onChange={(e) => update(item.id, { code: e.target.value.toUpperCase() })}
                              placeholder={`Automático: ${codePreview(item)}`}
                              className="font-mono"
                            />
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Déjalo vacío para generarlo automáticamente ({codePreview(item)}). Este código será también
                              el código de barras del producto.
                            </p>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">Descripción</Label>
                          <Textarea
                            value={item.description}
                            onChange={(e) => update(item.id, { description: e.target.value })}
                            rows={2}
                            placeholder="Material, estilo, detalles…"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            Ingreso total:{" "}
                            <span className="font-medium text-foreground">
                              {formatCurrency((item.cost || 0) * (item.quantity || 0))}
                            </span>{" "}
                            en costo
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => update(item.id, { status: "analyzing", errorMsg: undefined }) || analyze(item.id, item.dataUrl, item.mediaType)}
                            >
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              Re-analizar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Quitar
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">{PREFIX_HINTS}</p>
        </>
      )}
    </div>
  )
}
