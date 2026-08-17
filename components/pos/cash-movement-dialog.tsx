"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { addCashMovement } from "@/lib/shift-actions"

interface CashMovementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shiftId: string
  onSaved: () => void
}

export function CashMovementDialog({ open, onOpenChange, shiftId, onSaved }: CashMovementDialogProps) {
  const [type, setType] = useState<"income" | "expense">("income")
  const [amount, setAmount] = useState<number | null>(null)
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const value = amount ?? 0
    if (value <= 0) {
      toast({ title: "Monto inválido", description: "Ingresa un monto mayor a cero.", variant: "destructive" })
      return
    }
    setSaving(true)
    const result = await addCashMovement({ shift_id: shiftId, type, amount: value, description })
    setSaving(false)
    if (result.success) {
      toast({ title: "Movimiento registrado" })
      setAmount(null)
      setDescription("")
      setType("income")
      onOpenChange(false)
      onSaved()
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento de efectivo</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Tipo de movimiento</Label>
            <Select value={type} onValueChange={(v) => setType(v as "income" | "expense")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Ingreso de efectivo</SelectItem>
                <SelectItem value="expense">Retiro de efectivo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="movement-amount">Monto</Label>
            <MoneyInput
              id="movement-amount"
              value={amount}
              onChange={setAmount}
              emptyAsNull
              placeholder="0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="movement-desc">Descripción</Label>
            <Textarea
              id="movement-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Motivo del movimiento"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
