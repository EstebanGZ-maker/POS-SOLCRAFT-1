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
import { ingressNewProduct } from "@/lib/inventory-actions"
import { uploadProductImageClient } from "@/lib/storage-client"
import { createInitialItem, applyAnalysisToItem } from "@/lib/apply-analysis"
import type { RubroId, RubroUIBundle } from "@/lib/rubro-ui"
import { Sparkles, Camera, Loader2, Trash2, Check, ImageIcon, RefreshCw, Clock, Copy, AlertTriangle } from "lucide-react"

// Espaciado obligatorio entre requests a /api/analyze-product. Valor del
// perfil (`uiProfile.ui.constants.AI_MIN_INTERVAL_MS`). Hoy ambos rubros
// usan 6500 ms (rate limit del AI Gateway, independiente del rubro).

type ItemStatus = "queued" | "analyzing" | "ready" | "saving" | "done" | "error"

type IngressItem = {
  id: string
  file: File
  dataUrl: string
  status: ItemStatus
  savedCode?: string
  errorMsg?: string
  // editable fields
  name: string
  type_prefix: string  // Ropa: tipo de prenda. Tec: marca.
  category: string
  description: string
  size: string          // Ropa: talla. Tec: referencia.
  color: string
  price: number
  cost: number
  quantity: number
  code: string // manual override; empty = auto
}

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
  rubro,
  uiProfile,
  rubroError,
}: {
  centralWarehouseId: string
  centralSiteId: string
  onIngressed?: () => void
  rubro: RubroId | null
  uiProfile: RubroUIBundle | null
  rubroError?: string | null
}) {
  // Compuerta: sin rubro no se habilita subir ni se muestran defaults.
  // Nunca cae a ropa.
  if (rubroError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex items-start gap-3 py-6">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h3 className="font-semibold text-foreground">No se pudo cargar la configuración del negocio</h3>
            <p className="text-sm text-muted-foreground">{rubroError}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              El panel de ingreso con IA no está disponible hasta que la configuración se recupere.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }
  if (!rubro || !uiProfile) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando configuración del negocio…
        </CardContent>
      </Card>
    )
  }
  // Y.1: tecnología existe como perfil pero el formulario todavía no se
  // renderiza. Y.2 agrega Select de categoría, validación de referencia
  // y oculta precio/costo sugeridos. Hasta entonces el panel muestra un
  // aviso explícito.
  if (rubro === "tecnologia") {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 py-6">
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Ingreso con IA — soporte pendiente para este rubro</h3>
            <p className="text-sm text-muted-foreground">
              El perfil de tecnología está activo en la configuración del negocio, pero el formulario de
              ingreso con IA se habilita en la siguiente iteración (Y.2). Mientras tanto, usa el importador
              de Excel o el formulario manual en Inventario → Productos.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <AiIngressPanelRopa
      centralWarehouseId={centralWarehouseId}
      centralSiteId={centralSiteId}
      onIngressed={onIngressed}
      rubro={rubro}
      uiProfile={uiProfile}
    />
  )
}

function AiIngressPanelRopa({
  centralWarehouseId,
  centralSiteId,
  onIngressed,
  rubro,
  uiProfile,
}: {
  centralWarehouseId: string
  centralSiteId: string
  onIngressed?: () => void
  rubro: RubroId
  uiProfile: RubroUIBundle
}) {
  const { toast } = useToast()
  const [items, setItems] = useState<IngressItem[]>([])
  const [savingAll, setSavingAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const AI_MIN_INTERVAL_MS = uiProfile.ui.constants.AI_MIN_INTERVAL_MS
  // Acceso por clave al bundle de labels del perfil. El bundle es
  // `Record<UILabelKey, UILabelPair>` — las claves coinciden con los
  // campos de IngressItem, no con posiciones (para que, p.ej., el label
  // de "size" en tecnología sea realmente "Referencia" aun cuando aparezca
  // en otro orden visual que ropa).
  const LBL = uiProfile.ui.labels

  // Cola secuencial para respetar el rate-limit de Google Gemini. Chain de
  // promesas — cada nuevo request se encola detrás del anterior. `lastStartRef`
  // guarda cuándo arrancó el request previo para calcular el sleep necesario.
  // Concurrency = 1 por diseño: paralelizar simplifica la UI pero prácticamente
  // garantiza pegarle al techo de RPM con lotes de 5+ fotos.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const lastStartRef = useRef<number>(0)

  const update = (id: string, patch: Partial<IngressItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  function queueAnalyze(id: string, dataUrl: string, mediaType: string) {
    queueRef.current = queueRef.current.then(async () => {
      const now = Date.now()
      const wait = Math.max(0, AI_MIN_INTERVAL_MS - (now - lastStartRef.current))
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastStartRef.current = Date.now()
      update(id, { status: "analyzing" })
      await analyze(id, dataUrl, mediaType)
    })
  }

  // Duplicar tarjeta ya analizada — evita re-llamar a Gemini para variantes
  // de la misma prenda (misma foto, típicamente cambia solo la talla). Nace
  // en estado "ready" directo, con code vacío para que el server autogenere
  // sufijo NN distinto al original vía next_product_code. La imagen se
  // hereda como referencia (mismo File y dataUrl); al guardar cada producto
  // sube su propia copia al bucket product-media — semántica "cada producto
  // tiene su galería propia" queda intacta.
  function duplicateItem(id: string) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.id === id)
      if (idx === -1) return prev
      const original = prev[idx]
      const newItem: IngressItem = {
        ...original,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        status: "ready",
        savedCode: undefined,
        errorMsg: undefined,
        quantity: 1,
        code: "",
      }
      return [...prev.slice(0, idx + 1), newItem, ...prev.slice(idx + 1)]
    })
  }

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
        ...applyAnalysisToItem(product, rubro),
      })
    } catch {
      // Importante: en el catch NO reseteamos a defaults de ropa (XX/M);
      // tecnología debe quedar con los valores vacíos que ya tiene el item.
      // Para ropa, el item ya trae XX/M desde createInitialItem si vino sin
      // análisis previo exitoso.
      update(id, {
        status: "ready",
        errorMsg: "La IA no pudo analizar el archivo. Completa los datos manualmente.",
      })
    }
  }

  // Guard pre-flight: coincide con MAX_IMAGE_BYTES del bucket product-media
  // y del helper uploadProductImageClient. Toast amigable antes de crear
  // la card, evita gastar upload + análisis IA en archivos imposibles.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        const mb = (file.size / 1024 / 1024).toFixed(1)
        toast({
          title: "Archivo demasiado grande",
          description: `${file.name}: ${mb} MB. El máximo es 5 MB por archivo. Comprime la foto o toma una nueva.`,
          variant: "destructive",
        })
        continue
      }
      const dataUrl = await fileToDataUrl(file)
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const defaults = createInitialItem(rubro)
      const newItem: IngressItem = {
        id,
        file,
        dataUrl,
        status: "queued",
        ...defaults,
        code: "",
      }
      setItems((prev) => [...prev, newItem])
      queueAnalyze(id, dataUrl, file.type)
    }

    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function saveItem(item: IngressItem): Promise<{ ok: boolean; code?: string }> {
    update(item.id, { status: "saving", errorMsg: undefined })
    // Wrap try/catch: si uploadProductImageClient o ingressNewProduct
    // throwean (network, auth, exception no-esperada del RPC), el ítem
    // quedaba en "saving" permanente con spinner infinito y el toast
    // global nunca se disparaba — silent failure real.
    try {
      let imageUrl: string | null = null
      const up = await uploadProductImageClient(item.file)
      if (up.success) imageUrl = up.url

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
              <p className="max-w-xl text-sm text-muted-foreground">{uiProfile.ui.hero}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <Camera className="mr-2 h-4 w-4" />
              Subir foto
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
              Aún no has subido fotos. Toma una foto del producto para comenzar.
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.dataUrl || "/placeholder.svg"} alt={item.name || "Producto"} className="h-full w-full object-cover" />
                    <Badge variant="secondary" className="absolute left-2 top-2 gap-1">
                      <ImageIcon className="h-3 w-3" />
                      Foto
                    </Badge>
                  </div>

                  {/* Fields */}
                  <div className="min-w-0 flex-1">
                    {item.status === "queued" ? (
                      <div className="flex h-full items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        En cola…
                      </div>
                    ) : item.status === "analyzing" ? (
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
                            <Label className="text-xs">{LBL.name.label}</Label>
                            <Input
                              value={item.name}
                              onChange={(e) => update(item.id, { name: e.target.value })}
                              placeholder={LBL.name.placeholder ?? undefined}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{LBL.type_prefix.label}</Label>
                            <Input
                              value={item.type_prefix}
                              maxLength={LBL.type_prefix.maxLength ?? undefined}
                              onChange={(e) => update(item.id, { type_prefix: e.target.value.toUpperCase() })}
                              placeholder={LBL.type_prefix.placeholder ?? undefined}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{LBL.category.label}</Label>
                            <Input
                              value={item.category}
                              onChange={(e) => update(item.id, { category: e.target.value })}
                              placeholder={LBL.category.placeholder ?? undefined}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{LBL.size.label}</Label>
                            <Input
                              value={item.size}
                              onChange={(e) => update(item.id, { size: e.target.value.toUpperCase() })}
                              placeholder={LBL.size.placeholder ?? undefined}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{LBL.color.label}</Label>
                            <Input
                              value={item.color}
                              onChange={(e) => update(item.id, { color: e.target.value })}
                              placeholder={LBL.color.placeholder ?? undefined}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{LBL.price.label}</Label>
                            <MoneyInput
                              value={item.price}
                              onChange={(n) => update(item.id, { price: n ?? 0 })}
                              placeholder={LBL.price.placeholder ?? undefined}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{LBL.cost.label}</Label>
                            <MoneyInput
                              value={item.cost}
                              onChange={(n) => update(item.id, { cost: n ?? 0 })}
                              placeholder={LBL.cost.placeholder ?? undefined}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{LBL.quantity.label}</Label>
                            <Input
                              type="number"
                              value={item.quantity || ""}
                              onChange={(e) => update(item.id, { quantity: Number(e.target.value) })}
                              placeholder={LBL.quantity.placeholder ?? undefined}
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label className="text-xs">{LBL.code.label}</Label>
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
                          <Label className="text-xs">{LBL.description.label}</Label>
                          <Textarea
                            value={item.description}
                            onChange={(e) => update(item.id, { description: e.target.value })}
                            rows={2}
                            placeholder={LBL.description.placeholder ?? undefined}
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
                              onClick={() => {
                                update(item.id, { status: "queued", errorMsg: undefined })
                                queueAnalyze(item.id, item.dataUrl, item.file.type)
                              }}
                            >
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              Re-analizar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => duplicateItem(item.id)}
                            >
                              <Copy className="mr-1.5 h-3.5 w-3.5" />
                              Duplicar
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
          <p className="text-center text-xs text-muted-foreground">{uiProfile.ui.constants.PREFIX_HINTS}</p>
        </>
      )}
    </div>
  )
}
