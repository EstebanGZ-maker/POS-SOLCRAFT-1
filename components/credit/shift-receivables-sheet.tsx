"use client"

import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { getShiftReceivables } from "@/lib/actions"
import { formatCurrency } from "@/lib/utils"
import { HandCoins, Info } from "lucide-react"
import { RegisterPaymentDialog } from "./register-payment-dialog"

interface ShiftReceivablesSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shiftId: string
  // Bump para forzar refetch cuando cambie externamente (p.ej. tras una venta
  // fiado nueva creada en el POS).
  refreshKey?: number
  onChange?: () => void
}

interface ShiftSale {
  sale_id: string
  numero: number | null
  sale_date: string
  total_amount: number
  amount_paid: number
  balance_due: number
  customer_id: string
  customer_name: string
  customer_phone: string | null
}

export function ShiftReceivablesSheet({
  open,
  onOpenChange,
  shiftId,
  refreshKey,
  onChange,
}: ShiftReceivablesSheetProps) {
  const [sales, setSales] = useState<ShiftSale[]>([])
  const [loading, setLoading] = useState(false)
  const [paymentTarget, setPaymentTarget] = useState<ShiftSale | null>(null)

  async function reload() {
    if (!shiftId) return
    setLoading(true)
    const r = await getShiftReceivables(shiftId)
    setLoading(false)
    setSales(r.success ? r.sales : [])
  }

  useEffect(() => {
    if (open) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shiftId, refreshKey])

  const totalPending = sales.reduce((s, x) => s + x.balance_due, 0)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <HandCoins className="h-4 w-4" />
              Fiados del turno
            </SheetTitle>
            <SheetDescription>
              {sales.length > 0
                ? `${sales.length} venta${sales.length === 1 ? "" : "s"} con saldo pendiente — ${formatCurrency(totalPending)}`
                : "Ventas a crédito abiertas del turno actual."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
            {loading && (
              <div className="text-sm text-muted-foreground">Cargando…</div>
            )}
            {!loading && sales.length === 0 && (
              <div className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                Este turno aún no tiene ventas a crédito con saldo pendiente.
              </div>
            )}
            {sales.map((s) => (
              <div key={s.sale_id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">
                        {s.numero != null ? `#${s.numero}` : s.sale_id.slice(0, 8)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {s.customer_name}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Total</div>
                        <div>{formatCurrency(s.total_amount)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Abonado</div>
                        <div>{formatCurrency(s.amount_paid)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Pendiente</div>
                        <div className="font-semibold text-primary">
                          {formatCurrency(s.balance_due)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button size="sm" onClick={() => setPaymentTarget(s)}>
                    Registrar abono
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <RegisterPaymentDialog
        open={!!paymentTarget}
        onOpenChange={(v) => !v && setPaymentTarget(null)}
        sale={
          paymentTarget
            ? {
                sale_id: paymentTarget.sale_id,
                numero: paymentTarget.numero,
                customer_id: paymentTarget.customer_id,
                customer_name: paymentTarget.customer_name,
                total_amount: paymentTarget.total_amount,
                amount_paid: paymentTarget.amount_paid,
                balance_due: paymentTarget.balance_due,
              }
            : null
        }
        shiftId={shiftId}
        onDone={() => {
          setPaymentTarget(null)
          reload()
          onChange?.()
        }}
      />
    </>
  )
}
