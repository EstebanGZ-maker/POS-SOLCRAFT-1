"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
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
import { Banknote, CreditCard, Landmark, WalletCards, Coins, Settings2, ArrowRightLeft } from "lucide-react"
import { cn, formatCurrency } from "@/lib/utils"

export interface PaymentResult {
  payment_method: string
  amount_received: number
  seller: string | null
  notes: string | null
}

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  processing: boolean
  onConfirm: (result: PaymentResult) => void
}

const METHODS = [
  { id: "Efectivo", label: "Efectivo", icon: Banknote, primary: true },
  { id: "Tarjeta de crédito", label: "Tarjeta de crédito", icon: CreditCard, primary: true },
  { id: "Transferencia", label: "Transferencia", icon: Landmark, primary: true },
  { id: "Tarjeta débito", label: "Tarjeta débito", icon: WalletCards, primary: false },
  { id: "Combinado", label: "Combinado", icon: Coins, primary: false },
  { id: "Otros métodos de pago", label: "Otros métodos de pago", icon: Settings2, primary: false },
]

const SELLERS = ["Administrador", "Cajero 1", "Cajero 2", "Vendedor externo"]

export function PaymentDialog({ open, onOpenChange, total, processing, onConfirm }: PaymentDialogProps) {
  const [step, setStep] = useState<"methods" | "detail">("methods")
  const [method, setMethod] = useState<string>("Efectivo")
  const [amount, setAmount] = useState<string>("")
  const [seller, setSeller] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (open) {
      setStep("methods")
      setMethod("Efectivo")
      setAmount("")
      setSeller("")
      setNotes("")
    }
  }, [open])

  const received = Number.parseFloat(amount) || 0
  const pending = Math.max(0, total - received)
  const change = Math.max(0, received - total)
  const isCashLike = method === "Efectivo" || method === "Combinado"
  const canContinue = isCashLike ? received >= total : true

  const quickOptions = Array.from(
    new Set([total, Math.ceil((total + 3000) / 1000) * 1000, Math.ceil((total + 8000) / 1000) * 1000]),
  )

  const selectMethod = (id: string) => {
    setMethod(id)
    if (id !== "Efectivo" && id !== "Combinado") {
      setAmount(String(total))
    } else {
      setAmount("")
    }
    setStep("detail")
  }

  const handleConfirm = () => {
    onConfirm({
      payment_method: method,
      amount_received: isCashLike ? received : total,
      seller: seller || null,
      notes: notes || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden [&>button]:hidden">
        <div className="flex flex-col">
          <div className="px-6 pt-6">
            <h2 className="text-xl font-semibold text-foreground">Pagar factura</h2>
          </div>

          {step === "methods" ? (
            <div className="px-6 py-6">
              <div className="text-center">
                <p className="text-sm font-medium tracking-wide text-muted-foreground">TOTAL</p>
                <p className="text-3xl font-bold text-foreground">{formatCurrency(total)}</p>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-4">
                {METHODS.filter((m) => m.primary).map((m) => (
                  <MethodCard key={m.id} method={m} onClick={() => selectMethod(m.id)} />
                ))}
              </div>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">Otros métodos</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                {METHODS.filter((m) => !m.primary).map((m) => (
                  <MethodCard key={m.id} method={m} onClick={() => selectMethod(m.id)} />
                ))}
              </div>

              <div className="mt-6 flex justify-end">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-6 py-6">
              <div className="relative text-center">
                <p className="text-sm font-medium tracking-wide text-muted-foreground">TOTAL</p>
                <p className="text-3xl font-bold text-foreground">{formatCurrency(total)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Por cobrar:{" "}
                  <span className={cn(pending > 0 ? "text-destructive" : "text-primary", "font-semibold")}>
                    {formatCurrency(pending)}
                  </span>
                  {change > 0 && (
                    <span className="ml-3">
                      Cambio: <span className="font-semibold text-primary">{formatCurrency(change)}</span>
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setStep("methods")}
                  className="absolute right-0 top-0 flex items-center gap-1 text-sm font-medium text-primary"
                >
                  <ArrowRightLeft className="h-4 w-4" /> Cambiar método
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  {isCashLike ? (
                    <>
                      <Label>
                        Valor del pago en {method === "Efectivo" ? "efectivo" : "combinado"}{" "}
                        <span className="text-primary">*</span>
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="mt-1.5"
                        placeholder="0"
                        autoFocus
                      />
                      <p className="mb-2 mt-4 text-center text-xs text-muted-foreground">
                        Opciones rápidas
                      </p>
                      <div className="space-y-2">
                        {quickOptions.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setAmount(String(opt))}
                            className="w-full rounded-md border py-2.5 text-center font-medium text-foreground transition-colors hover:border-primary hover:bg-accent"
                          >
                            {formatCurrency(opt)}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border bg-muted/50 p-4 text-sm text-muted-foreground">
                      Pago por <span className="font-medium text-foreground">{method}</span> por el valor
                      total de {formatCurrency(total)}.
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Vendedor</Label>
                    <Select value={seller} onValueChange={setSeller}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar" />
                      </SelectTrigger>
                      <SelectContent>
                        {SELLERS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Observaciones</Label>
                    <Textarea
                      rows={5}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ingresa tu observación"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleConfirm} disabled={!canContinue || processing}>
                  {processing ? "Procesando..." : "Continuar"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MethodCard({
  method,
  onClick,
}: {
  method: { id: string; label: string; icon: any }
  onClick: () => void
}) {
  const Icon = method.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center transition-colors hover:border-primary hover:bg-accent"
    >
      <Icon className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-sm font-medium text-foreground">{method.label}</span>
    </button>
  )
}
