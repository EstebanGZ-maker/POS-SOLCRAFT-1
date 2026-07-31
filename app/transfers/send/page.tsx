"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useSite } from "@/lib/site-context"
import {
  getOriginWarehouses, getTransferStockView, createBulkTransfer,
} from "@/lib/inventory-actions"
import { getSitesWithWarehouses } from "@/lib/site-actions"
import {
  Send, Search, Package, ArrowRight, Loader2, Store, Warehouse, AlertTriangle,
} from "lucide-react"

export default function SendTransferPage() {
  const { toast } = useToast()
  const { currentSite } = useSite()

  const { data: origins = [] } = useSWR("origin-warehouses", getOriginWarehouses)
  const { data: allSites = [] } = useSWR("sites-warehouses", getSitesWithWarehouses)

  const [fromWarehouseId, setFromWarehouseId] = useState<string>("")
  const [toWarehouseIds, setToWarehouseIds] = useState<string[]>([])
  const [qty, setQty] = useState<Record<string, number>>({})
  const [search, setSearch] = useState("")
  const [notes, setNotes] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)

  // Preselecciona la bodega principal de la sede activa
  useEffect(() => {
    if (fromWarehouseId || origins.length === 0) return
    const preferred =
      origins.find((w: any) => w.site_id === currentSite?.site_id && w.is_primary) ||
      origins.find((w: any) => w.site_id === currentSite?.site_id) ||
      origins[0]
    if (preferred) setFromWarehouseId(preferred.warehouse_id)
  }, [origins, currentSite, fromWarehouseId])

  // Al cambiar de origen se reinicia la selección
  useEffect(() => {
    setToWarehouseIds([])
    setQty({})
  }, [fromWarehouseId])

  const originWh = origins.find((w: any) => w.warehouse_id === fromWarehouseId)

  // Destinos posibles: todas las bodegas no-sistema de OTRAS sedes, central incluida
  const destinationOptions = useMemo(() => {
    if (!originWh) return []
    const out: { warehouse_id: string; label: string; siteName: string; isCentral: boolean }[] = []
    for (const s of allSites as any[]) {
      if (s.site_id === originWh.site_id) continue // no a la misma sede
      for (const w of s.warehouses || []) {
        // La bodega de Tránsito es interna del sistema: nunca es destino manual
        if (w.is_system) continue
        out.push({
          warehouse_id: w.warehouse_id,
          label: w.is_primary ? s.name : `${s.name} · ${w.name}`,
          siteName: s.name,
          isCentral: Boolean(s.is_central),
        })
      }
    }
    return out.sort((a, b) => Number(b.isCentral) - Number(a.isCentral) || a.label.localeCompare(b.label))
  }, [allSites, originWh])

  const { data: stockRows = [], isLoading: loadingStock } = useSWR(
    fromWarehouseId ? ["transfer-stock", fromWarehouseId, toWarehouseIds.join(",")] : null,
    () => getTransferStockView({ from_warehouse_id: fromWarehouseId, to_warehouse_ids: toWarehouseIds }),
    { keepPreviousData: true },
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return stockRows
    return (stockRows as any[]).filter(
      (p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q),
    )
  }, [stockRows, search])

  const selectedItems = useMemo(
    () =>
      (stockRows as any[])
        .filter((p) => (qty[p.product_id] || 0) > 0)
        .map((p) => ({ ...p, quantity: qty[p.product_id] })),
    [stockRows, qty],
  )

  const totalUnits = selectedItems.reduce((s, i) => s + i.quantity, 0)

  // Enviar la misma cantidad a N destinos multiplica la salida de origen
  const unitsPerProductNeeded = (productId: string) =>
    (qty[productId] || 0) * Math.max(1, toWarehouseIds.length)

  const overstocked = (stockRows as any[]).filter(
    (p) => unitsPerProductNeeded(p.product_id) > p.origin_qty,
  )

  const canSend =
    fromWarehouseId && toWarehouseIds.length > 0 && selectedItems.length > 0 && overstocked.length === 0

  function toggleDestination(id: string) {
    setToWarehouseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function setQuantity(productId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(value || 0, max))
    setQty((prev) => ({ ...prev, [productId]: clamped }))
  }

  async function handleSend() {
    setSending(true)
    const res = await createBulkTransfer({
      from_warehouse_id: fromWarehouseId,
      to_warehouse_ids: toWarehouseIds,
      notes: notes || null,
      items: selectedItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
    })
    setSending(false)
    setConfirmOpen(false)

    toast({
      title: res.success ? "Envío registrado" : "Error en el envío",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })

    if (res.success) {
      setQty({})
      setNotes("")
      setToWarehouseIds([])
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Enviar mercancía"
        description="Despacha stock de esta sede hacia otra sede o hacia la bodega central."
        icon={Send}
      />

      {/* Origen y destinos */}
      <Card>
        <CardHeader><CardTitle className="text-base">Origen y destino</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Enviar desde</Label>
            <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
              <SelectTrigger className="sm:w-96">
                <SelectValue placeholder="Elige la bodega de origen" />
              </SelectTrigger>
              <SelectContent>
                {origins.map((w: any) => (
                  <SelectItem key={w.warehouse_id} value={w.warehouse_id}>
                    {w.sites?.name}{w.is_primary ? "" : ` · ${w.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {origins.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No tienes bodegas asignadas desde las que enviar.
              </p>
            )}
          </div>

          <Separator />

          <div>
            <Label className="mb-2 block">Enviar a</Label>
            {destinationOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay otras sedes disponibles como destino.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {destinationOptions.map((d) => {
                  const checked = toWarehouseIds.includes(d.warehouse_id)
                  return (
                    // No usar <label>: envolver el Checkbox de Radix hace que el clic
                    // se propague al botón y al input oculto, alternando dos veces.
                    <div
                      key={d.warehouse_id}
                      role="checkbox"
                      aria-checked={checked}
                      tabIndex={0}
                      onClick={() => toggleDestination(d.warehouse_id)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault()
                          toggleDestination(d.warehouse_id)
                        }
                      }}
                      className={`flex items-center gap-2 rounded-md border p-3 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        checked ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                      }`}
                    >
                      <Checkbox checked={checked} className="pointer-events-none" tabIndex={-1} />
                      {d.isCentral ? (
                        <Warehouse className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-sm flex-1 min-w-0">{d.label}</span>
                      {d.isCentral && (
                        <Badge variant="outline" className="text-[10px]">Devolución</Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {toWarehouseIds.length > 1 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Vas a enviar la misma cantidad a {toWarehouseIds.length} destinos: cada unidad
                se descuenta {toWarehouseIds.length} veces del origen.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Productos */}
      {fromWarehouseId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Productos</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingStock && (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!loadingStock && filtered.length === 0 && (
              <div className="py-10 text-center text-muted-foreground">
                <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                {search ? "Ningún producto coincide." : "Esta bodega no tiene existencias."}
              </div>
            )}

            <div className="space-y-2">
              {filtered.map((p: any) => {
                const needed = unitsPerProductNeeded(p.product_id)
                const excede = needed > p.origin_qty
                return (
                  <div
                    key={p.product_id}
                    className={`flex items-center gap-3 rounded-md border p-3 ${
                      excede ? "border-destructive/60 bg-destructive/5" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {p.code}
                        </span>
                        {p.size && (
                          <Badge variant="outline" className="text-[10px]">Talla {p.size}</Badge>
                        )}
                      </div>
                      <div className="truncate text-sm font-medium">{p.name}</div>

                      {/* Stock aquí y allá */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="text-muted-foreground">
                          Aquí: <b className="text-foreground">{p.origin_qty}</b>
                        </span>
                        {toWarehouseIds.map((wid) => {
                          const dest = destinationOptions.find((d) => d.warehouse_id === wid)
                          const there = p.destinations?.[wid] ?? 0
                          return (
                            <span key={wid} className="text-muted-foreground">
                              {dest?.siteName}: <b className={there === 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}>{there}</b>
                            </span>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={p.origin_qty}
                        value={qty[p.product_id] ?? ""}
                        placeholder="0"
                        className="h-9 w-20 text-center"
                        onChange={(e) =>
                          setQuantity(p.product_id, Number(e.target.value), p.origin_qty)
                        }
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumen y confirmación */}
      {selectedItems.length > 0 && (
        <Card className="sticky bottom-4 shadow-lg">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="text-sm font-medium">
                {selectedItems.length} producto(s) · {totalUnits} unidad(es)
                {toWarehouseIds.length > 1 && ` × ${toWarehouseIds.length} destinos`}
              </div>
              {overstocked.length > 0 && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Hay cantidades que superan la existencia disponible.
                </div>
              )}
            </div>
            <Button disabled={!canSend} onClick={() => setConfirmOpen(true)} className="gap-2">
              Revisar envío <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Confirmación */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirmar envío</DialogTitle>
            <DialogDescription>
              El stock sale de origen y queda en tránsito hasta que el destino lo reciba.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground text-xs">Desde</div>
              <div className="font-medium">
                {originWh?.sites?.name}{originWh?.is_primary ? "" : ` · ${originWh?.name}`}
              </div>
              <div className="mt-2 text-muted-foreground text-xs">Hacia</div>
              <ul className="font-medium">
                {toWarehouseIds.map((id) => (
                  <li key={id}>
                    {destinationOptions.find((d) => d.warehouse_id === id)?.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1.5">
              {selectedItems.map((i) => (
                <div key={i.product_id} className="flex justify-between text-sm">
                  <span className="truncate">{i.name}</span>
                  <span className="ml-2 font-medium whitespace-nowrap">{i.quantity} u.</span>
                </div>
              ))}
            </div>

            <div>
              <Label>Notas (opcional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Motivo del envío, referencia, etc."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={handleSend} disabled={sending} className="gap-2">
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar envío
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
