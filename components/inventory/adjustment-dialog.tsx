"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, AlertTriangle, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { formatCurrency } from "@/lib/utils"
import { createAdjustment } from "@/lib/inventory-actions"
import { MultiProductPicker } from "@/components/inventory/multi-product-picker"

// Umbral de confirmación extra para merma — en pesos COP. Por encima de este
// monto el diálogo pide confirmación explícita antes de llamar al RPC.
const MERMA_CONFIRMATION_THRESHOLD = 500_000

type Warehouse = { warehouse_id: string; name: string; site_name?: string }
type Motivo = "compra" | "sobrante" | "correccion"
type Row = {
  product_id: string
  name: string
  cost: number
  objective: "incrementar" | "disminuir"
  quantity: number
  // WAC vigente del producto al abrir el diálogo — solo referencia visual,
  // no se envía al RPC. El servidor recalcula WAC con el `cost` que ingresó
  // el usuario (17b) para items incrementar con cost>0.
  currentCost: number
}

// Lee el stock del producto en una bodega específica a partir de la lista
// cargada por SWR (que ya trae `product_stock` relación). Devuelve 0 si
// no hay fila (producto nuevo o sin movimientos en esa bodega).
function stockAtWarehouse(product: any, warehouse_id: string | null): number {
  if (!warehouse_id || !product) return 0
  const rows = (product.product_stock || []) as Array<{ warehouse_id: string; quantity: number }>
  const match = rows.find((r) => r.warehouse_id === warehouse_id)
  return Number(match?.quantity ?? 0)
}

export function AdjustmentDialog({
  open,
  onOpenChange,
  warehouses,
  products,
  onSaved,
  initialWarehouseId,
  initialProductIds,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  warehouses: Warehouse[]
  products: any[]
  onSaved: () => void
  // Precarga: la página de Productos y servicios abre este diálogo con la
  // bodega y los productos ya seleccionados. Si vienen vacíos, se usa el
  // comportamiento original (primera bodega + rows vacías).
  initialWarehouseId?: string | null
  initialProductIds?: string[]
}) {
  const [warehouseId, setWarehouseId] = useState(
    initialWarehouseId || warehouses[0]?.warehouse_id || "",
  )
  const [notes, setNotes] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [motivo, setMotivo] = useState<Motivo | "">("")
  const [saving, setSaving] = useState(false)
  const [bulkObjective, setBulkObjective] = useState<"incrementar" | "disminuir" | "">("")
  const [bulkQty, setBulkQty] = useState<string>("")

  const productsById = useMemo(() => {
    const m = new Map<string, any>()
    for (const p of products) m.set(p.product_id, p)
    return m
  }, [products])

  const buildRow = (product_id: string, name: string, currentCost: number): Row => ({
    product_id,
    name,
    cost: currentCost,
    objective: "incrementar",
    quantity: 1,
    currentCost,
  })

  // Precarga al abrir el diálogo. Cada vez que `open` pasa de false a true
  // sincronizamos warehouse + rows con lo que la página puso en los props
  // iniciales. Cerrar el diálogo mantiene lo escrito dentro para que un
  // close accidental no pierda el trabajo; una re-apertura explícita del
  // caller lo pisa.
  useEffect(() => {
    if (!open) return
    setWarehouseId((prev) => initialWarehouseId || prev || warehouses[0]?.warehouse_id || "")
    if (initialProductIds && initialProductIds.length > 0) {
      setRows((prev) => {
        const existing = new Set(prev.map((r) => r.product_id))
        const extra: Row[] = []
        for (const id of initialProductIds) {
          if (existing.has(id)) continue
          const full = productsById.get(id)
          if (!full) continue
          extra.push(buildRow(full.product_id, full.name, Number(full.cost ?? 0)))
        }
        return [...prev, ...extra]
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const alreadyAdded = useMemo(() => new Set(rows.map((r) => r.product_id)), [rows])

  const total = useMemo(() => rows.reduce((s, r) => s + r.cost * r.quantity, 0), [rows])
  const hasIncrementar = useMemo(() => rows.some((r) => r.objective === "incrementar"), [rows])
  const only100Disminuir = rows.length > 0 && !hasIncrementar
  // Gasto por merma anticipado: suma de disminuciones con costo > 0. El RPC
  // registra el gasto real al cerrar la transacción; esto es solo el aviso UI.
  const mermaGasto = useMemo(
    () =>
      rows.reduce(
        (s, r) => (r.objective === "disminuir" && r.cost > 0 ? s + r.cost * r.quantity : s),
        0,
      ),
    [rows],
  )
  const firstDisminuirCode = useMemo(() => {
    const firstDis = rows.find((r) => r.objective === "disminuir" && r.cost > 0)
    if (!firstDis) return null
    const full = productsById.get(firstDis.product_id)
    return (full?.code as string | undefined) || null
  }, [rows, productsById])

  // Reglas por fila: la validación "Disminuir no puede exceder stock" la
  // hace el servidor también; acá la anticipamos para dar feedback inmediato
  // y bloquear "Crear ajuste" si alguna fila incumple.
  const rowErrors = useMemo(() => {
    const errs: Record<string, string> = {}
    for (const r of rows) {
      if (r.quantity <= 0) {
        errs[r.product_id] = "La cantidad debe ser mayor a 0."
        continue
      }
      if (r.objective === "disminuir") {
        const stock = stockAtWarehouse(productsById.get(r.product_id), warehouseId || null)
        if (r.quantity > stock) {
          errs[r.product_id] = `Disminuir ${r.quantity} supera el stock actual (${stock}) de esta bodega.`
        }
      }
    }
    return errs
  }, [rows, productsById, warehouseId])
  const hasRowErrors = Object.keys(rowErrors).length > 0

  const addMany = (ps: Array<{ product_id: string; name: string }>) => {
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.product_id))
      const toAdd: Row[] = []
      for (const p of ps) {
        if (existing.has(p.product_id)) continue
        const full = productsById.get(p.product_id)
        if (!full) continue
        toAdd.push(buildRow(full.product_id, full.name, Number(full.cost ?? 0)))
      }
      return [...prev, ...toAdd]
    })
  }

  const update = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.product_id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.product_id !== id))

  // ---- Acciones masivas sobre las filas ya agregadas -----------------

  const applyBulkObjective = () => {
    if (!bulkObjective) return
    setRows((prev) => prev.map((r) => ({ ...r, objective: bulkObjective })))
  }
  const applyBulkQuantity = () => {
    const n = Number(bulkQty)
    if (!Number.isFinite(n) || n <= 0) return
    setRows((prev) => prev.map((r) => ({ ...r, quantity: n })))
  }
  const bringAllToZero = () => {
    setRows((prev) =>
      prev.map((r) => {
        const stock = stockAtWarehouse(productsById.get(r.product_id), warehouseId || null)
        if (stock <= 0) return r
        return { ...r, objective: "disminuir" as const, quantity: stock }
      }),
    )
  }
  const anyRowHasStock = useMemo(
    () =>
      rows.some(
        (r) => stockAtWarehouse(productsById.get(r.product_id), warehouseId || null) > 0,
      ),
    [rows, productsById, warehouseId],
  )

  const submit = async () => {
    if (!warehouseId) return toast({ title: "Selecciona una bodega", variant: "destructive" })
    if (rows.length === 0) return toast({ title: "Agrega al menos un producto", variant: "destructive" })
    if (hasRowErrors) {
      return toast({
        title: "Hay filas con errores",
        description: "Revisa las filas marcadas en rojo antes de crear el ajuste.",
        variant: "destructive",
      })
    }
    if (hasIncrementar && !motivo) {
      return toast({ title: "Selecciona un motivo", description: "Los ajustes con incrementos requieren motivo.", variant: "destructive" })
    }
    if (only100Disminuir && motivo) {
      return toast({ title: "Motivo no aplica", description: "Los ajustes 100% disminución no llevan motivo.", variant: "destructive" })
    }
    if (motivo === "correccion" && !notes.trim()) {
      return toast({ title: "Justificación requerida", description: "Los ajustes de corrección requieren observaciones.", variant: "destructive" })
    }
    if (mermaGasto > MERMA_CONFIRMATION_THRESHOLD) {
      const ok = window.confirm(
        `El gasto por merma de este ajuste es ${formatCurrency(mermaGasto)} y supera ` +
          `${formatCurrency(MERMA_CONFIRMATION_THRESHOLD)}. ` +
          `¿Confirmás que querés registrarlo como merma? ` +
          `Si es un duplicado o ingreso equivocado, cancelá y anulá el ajuste de ingreso original.`,
      )
      if (!ok) return
    }
    setSaving(true)
    const res = await createAdjustment({
      warehouse_id: warehouseId,
      notes,
      items: rows.map(({ currentCost: _c, name: _n, ...it }) => it),
      motivo: only100Disminuir ? null : (motivo as Motivo),
    })
    setSaving(false)
    if (res.success) {
      toast({ title: "Ajuste creado", description: res.message })
      setRows([])
      setNotes("")
      setMotivo("")
      setBulkObjective("")
      setBulkQty("")
      onOpenChange(false)
      onSaved()
    } else {
      toast({ title: "Error", description: res.message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo ajuste de inventario</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Bodega</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
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
            {hasIncrementar ? (
              <div className="space-y-1.5">
                <Label>Motivo *</Label>
                <Select
                  value={motivo}
                  onValueChange={(v) => setMotivo(v as Motivo)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compra">Compra</SelectItem>
                    <SelectItem value="sobrante">Sobrante</SelectItem>
                    <SelectItem value="correccion">Corrección</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Los incrementos requieren motivo. Compra/sobrante capitalizan al inventario; corrección no genera asiento.
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Observaciones{motivo === "correccion" ? " *" : ""}</Label>
            <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Productos</h3>
            <MultiProductPicker
              products={products}
              alreadyAddedIds={alreadyAdded}
              onAddMany={addMany}
            />
          </div>

          {rows.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-2">
              <div className="min-w-[10rem] space-y-1">
                <Label className="text-xs">Objetivo para todos</Label>
                <div className="flex gap-1.5">
                  <Select
                    value={bulkObjective}
                    onValueChange={(v) => setBulkObjective(v as any)}
                  >
                    <SelectTrigger className="h-8 flex-1">
                      <SelectValue placeholder="Elegir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="incrementar">Incrementar</SelectItem>
                      <SelectItem value="disminuir">Disminuir</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!bulkObjective}
                    onClick={applyBulkObjective}
                  >
                    Aplicar
                  </Button>
                </div>
              </div>
              <div className="min-w-[9rem] space-y-1">
                <Label className="text-xs">Cantidad para todos</Label>
                <div className="flex gap-1.5">
                  <Input
                    type="number"
                    className="h-8"
                    value={bulkQty}
                    onChange={(e) => setBulkQty(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!bulkQty || Number(bulkQty) <= 0}
                    onClick={applyBulkQuantity}
                  >
                    Aplicar
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Atajo</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!anyRowHasStock}
                  onClick={bringAllToZero}
                  title={
                    anyRowHasStock
                      ? "Pone Disminuir + cantidad = stock actual de cada producto en la bodega elegida."
                      : "Ninguna fila tiene stock en esta bodega."
                  }
                >
                  Llevar a 0
                </Button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              Agrega productos para ajustar su inventario.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const stock = stockAtWarehouse(productsById.get(r.product_id), warehouseId || null)
                const err = rowErrors[r.product_id]
                return (
                  <div
                    key={r.product_id}
                    className={
                      "grid grid-cols-12 items-end gap-2 rounded-md border p-2" +
                      (err ? " border-destructive/60 bg-destructive/5" : "")
                    }
                  >
                    <div className="col-span-12 sm:col-span-4">
                      <span className="text-sm font-medium">{r.name}</span>
                      <p className="text-[11px] text-muted-foreground">
                        Stock: <span className="font-medium text-foreground">{stock}</span>
                      </p>
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <Label className="text-xs">Objetivo</Label>
                      <Select value={r.objective} onValueChange={(v: any) => update(r.product_id, { objective: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="incrementar">Incrementar</SelectItem>
                          <SelectItem value="disminuir">Disminuir</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <Label className="text-xs">Cantidad</Label>
                      <Input
                        type="number"
                        className="h-9"
                        value={r.quantity}
                        onChange={(e) => update(r.product_id, { quantity: Number(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <Label className="text-xs">Costo</Label>
                      <MoneyInput
                        className="h-9"
                        value={r.cost}
                        onChange={(n) => update(r.product_id, { cost: n ?? 0 })}
                      />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        WAC actual: {formatCurrency(r.currentCost)}
                      </p>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => remove(r.product_id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    {err && (
                      <div className="col-span-12 flex items-center gap-1.5 text-xs text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {err}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {mermaGasto > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>
                  Las disminuciones registran un gasto por merma de{" "}
                  <span className="font-semibold">{formatCurrency(mermaGasto)}</span> en el
                  estado de resultados. Si el producto es un duplicado o un ingreso
                  equivocado, anulá su ajuste de ingreso en lugar de disminuir.
                </p>
                {firstDisminuirCode && (
                  <p>
                    <Link
                      href={`/inventory/adjustments?search=${encodeURIComponent(firstDisminuirCode)}`}
                      className="font-medium underline underline-offset-2"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ver ajustes de {firstDisminuirCode}
                    </Link>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end rounded-md bg-muted/50 px-3 py-2 text-sm">
            Total ajustado:&nbsp;<span className="font-semibold">{formatCurrency(total)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving || hasRowErrors}>
            {saving ? "Guardando..." : "Crear ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
