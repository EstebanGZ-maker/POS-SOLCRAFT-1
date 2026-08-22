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
import { adminCloseGhostTransfer } from "@/lib/inventory-actions"
import { AlertTriangle, Loader2 } from "lucide-react"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  transfer: { transfer_id: string; label?: string } | null
  onDone?: () => void
}

export function CloseGhostTransferDialog({ open, onOpenChange, transfer, onDone }: Props) {
  const { toast } = useToast()
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setReason("")
  }, [open])

  const disabled = saving || reason.trim().length < 3

  async function handleClose() {
    if (!transfer) return
    setSaving(true)
    const res = await adminCloseGhostTransfer(transfer.transfer_id, reason)
    setSaving(false)
    toast({
      title: res.success ? "Registro fantasma cerrado" : "No se pudo cerrar",
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
          <DialogTitle>Cerrar registro fantasma</DialogTitle>
          <DialogDescription>
            {transfer?.label && <span className="block mb-2 font-medium">{transfer.label}</span>}
            <span className="block">
              <strong>No hay stock real que revertir</strong> — esto es una corrección
              de registro, no una cancelación operativa. El traslado quedará como
              &quot;cancelado&quot; sin generar ningún movimiento de stock.
            </span>
            <span className="mt-2 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Solo aplica a traslados en tránsito que quedaron huérfanos por un
                fallo del sistema (sin ningún movimiento en el kardex).
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nota de la corrección</Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: doble-submit del 2026-08-19 sin stock asociado"
          />
          <p className="text-xs text-muted-foreground">
            Se anexa a las notas del traslado con marca [Corrección admin].
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Volver
          </Button>
          <Button variant="destructive" onClick={handleClose} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cerrar registro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
