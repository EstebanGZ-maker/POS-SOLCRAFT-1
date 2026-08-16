"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { registerPayment, applyCustomerCredit, getCustomerCreditBalance } from "@/lib/actions"
import { formatCurrency } from "@/lib/utils"
import { AlertCircle, Wallet } from "lucide-react"

// Métodos disponibles para abonar. "credito_favor" se ofrece condicionalmente
// como CTA aparte cuando el cliente tiene saldo a favor (dispara
// applyCustomerCredit en vez de register_payment).
const METHODS = ["Efectivo", "Tarjeta débito", "Tarjeta de crédito", "Transferencia"] as const

function isCash(method: string) {
  const m = method.toLowerCase()
  return m.includes("efectivo") || m.includes("cash")
}

interface SaleForPayment {
  sale_id: string
  numero: number | null
  customer_id: string
  customer_name?: string | null
  total_amount: number
  amount_paid: number
  balance_due: number
}

interface RegisterPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sale: SaleForPayment | null
  // shift_id del turno abierto en la SEDE de la venta (no del turno "actual"
  // del POS si el usuario está viendo otra sede). Se pasa NULL si no hay
  // turno abierto en esa sede — el dialog deshabilita cash con tooltip.
  shiftId?: string | null
  onDone?: () => void
}

export function RegisterPaymentDialog({
  open,
  onOpenChange,
  sale,
  shiftId,
  onDone,
}: RegisterPaymentDialogProps) {
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState<string>("Efectivo")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number>(0)
  const [loadingCredit, setLoadingCredit] = useState(false)

  // Reset + carga saldo a favor al abrir
  useEffect(() => {
    if (!open || !sale) return
    setAmount(null)
    setMethod("Efectivo")
    setNotes("")
    setCreditBalance(0)
    setLoadingCredit(true)
    getCustomerCreditBalance(sale.customer_id)
      .then((r) => setCreditBalance(r.success ? r.balance : 0))
      .catch(() => setCreditBalance(0))
      .finally(() => setLoadingCredit(false))
  }, [open, sale])

  if (!sale) return null

  const balance = sale.balance_due
  const numeric = amount ?? 0
  const validAmount = numeric > 0 && numeric <= balance
  const cashWithoutShift = isCash(method) && !shiftId
  const canSubmit = validAmount && !cashWithoutShift && !saving

  // Máximo redimible = min(balance_due, saldo a favor)
  const maxRedeem = Math.min(balance, Math.max(0, creditBalance))
  const showCreditCTA = !loadingCredit && creditBalance > 0

  function fillTotal() {
    setAmount(balance)
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    const result = await registerPayment(
      sale!.sale_id,
      numeric,
      method,
      isCash(method) ? shiftId ?? null : shiftId ?? null,
      notes.trim() || null,
    )
    setSaving(false)
    if (result.success) {
      toast({
        title: "Abono registrado",
        description: `Nuevo saldo pendiente: ${formatCurrency(result.new_balance_due ?? 0)}`,
      })
      onOpenChange(false)
      onDone?.()
    } else {
      toast({
        title: "Error al registrar abono",
        description: result.message,
        variant: "destructive",
      })
    }
  }

  async function handleRedeem() {
    if (maxRedeem <= 0 || saving) return
    setSaving(true)
    const result = await applyCustomerCredit(sale!.sale_id, maxRedeem, shiftId ?? null)
    setSaving(false)
    if (result.success) {
      toast({
        title: "Saldo a favor aplicado",
        description: `Se aplicaron ${formatCurrency(maxRedeem)}. Saldo pendiente: ${formatCurrency(result.new_balance_due ?? 0)}. Saldo a favor restante: ${formatCurrency(result.remaining_credit ?? 0)}.`,
      })
      onOpenChange(false)
      onDone?.()
    } else {
      toast({
        title: "Error al aplicar saldo",
        description: result.message,
        variant: "destructive",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar abono</DialogTitle>
          <DialogDescription>
            {sale.numero != null ? `Venta #${sale.numero}` : `Venta ${sale.sale_id.slice(0, 8)}`}
            {sale.customer_name ? ` — ${sale.customer_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-2 rounded-md border p-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Total</div>
              <div className="font-medium">{formatCurrency(sale.total_amount)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Abonado</div>
              <div className="font-medium">{formatCurrency(sale.amount_paid)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Pendiente</div>
              <div className="font-semibold text-primary">{formatCurrency(balance)}</div>
            </div>
          </div>

          {showCreditCTA && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 p-3">
              <div className="flex items-start gap-2">
                <Wallet className="mt-0.5 h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                <div className="flex-1 space-y-2">
                  <div className="text-sm">
                    Este cliente tiene <b>{formatCurrency(creditBalance)}</b> de saldo a favor.
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-500/60"
                    onClick={handleRedeem}
                    disabled={saving || maxRedeem <= 0}
                  >
                    Redimir {formatCurrency(maxRedeem)}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="pay-amount">Monto del abono</Label>
            <div className="flex gap-2">
              <MoneyInput
                id="pay-amount"
                value={amount}
                onChange={setAmount}
                emptyAsNull
                placeholder="0"
              />
              <Button type="button" variant="outline" size="sm" onClick={fillTotal}>
                Total
              </Button>
            </div>
            {numeric > balance && (
              <p className="text-xs text-destructive">
                No puede exceder el saldo pendiente ({formatCurrency(balance)}).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Método de pago</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cashWithoutShift && (
              <p className="flex items-start gap-1 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                Un abono en efectivo requiere turno abierto en la sede de la venta.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pay-notes">Notas (opcional)</Label>
            <Textarea
              id="pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones del abono"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Guardando..." : "Registrar abono"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
