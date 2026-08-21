"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertTriangle, ArrowLeft, Loader2, Send, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { dispatchPendingTransfer, getTransferDetail } from "@/lib/inventory-actions"
import { TRANSFER_STATUS_LABELS, isTransferStatus } from "@/lib/transfer-status"
import { useAuth } from "@/lib/auth-context"
import { CancelTransferDialog } from "@/components/central/cancel-transfer-dialog"
import { CloseGhostTransferDialog } from "@/components/central/close-ghost-transfer-dialog"

function statusBadgeClass(status: string): string {
  switch (status) {
    case "recibido": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    case "en_transito": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    case "recibido_con_pendiente": return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
    case "pendiente": return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
    case "cancelado": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    default: return ""
  }
}
function statusLabel(status: string) {
  return isTransferStatus(status) ? TRANSFER_STATUS_LABELS[status] : status
}

interface Props {
  initialDetail: any
}

export function TransferDetailClient({ initialDetail }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const { role } = useAuth()
  const [t, setT] = useState<any>(initialDetail)
  const [confirmDispatch, setConfirmDispatch] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [ghostOpen, setGhostOpen] = useState(false)
  const [, startTransition] = useTransition()

  const isAdminOrEncargado = role === "admin" || role === "encargado"
  const canDispatch = isAdminOrEncargado && t.status === "pendiente"
  const canCancel = isAdminOrEncargado && (t.status === "pendiente" || t.status === "en_transito")
  const canCloseGhost = role === "admin" && Boolean(t.is_ghost)

  async function refreshDetail() {
    const fresh = await getTransferDetail(t.transfer_id)
    if (fresh) setT(fresh)
    startTransition(() => router.refresh())
  }
  const items = (t.transfer_items ?? []) as Array<any>

  async function handleDispatch() {
    setDispatching(true)
    const res = await dispatchPendingTransfer(t.transfer_id)
    setDispatching(false)
    setConfirmDispatch(false)
    toast({
      title: res.success ? "Despachado" : "No se pudo despachar",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      setT({ ...t, status: "en_transito" })
      startTransition(() => router.refresh())
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title={`Traslado ${t.transfer_id.slice(0, 8)}`}
        description={
          t.status === "pendiente"
            ? "Traslado guardado como pendiente. No ha salido stock de origen."
            : "Detalle del traslado."
        }
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/central/transfers">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Volver
          </Link>
        </Button>
        {canDispatch && (
          <Button size="sm" onClick={() => setConfirmDispatch(true)}>
            <Send className="mr-1.5 h-4 w-4" />
            Despachar
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setCancelOpen(true)}
          >
            <X className="mr-1.5 h-4 w-4" />
            Cancelar
          </Button>
        )}
      </PageHeader>

      <CancelTransferDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        transfer={{
          transfer_id: t.transfer_id,
          status: t.status,
          label: `${t.from_wh?.sites?.name} → ${t.to_wh?.sites?.name}`,
        }}
        onDone={() => {
          setCancelOpen(false)
          refreshDetail()
        }}
      />

      <CloseGhostTransferDialog
        open={ghostOpen}
        onOpenChange={setGhostOpen}
        transfer={{
          transfer_id: t.transfer_id,
          label: `${t.from_wh?.sites?.name} → ${t.to_wh?.sites?.name}`,
        }}
        onDone={() => {
          setGhostOpen(false)
          refreshDetail()
        }}
      />

      {canCloseGhost && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1">
              <div className="font-medium text-amber-800 dark:text-amber-200">
                Registro fantasma detectado
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Este traslado figura en tránsito pero no tiene ningún movimiento
                de stock asociado (kardex vacío para este reference_id).
                Probablemente quedó huérfano por un fallo del despacho antiguo.
                Solo un admin puede cerrarlo como corrección de registro.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 border-amber-500/50 text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
                onClick={() => setGhostOpen(true)}
              >
                Cerrar registro fantasma
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Estado</div>
            <div className="mt-1">
              <Badge variant="secondary" className={statusBadgeClass(t.status)}>
                {statusLabel(t.status)}
              </Badge>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Fecha</div>
            <div>{new Date(t.transfer_date).toLocaleString("es-CO")}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Origen</div>
            <div>{t.from_wh?.sites?.name} · {t.from_wh?.name}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Destino</div>
            <div>{t.to_wh?.sites?.name} · {t.to_wh?.name}</div>
          </div>
          {t.notes && (
            <div className="sm:col-span-2 lg:col-span-4">
              <div className="text-xs text-muted-foreground">Notas</div>
              <div className="whitespace-pre-line">{t.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Código</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Recibido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="p-6 text-center text-sm text-muted-foreground">
                    Sin ítems.
                  </TableCell>
                </TableRow>
              )}
              {items.map((it) => (
                <TableRow key={it.transfer_item_id}>
                  <TableCell>{it.products?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{it.products?.code ?? "—"}</TableCell>
                  <TableCell className="text-right">{it.quantity}</TableCell>
                  <TableCell className="text-right">
                    {it.quantity_received != null ? it.quantity_received : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDispatch} onOpenChange={setConfirmDispatch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Despachar este traslado?</AlertDialogTitle>
            <AlertDialogDescription>
              Se validará stock en la bodega origen y, si alcanza, se moverá a
              tránsito. Si no alcanza para algún producto, no se despachará nada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dispatching}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDispatch} disabled={dispatching}>
              {dispatching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Despachar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
