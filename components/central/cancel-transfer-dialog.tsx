"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cancelTransfer } from "@/lib/inventory-actions"
import { Loader2 } from "lucide-react"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  transfer: { transfer_id: string; status: string; label?: string } | null
  onDone?: () => void
}

export function CancelTransferDialog({ open, onOpenChange, transfer, onDone }: Props) {
  const { toast } = useToast()
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setReason("")
  }, [open])

  const isTransit = transfer?.status === "en_transito"
  const disabled = saving || reason.trim().length < 3

  async function handleCancel() {
    if (!transfer) return
    setSaving(true)
    const res = await cancelTransfer(transfer.transfer_id, reason)
    setSaving(false)
    toast({
      title: res.success ? "Traslado cancelado" : "No se pudo cancelar",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      onOpenChange(false)
      onDone?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar traslado</DialogTitle>
          <DialogDescription>
            {transfer?.label && <span className="block mb-2 font-medium">{transfer.label}</span>}
            {isTransit
              ? "El stock retenido en tránsito volverá a la bodega origen. Se validará que el tránsito cuadre antes de mover nada."
              : "El traslado quedará en estado 'cancelado'. No hay stock que revertir (nunca se movió)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Motivo de la cancelación</Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: pedido duplicado, error de cantidades, cliente canceló…"
          />
          <p className="text-xs text-muted-foreground">
            Se anexa a las notas del traslado para auditoría.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Volver
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar cancelación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
