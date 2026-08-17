"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { openShift } from "@/lib/shift-actions"

interface OpenShiftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  siteName: string
  warehouseId: string | null
  openedBy?: string | null
  onOpened: () => void
}

const BANKS = ["Caja general", "Bancolombia", "Nequi", "Daviplata", "Davivienda"]

export function OpenShiftDialog({
  open,
  onOpenChange,
  siteId,
  siteName,
  warehouseId,
  openedBy,
  onOpened,
}: OpenShiftDialogProps) {
  const [initialCash, setInitialCash] = useState<number>(0)
  const [bankBase, setBankBase] = useState("Caja general")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const result = await openShift({
      site_id: siteId,
      warehouse_id: warehouseId,
      initial_cash: initialCash,
      bank_base: bankBase,
      opened_by: openedBy ?? null,
    })
    setSaving(false)
    if (result.success) {
      toast({ title: "Turno abierto", description: `Caja iniciada en ${siteName}.` })
      onOpenChange(false)
      setInitialCash(0)
      onOpened()
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir turno</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Con los turnos vas a tener una mejor gestión del efectivo en tu punto de venta de{" "}
          <span className="font-medium text-foreground">{siteName}</span>.
        </p>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="initial-cash">
              Base inicial <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground">Indica el dinero en efectivo con el que inicias el turno</p>
            <MoneyInput
              id="initial-cash"
              value={initialCash}
              onChange={(n) => setInitialCash(n ?? 0)}
            />
          </div>

          <div className="space-y-2">
            <Label>
              Banco base <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground">Elige el banco del cual saldrá el dinero para la base inicial</p>
            <Select value={bankBase} onValueChange={setBankBase}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BANKS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground self-center">* Campos obligatorios</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
