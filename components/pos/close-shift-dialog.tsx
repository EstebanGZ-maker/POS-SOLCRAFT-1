"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/use-toast"
import { formatCurrency } from "@/lib/utils"
import { closeShift, type ShiftBalance } from "@/lib/shift-actions"
import { Plus } from "lucide-react"

interface CloseShiftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  balance: ShiftBalance
  closedBy?: string | null
  onClosed: () => void
  onNewMovement: () => void
}

function Row({
  label,
  value,
  muted,
  negative,
  bold,
}: {
  label: string
  value: number
  muted?: boolean
  negative?: boolean
  bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className={muted ? "text-muted-foreground" : bold ? "font-semibold text-foreground" : "text-foreground"}>
        {label}
      </span>
      <span
        className={
          negative
            ? "font-medium text-destructive"
            : bold
              ? "font-semibold text-foreground"
              : "text-foreground"
        }
      >
        {formatCurrency(value)}
      </span>
    </div>
  )
}

export function CloseShiftDialog({
  open,
  onOpenChange,
  balance,
  closedBy,
  onClosed,
  onNewMovement,
}: CloseShiftDialogProps) {
  const [countedCash, setCountedCash] = useState("")
  const [saving, setSaving] = useState(false)

  const counted = Number(countedCash) || 0
  const difference = counted - balance.expected_cash

  const openedDate = new Date(balance.opened_at).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  async function handleClose() {
    setSaving(true)
    const result = await closeShift({
      shift_id: balance.shift_id,
      counted_cash: counted,
      closed_by: closedBy ?? null,
    })
    setSaving(false)
    if (result.success) {
      toast({
        title: "Turno cerrado",
        description:
          difference === 0
            ? "La caja cuadra exactamente."
            : `Diferencia de ${formatCurrency(difference)} respecto a lo esperado.`,
      })
      setCountedCash("")
      onOpenChange(false)
      onClosed()
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cerrar turno</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Fecha de inicio</span>
          <span className="font-medium text-primary">{openedDate}</span>
        </div>

        <div className="flex items-center justify-between border-b pb-3">
          <span className="text-base font-semibold">Total de ventas</span>
          <span className="text-base font-semibold">{formatCurrency(balance.total_sales)}</span>
        </div>

        <div className="divide-y">
          <Row label="Base inicial" value={balance.initial_cash} />
          <Row label="Ventas en efectivo" value={balance.cash_sales} />
          <Row label="Ventas por tarjeta de débito" value={balance.debit_sales} />
          <Row label="Ventas por tarjeta de crédito" value={balance.credit_sales} />
          <Row label="Ventas por transferencias" value={balance.transfer_sales} />
          {balance.other_sales > 0 && <Row label="Otras ventas" value={balance.other_sales} />}
          <Row label="Devolución de dinero" value={balance.refunds} negative={balance.refunds > 0} />
          <Row label="Ingresos en efectivo" value={balance.cash_in} />
          <Row label="Retiros de efectivo" value={balance.cash_out} negative={balance.cash_out > 0} />
          <Row label="Total de movimientos" value={balance.total_movements} bold />
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-3">
          <span className="font-medium">Dinero esperado en caja</span>
          <span className="font-semibold">{formatCurrency(balance.expected_cash)}</span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="counted-cash">Dinero contado en caja</Label>
          <Input
            id="counted-cash"
            type="number"
            min="0"
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="0"
          />
          {countedCash !== "" && (
            <p className={`text-sm ${difference === 0 ? "text-muted-foreground" : "text-destructive"}`}>
              Diferencia: {formatCurrency(difference)}{" "}
              {difference > 0 ? "(sobrante)" : difference < 0 ? "(faltante)" : "(cuadra)"}
            </p>
          )}
        </div>

        <Separator />

        <Button variant="outline" className="w-full bg-transparent" onClick={onNewMovement}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo movimiento de efectivo
        </Button>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground self-center">* Campos obligatorios</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleClose} disabled={saving || countedCash === ""}>
              {saving ? "Cerrando..." : "Guardar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
