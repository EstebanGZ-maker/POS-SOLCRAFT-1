"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { getProductsWithStock, getCategories, createBulkTransfer, receiveMerchandise, updateWholesalePrices } from "@/lib/inventory-actions"
import { getSitesWithWarehouses, getCentralWarehouse } from "@/lib/site-actions"
import { Send, PackagePlus, Search, Filter, Plus, Trash2, Warehouse, Sparkles, BarChart3 } from "lucide-react"
import { ProductPicker } from "@/components/inventory/product-picker"
import { AiIngressPanel } from "@/components/central/ai-ingress-panel"
import { FinancialPanel } from "@/components/central/financial-panel"
import { useSWRConfig } from "swr"

export default function CentralPage() {
  const { data: central } = useSWR("central-wh", getCentralWarehouse)
  const { mutate } = useSWRConfig()
  const centralWarehouseId = central?.warehouse_id ?? null
  const centralSiteId = central?.site?.site_id ?? null

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Bodega Central"
        description="Ingresa mercancía con IA y distribúyela de forma masiva a las sedes."
        icon={Warehouse}
      />

      {!central ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No se encontró la bodega central.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="ai" className="space-y-6">
          <TabsList>
            <TabsTrigger value="ai">
              <Sparkles className="h-4 w-4 mr-2" />
              Ingreso con IA
            </TabsTrigger>
            <TabsTrigger value="receive">
              <PackagePlus className="h-4 w-4 mr-2" />
              Entrada manual
            </TabsTrigger>
            <TabsTrigger value="send">
              <Send className="h-4 w-4 mr-2" />
              Envío a sedes
            </TabsTrigger>
            <TabsTrigger value="finance">
              <BarChart3 className="h-4 w-4 mr-2" />
              Compras y márgenes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ai">
            <AiIngressPanel
              centralWarehouseId={centralWarehouseId!}
              centralSiteId={centralSiteId!}
              onIngressed={() => mutate(["central-products", centralWarehouseId])}
            />
          </TabsContent>
          <TabsContent value="receive">
            <ReceivePanel centralWarehouseId={centralWarehouseId!} />
          </TabsContent>
          <TabsContent value="send">
            <BulkSendPanel centralWarehouseId={centralWarehouseId!} />
          </TabsContent>
          <TabsContent value="finance">
            <FinancialPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

/* ============ ENVÍO MASIVO ============ */
type SelMode = "individual" | "category" | "price"

function BulkSendPanel({ centralWarehouseId }: { centralWarehouseId: string }) {
  const { toast } = useToast()
  const { data: products = [], isLoading } = useSWR(["central-products", centralWarehouseId], () =>
    getProductsWithStock(centralWarehouseId),
  )
  const { data: categories = [] } = useSWR("categories", getCategories)
  const { data: sites = [] } = useSWR("sites-wh", getSitesWithWarehouses)

  const destinations = useMemo(
    () => sites.filter((s: any) => !s.is_central),
    [sites],
  )

  const [mode, setMode] = useState<SelMode>("individual")
  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState<string>("all")
  const [priceMin, setPriceMin] = useState("")
  const [priceMax, setPriceMax] = useState("")
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [destWarehouses, setDestWarehouses] = useState<string[]>([])
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [wholesalePrices, setWholesalePrices] = useState<Record<string, number>>({})

  useEffect(() => {
    if (products.length > 0) {
      const initial: Record<string, number> = {}
      products.forEach((p: any) => {
        initial[p.product_id] = p.wholesale_price != null
          ? Number(p.wholesale_price)
          : Number(p.cost || 0) + 2000
      })
      setWholesalePrices(initial)
    }
  }, [products])

  const availableProducts = useMemo(() => {
    return products.filter((p: any) => (p.warehouseStock ?? 0) > 0)
  }, [products])

  const filtered = useMemo(() => {
    let list = availableProducts
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p: any) => p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q),
      )
    }
    if (mode === "category" && categoryId !== "all") {
      list = list.filter((p: any) => p.category_id === categoryId)
    }
    if (mode === "price") {
      const min = priceMin ? Number(priceMin) : 0
      const max = priceMax ? Number(priceMax) : Number.POSITIVE_INFINITY
      list = list.filter((p: any) => Number(p.price) >= min && Number(p.price) <= max)
    }
    return list
  }, [availableProducts, search, mode, categoryId, priceMin, priceMax])

  // When using category/price mode, auto-select whole filtered set with qty 1
  function applyMassSelection() {
    const next: Record<string, number> = {}
    filtered.forEach((p: any) => {
      next[p.product_id] = selected[p.product_id] ?? 1
    })
    setSelected(next)
    toast({ title: "Selección aplicada", description: `${filtered.length} productos seleccionados.` })
  }

  function toggleProduct(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev }
      if (checked) next[id] = next[id] ?? 1
      else delete next[id]
      return next
    })
  }

  function setQty(id: string, qty: number, max: number) {
    setSelected((prev) => ({ ...prev, [id]: Math.max(1, Math.min(qty, max)) }))
  }

  function toggleDest(warehouseId: string, checked: boolean) {
    setDestWarehouses((prev) =>
      checked ? [...prev, warehouseId] : prev.filter((w) => w !== warehouseId),
    )
  }

  const selectedItems = useMemo(
    () =>
      Object.entries(selected).map(([product_id, quantity]) => {
        const p = products.find((x: any) => x.product_id === product_id)
        const wp = wholesalePrices[product_id] ?? (Number(p?.cost || 0) + 2000)
        return {
          product_id, quantity, name: p?.name || "",
          max: p?.warehouseStock ?? 0,
          cost: Number(p?.cost || 0),
          wholesalePrice: wp,
          retailPrice: Number(p?.price || 0),
        }
      }),
    [selected, products, wholesalePrices],
  )

  async function handleSend() {
    if (!destWarehouses.length) {
      toast({ title: "Selecciona destino", description: "Elige al menos una sede.", variant: "destructive" })
      return
    }
    if (!selectedItems.length) {
      toast({ title: "Selecciona productos", description: "Agrega al menos un producto.", variant: "destructive" })
      return
    }
    setSubmitting(true)
    const wpUpdates = selectedItems.map((i) => ({
      product_id: i.product_id,
      wholesale_price: i.wholesalePrice,
    }))
    await updateWholesalePrices(wpUpdates)
    const res = await createBulkTransfer({
      from_warehouse_id: centralWarehouseId,
      to_warehouse_ids: destWarehouses,
      notes,
      items: selectedItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
    })
    setSubmitting(false)
    if (res.success) {
      toast({ title: "Envío realizado", description: res.message })
      setSelected({})
      setNotes("")
    } else {
      toast({ title: "Error en el envío", description: res.message, variant: "destructive" })
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: selection */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Seleccionar productos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={mode === "individual" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("individual")}
              >
                Individual
              </Button>
              <Button
                variant={mode === "category" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("category")}
              >
                Por categoría
              </Button>
              <Button
                variant={mode === "price" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("price")}
              >
                Por precio
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre o código"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {mode === "category" && (
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las categorías</SelectItem>
                    {categories.map((c: any) => (
                      <SelectItem key={c.category_id} value={c.category_id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {mode === "price" && (
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Mín"
                    value={priceMin}
                    onChange={(e) => setPriceMin(e.target.value)}
                    className="w-28"
                  />
                  <Input
                    type="number"
                    placeholder="Máx"
                    value={priceMax}
                    onChange={(e) => setPriceMax(e.target.value)}
                    className="w-28"
                  />
                </div>
              )}
            </div>

            {(mode === "category" || mode === "price") && (
              <Button variant="secondary" size="sm" onClick={applyMassSelection}>
                <Filter className="h-4 w-4 mr-2" />
                Seleccionar {filtered.length} productos filtrados
              </Button>
            )}

            <div className="border rounded-md max-h-[420px] overflow-auto">
              {isLoading ? (
                <div className="p-6 text-center text-muted-foreground text-sm">Cargando productos...</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  No hay productos con existencias en la central para este filtro.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left">
                      <th className="p-2 w-10"></th>
                      <th className="p-2">Producto</th>
                      <th className="p-2 text-right">Costo</th>
                      <th className="p-2 text-right">P. Mayor</th>
                      <th className="p-2 text-right">P. Detal</th>
                      <th className="p-2 text-right">Disp.</th>
                      <th className="p-2 text-right w-24">Cant.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p: any) => {
                      const isSel = selected[p.product_id] != null
                      const wp = wholesalePrices[p.product_id] ?? (Number(p.cost || 0) + 2000)
                      return (
                        <tr key={p.product_id} className="border-t">
                          <td className="p-2">
                            <Checkbox
                              checked={isSel}
                              onCheckedChange={(c) => toggleProduct(p.product_id, Boolean(c))}
                            />
                          </td>
                          <td className="p-2">
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.code || "—"}</div>
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {formatCurrency(Number(p.cost || 0))}
                          </td>
                          <td className="p-2 text-right">
                            <MoneyInput
                              value={wp}
                              onChange={(n) =>
                                setWholesalePrices((prev) => ({
                                  ...prev,
                                  [p.product_id]: n ?? 0,
                                }))
                              }
                              className="h-8 w-24 ml-auto text-right"
                            />
                          </td>
                          <td className="p-2 text-right font-medium text-green-600 dark:text-green-400">
                            {formatCurrency(Number(p.price))}
                          </td>
                          <td className="p-2 text-right">{p.warehouseStock}</td>
                          <td className="p-2 text-right">
                            <Input
                              type="number"
                              min={1}
                              max={p.warehouseStock}
                              disabled={!isSel}
                              value={isSel ? selected[p.product_id] : ""}
                              onChange={(e) =>
                                setQty(p.product_id, Number(e.target.value), p.warehouseStock)
                              }
                              className="h-8 w-20 ml-auto text-right"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: destinations + summary */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sedes destino</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {destinations.map((s: any) => {
              const wh = s.warehouses?.[0]
              if (!wh) return null
              const checked = destWarehouses.includes(wh.warehouse_id)
              return (
                <label
                  key={s.site_id}
                  className="flex items-center gap-3 rounded-md border p-2 cursor-pointer hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => toggleDest(wh.warehouse_id, Boolean(c))}
                  />
                  <span className="text-sm font-medium">{s.name}</span>
                </label>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Resumen del envío</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Productos</span>
              <Badge variant="secondary">{selectedItems.length}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Unidades</span>
              <Badge variant="secondary">
                {selectedItems.reduce((s, i) => s + i.quantity, 0)}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sedes</span>
              <Badge variant="secondary">{destWarehouses.length}</Badge>
            </div>
            {selectedItems.length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Costo total</span>
                  <span>{formatCurrency(selectedItems.reduce((s, i) => s + i.cost * i.quantity, 0))}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Venta al por mayor</span>
                  <span className="font-medium">
                    {formatCurrency(selectedItems.reduce((s, i) => s + i.wholesalePrice * i.quantity, 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Venta al detal</span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {formatCurrency(selectedItems.reduce((s, i) => s + i.retailPrice * i.quantity, 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">Margen mayorista</span>
                  <span className="text-amber-600 dark:text-amber-400">
                    {formatCurrency(selectedItems.reduce((s, i) => s + (i.wholesalePrice - i.cost) * i.quantity, 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Margen al detal</span>
                  <span className="text-green-600 dark:text-green-400">
                    {formatCurrency(selectedItems.reduce((s, i) => s + (i.retailPrice - i.cost) * i.quantity, 0))}
                  </span>
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Observaciones</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas del envío"
                className="mt-1"
              />
            </div>
            <Button className="w-full" onClick={handleSend} disabled={submitting}>
              <Send className="h-4 w-4 mr-2" />
              {submitting ? "Enviando..." : "Enviar mercancía"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* ============ ENTRADA DE MERCANCÍA ============ */
function ReceivePanel({ centralWarehouseId }: { centralWarehouseId: string }) {
  const { toast } = useToast()
  const { data: products = [] } = useSWR("all-products", () => getProductsWithStock())
  const [rows, setRows] = useState<{ product_id: string; cost: number; quantity: number }[]>([
    { product_id: "", cost: 0, quantity: 1 },
  ])
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function updateRow(i: number, patch: Partial<{ product_id: string; cost: number; quantity: number }>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function onPickProduct(i: number, product_id: string) {
    const p = products.find((x: any) => x.product_id === product_id)
    updateRow(i, { product_id, cost: p ? Number(p.cost) : 0 })
  }

  const total = rows.reduce((s, r) => s + r.cost * r.quantity, 0)

  async function handleReceive() {
    const valid = rows.filter((r) => r.product_id && r.quantity > 0)
    if (!valid.length) {
      toast({ title: "Agrega productos", description: "Selecciona al menos un producto.", variant: "destructive" })
      return
    }
    setSubmitting(true)
    const res = await receiveMerchandise({ warehouse_id: centralWarehouseId, notes, items: valid })
    setSubmitting(false)
    if (res.success) {
      toast({ title: "Mercancía ingresada", description: "El stock de la central fue actualizado." })
      setRows([{ product_id: "", cost: 0, quantity: 1 }])
      setNotes("")
    } else {
      toast({ title: "Error", description: res.message, variant: "destructive" })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ingresar mercancía a la Bodega Central</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                {i === 0 && <Label className="text-xs">Producto</Label>}
                <ProductPicker
                  products={products}
                  value={r.product_id}
                  onChange={(id) => onPickProduct(i, id)}
                />
              </div>
              <div className="col-span-3">
                {i === 0 && <Label className="text-xs">Costo</Label>}
                <MoneyInput
                  value={r.cost}
                  onChange={(n) => updateRow(i, { cost: n ?? 0 })}
                />
              </div>
              <div className="col-span-2">
                {i === 0 && <Label className="text-xs">Cantidad</Label>}
                <Input
                  type="number"
                  min={1}
                  value={r.quantity}
                  onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={rows.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows((prev) => [...prev, { product_id: "", cost: 0, quantity: 1 }])}
        >
          <Plus className="h-4 w-4 mr-2" />
          Agregar producto
        </Button>

        <div>
          <Label className="text-xs">Observaciones</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <span className="text-lg font-semibold">Total entrada: {formatCurrency(total)}</span>
          <Button onClick={handleReceive} disabled={submitting}>
            <PackagePlus className="h-4 w-4 mr-2" />
            {submitting ? "Ingresando..." : "Ingresar mercancía"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
