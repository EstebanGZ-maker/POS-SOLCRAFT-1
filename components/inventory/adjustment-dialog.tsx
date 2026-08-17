"use client"

import { useMemo, useState } from "react"
import { Trash2 } from "lucide-react"
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
import { ProductPicker } from "@/components/inventory/product-picker"

type Warehouse = { warehouse_id: string; name: string; site_name?: string }
type Row = { product_id: string; name: string; cost: number; objective: "incrementar" | "disminuir"; quantity: number }

export function AdjustmentDialog({
  open,
  onOpenChange,
  warehouses,
  products,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  warehouses: Warehouse[]
  products: any[]
  onSaved: () => void
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.warehouse_id ?? "")
  const [notes, setNotes] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)

  const total = useMemo(() => rows.reduce((s, r) => s + r.cost * r.quantity, 0), [rows])

  const addProduct = (p: any) => {
    if (rows.some((r) => r.product_id === p.product_id)) return
    const full = products.find((x) => x.product_id === p.product_id)
    setRows((prev) => [
      ...prev,
      { product_id: p.product_id, name: p.name, cost: Number(full?.cost ?? 0), objective: "incrementar", quantity: 1 },
    ])
  }
  const update = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.product_id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.product_id !== id))

  const submit = async () => {
    if (!warehouseId) return toast({ title: "Selecciona una bodega", variant: "destructive" })
    if (rows.length === 0) return toast({ title: "Agrega al menos un producto", variant: "destructive" })
    setSaving(true)
    const res = await createAdjustment({ warehouse_id: warehouseId, notes, items: rows })
    setSaving(false)
    if (res.success) {
      toast({ title: "Ajuste creado", description: res.message })
      setRows([])
      setNotes("")
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
            <div className="space-y-1.5">
              <Label>Observaciones</Label>
              <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Productos</h3>
            <ProductPicker products={products} onSelect={addProduct} />
          </div>

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              Agrega productos para ajustar su inventario.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.product_id} className="grid grid-cols-12 items-end gap-2 rounded-md border p-2">
                  <div className="col-span-12 sm:col-span-4">
                    <span className="text-sm font-medium">{r.name}</span>
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
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => remove(r.product_id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
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
          <Button onClick={submit} disabled={saving}>
            {saving ? "Guardando..." : "Crear ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
