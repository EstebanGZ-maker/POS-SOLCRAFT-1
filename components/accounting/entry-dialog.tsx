"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { createAccountingEntry } from "@/lib/accounting-actions"

const INCOME_CATEGORIES = ["Ventas", "Otros ingresos", "Aportes"]
const EXPENSE_CATEGORIES = ["Arriendo", "Servicios públicos", "Nómina", "Compras", "Mercadeo", "Otros gastos"]

export function EntryDialog({
  open,
  onOpenChange,
  siteId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  siteId: string
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [type, setType] = useState<"income" | "expense">("expense")
  const [category, setCategory] = useState("")
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  async function handleSave() {
    if (!amount || Number(amount) <= 0) {
      toast({ title: "Monto inválido", description: "Ingresa un monto mayor a cero.", variant: "destructive" })
      return
    }
    setSaving(true)
    const res = await createAccountingEntry({
      site_id: siteId,
      entry_type: type,
      category: category || null,
      description: description || null,
      amount: Number(amount),
      entry_date: new Date(date).toISOString(),
    })
    setSaving(false)
    if (res.success) {
      toast({ title: "Movimiento registrado" })
      onSaved()
      onOpenChange(false)
      setCategory("")
      setDescription("")
      setAmount("")
    } else {
      toast({ title: "Error", description: res.message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo movimiento contable</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={type === "income" ? "default" : "outline"}
              onClick={() => setType("income")}
            >
              Ingreso
            </Button>
            <Button
              className="flex-1"
              variant={type === "expense" ? "default" : "outline"}
              onClick={() => setType("expense")}
            >
              Egreso
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Monto</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">Descripción</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalle del movimiento"
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar movimiento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
