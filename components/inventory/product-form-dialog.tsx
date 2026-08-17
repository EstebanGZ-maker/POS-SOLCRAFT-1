"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { saveProduct, uploadProductMedia } from "@/lib/inventory-actions"
import { compressImage, formatBytes } from "@/lib/image-compress"
import { ProductGalleryManager } from "@/components/inventory/product-gallery-manager"
import { ImageIcon, Loader2, Upload, X } from "lucide-react"

type Category = { category_id: string; name: string }
type Warehouse = { warehouse_id: string; name: string; site_name?: string }

const TAX_OPTIONS = [
  { label: "Ninguno (0%)", value: 0 },
  { label: "IVA 5%", value: 5 },
  { label: "IVA 19%", value: 19 },
]

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  categories,
  warehouses,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  product?: any | null
  categories: Category[]
  warehouses: Warehouse[]
  onSaved: () => void
}) {
  const editing = !!product?.product_id
  const [saving, setSaving] = useState(false)
  const [imageUrl, setImageUrl] = useState<string>("")
  const [uploadingImage, setUploadingImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    name: "",
    code: "",
    category_id: "",
    unit: "Unidad",
    cost: "0",
    price: "0",
    tax_rate: 0,
    is_service: false,
    is_favorite: false,
    barcode: "",
    size: "",
    description: "",
    initial_stock: "0",
    initial_warehouse_id: warehouses[0]?.warehouse_id ?? "",
  })

  useEffect(() => {
    if (open) {
      setImageUrl(product?.image_url ?? "")
      setForm({
        name: product?.name ?? "",
        code: product?.code ?? "",
        category_id: product?.category_id ?? product?.categories?.category_id ?? "",
        unit: product?.unit ?? "Unidad",
        cost: String(product?.cost ?? 0),
        price: String(product?.price ?? 0),
        tax_rate: Number(product?.tax_rate ?? 0),
        is_service: product?.is_service ?? false,
        is_favorite: product?.is_favorite ?? false,
        barcode: product?.barcode ?? "",
        size: product?.size ?? "",
        description: product?.description ?? "",
        initial_stock: "0",
        initial_warehouse_id: warehouses[0]?.warehouse_id ?? "",
      })
    }
  }, [open, product, warehouses])

  const priceNum = Number(form.price) || 0
  const finalPrice = priceNum * (1 + form.tax_rate / 100)

  const handleImage = async (file?: File) => {
    if (!file) return
    setUploadingImage(true)
    try {
      // Comprimir antes de subir: una foto de celular pasa de MB a KB
      const compressed = await compressImage(file)
      const res = await uploadProductMedia(compressed.dataUrl)
      if (res.success && res.url) {
        setImageUrl(res.url)
        const ahorro = compressed.originalBytes - compressed.compressedBytes
        if (ahorro > 0) {
          toast({
            title: "Imagen lista",
            description: `Comprimida de ${formatBytes(compressed.originalBytes)} a ${formatBytes(compressed.compressedBytes)}.`,
          })
        }
      } else {
        toast({ title: "Error al subir la imagen", description: res.message, variant: "destructive" })
      }
    } catch (e: any) {
      toast({
        title: "No se pudo procesar la imagen",
        description: e?.message || "Error desconocido",
        variant: "destructive",
      })
    } finally {
      setUploadingImage(false)
      if (imageInputRef.current) imageInputRef.current.value = ""
    }
  }

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ title: "Falta el nombre", variant: "destructive" })
      return
    }
    setSaving(true)
    const res = await saveProduct({
      product_id: product?.product_id ?? null,
      name: form.name,
      code: form.code,
      category_id: form.category_id || null,
      unit: form.unit,
      cost: Number(form.cost) || 0,
      price: priceNum,
      tax_rate: form.tax_rate,
      is_service: form.is_service,
      is_favorite: form.is_favorite,
      barcode: form.barcode,
      size: form.size,
      description: form.description,
      image_url: imageUrl || null,
      initial_stock: Number(form.initial_stock) || 0,
      initial_warehouse_id: form.initial_warehouse_id || null,
    })
    setSaving(false)
    if (res.success) {
      toast({ title: editing ? "Producto actualizado" : "Producto creado" })
      onOpenChange(false)
      onSaved()
    } else {
      toast({ title: "Error", description: res.message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar producto de venta" : "Nuevo producto de venta"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Datos generales</h3>

            {/* Producto existente: galería completa. Producto nuevo: una foto,
                que al guardar queda como principal y se puede ampliar después. */}
            {editing && product?.product_id ? (
              <ProductGalleryManager productId={product.product_id} />
            ) : (
            <div className="flex items-center gap-4">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border bg-muted">
                {imageUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl || "/placeholder.svg"} alt="Producto" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImageUrl("")}
                      className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-foreground hover:bg-background"
                      aria-label="Quitar imagen"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Imagen del producto</Label>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImage(e.target.files?.[0])}
                />
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={uploadingImage}
                  >
                    {uploadingImage ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {imageUrl ? "Cambiar imagen" : "Subir imagen"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Se comprime automáticamente. Al guardar podrás agregar más fotos.
                </p>
              </div>
            </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.category_id} value={c.category_id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Referencia / Código</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Unidad de medida</Label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Costo inicial</Label>
                <MoneyInput
                  value={Number(form.cost) || 0}
                  onChange={(n) => setForm({ ...form, cost: String(n ?? 0) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Precio base *</Label>
                <MoneyInput
                  value={Number(form.price) || 0}
                  onChange={(n) => setForm({ ...form, price: String(n ?? 0) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Impuestos</Label>
                <Select
                  value={String(form.tax_rate)}
                  onValueChange={(v) => setForm({ ...form, tax_rate: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={String(t.value)}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              Precio final:{" "}
              <span className="font-semibold text-foreground">
                ${Math.round(finalPrice).toLocaleString("es-CO")}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
          </section>

          <section className="space-y-4 border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground">Detalles adicionales</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Código de barras</Label>
                <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Talla</Label>
                <Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm">Es un servicio (sin control de stock)</span>
              <Switch checked={form.is_service} onCheckedChange={(v) => setForm({ ...form, is_service: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm">Favorito en el POS</span>
              <Switch checked={form.is_favorite} onCheckedChange={(v) => setForm({ ...form, is_favorite: v })} />
            </div>
          </section>

          {!editing && !form.is_service && (
            <section className="space-y-4 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">Inventario inicial</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Bodega</Label>
                  <Select
                    value={form.initial_warehouse_id}
                    onValueChange={(v) => setForm({ ...form, initial_warehouse_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.warehouse_id} value={w.warehouse_id}>
                          {w.site_name ? `${w.site_name} - ${w.name}` : w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cantidad inicial</Label>
                  <Input
                    type="number"
                    value={form.initial_stock}
                    onChange={(e) => setForm({ ...form, initial_stock: e.target.value })}
                  />
                </div>
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
