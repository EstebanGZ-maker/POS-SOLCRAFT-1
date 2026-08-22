"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { getTransfersToReconcile, reconcileTransfer } from "@/lib/inventory-actions"
import {
  ClipboardCheck, ArrowLeft, Loader2, AlertTriangle, PackageCheck, TriangleAlert, XCircle,
} from "lucide-react"

export default function ReconcileTransfersPage() {
  const { toast } = useToast()
  const { data: transfers = [], mutate, isLoading } = useSWR(
    "transfers-to-reconcile",
    getTransfersToReconcile,
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [found, setFound] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [working, setWorking] = useState(false)

  const selected = useMemo(
    () => (transfers as any[]).find((t) => t.transfer_id === selectedId) || null,
    [transfers, selectedId],
  )

  function open(t: any) {
    setSelectedId(t.transfer_id)
    // Por defecto asumimos que nada apareció: hay que declararlo explícitamente
    setFound(Object.fromEntries((t.transfer_items || []).map((i: any) => [i.product_id, 0])))
    setNotes("")
  }

  function close() {
    setSelectedId(null)
    setFound({})
    setNotes("")
  }

  const lines = (selected?.transfer_items || []).filter((i: any) => i.pending > 0)

  const totals = lines.reduce(
    (acc: any, i: any) => {
      const f = Math.max(0, Math.min(found[i.product_id] ?? 0, i.pending))
      acc.pending += i.pending
      acc.found += f
      acc.lost += i.pending - f
      acc.lostValue += (i.pending - f) * Number(i.products?.cost || 0)
      return acc
    },
    { pending: 0, found: 0, lost: 0, lostValue: 0 },
  )

  // Si el tránsito no cuadra con el pendiente, el RPC va a rechazar: avisar antes
  const transitMismatch = lines.filter((i: any) => i.transit_qty < i.pending)

  async function submit() {
    if (!selected) return
    setWorking(true)
    const res = await reconcileTransfer(
      selected.transfer_id,
      lines.map((i: any) => ({
        product_id: i.product_id,
        found_qty: Math.max(0, Math.min(found[i.product_id] ?? 0, i.pending)),
      })),
      notes || null,
    )
    setWorking(false)
    setConfirmOpen(false)

    toast({
      title: res.success ? "Traslado reconciliado" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })

    if (res.success) {
      close()
      mutate()
    }
  }

  // ─────────── Detalle ───────────
  if (selected) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={close} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Volver a la lista
        </Button>

        <PageHeader
          title="Reconciliar traslado"
          description="Declara cuánto apareció. Lo que falte se da de baja como pérdida."
          icon={ClipboardCheck}
        />

        <Card>
          <CardContent className="p-4 text-sm">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <div className="text-xs text-muted-foreground">Desde</div>
                <div className="font-medium">{selected.from_wh?.sites?.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Hacia</div>
                <div className="font-medium">{selected.to_wh?.sites?.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Enviado el</div>
                <div className="font-medium">
                  {new Date(selected.transfer_date).toLocaleDateString("es-CO", {
                    day: "2-digit", month: "long", year: "numeric",
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {transitMismatch.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="p-4 flex gap-3 text-sm">
              <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" />
              <div>
                <div className="font-medium text-destructive">El tránsito no cuadra</div>
                <p className="mt-1 text-muted-foreground">
                  Hay líneas cuyo pendiente supera lo que queda en la bodega de tránsito.
                  Revisa el kardex antes de reconciliar: el sistema rechazará la operación.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Pendientes</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                  <TableHead className="text-right">En tránsito</TableHead>
                  <TableHead className="w-28 text-right">Apareció</TableHead>
                  <TableHead className="text-right">Pérdida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((i: any) => {
                  const f = Math.max(0, Math.min(found[i.product_id] ?? 0, i.pending))
                  const lost = i.pending - f
                  return (
                    <TableRow key={i.transfer_item_id}>
                      <TableCell>
                        <div className="font-medium text-sm">{i.products?.name}</div>
                        <div className="font-mono text-[10px] uppercase text-muted-foreground">
                          {i.products?.code}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{i.pending}</TableCell>
                      <TableCell className="text-right">
                        <span className={i.transit_qty < i.pending ? "text-destructive font-medium" : ""}>
                          {i.transit_qty}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={i.pending}
                          value={found[i.product_id] ?? 0}
                          onChange={(e) =>
                            setFound((prev) => ({
                              ...prev,
                              [i.product_id]: Math.max(0, Math.min(Number(e.target.value) || 0, i.pending)),
                            }))
                          }
                          className="h-9 w-20 text-center ml-auto"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {lost > 0 ? (
                          <Badge variant="destructive">{lost}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">0</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <Separator className="my-4" />

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Pendiente</div>
                  <div className="font-bold">{totals.pending}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Aparecieron</div>
                  <div className="font-bold text-emerald-600 dark:text-emerald-400">{totals.found}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Pérdida</div>
                  <div className="font-bold text-destructive">{totals.lost}</div>
                </div>
                {totals.lostValue > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground">Costo de la pérdida</div>
                    <div className="font-bold text-destructive">{formatCurrency(totals.lostValue)}</div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    setFound(Object.fromEntries(lines.map((i: any) => [i.product_id, i.pending])))
                  }
                >
                  Todo apareció
                </Button>
                <Button
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => {
                    setFound(Object.fromEntries(lines.map((i: any) => [i.product_id, 0])))
                    setConfirmOpen(true)
                  }}
                  disabled={lines.length === 0}
                >
                  <XCircle className="mr-1.5 h-4 w-4" />
                  Cerrar como pérdida total
                </Button>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={lines.length === 0}
                  className="gap-2"
                >
                  <PackageCheck className="h-4 w-4" />
                  Cerrar traslado
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Confirmación */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {totals.found === 0 && totals.lost > 0
                  ? "Cerrar como pérdida total"
                  : "Cerrar el traslado"}
              </DialogTitle>
              <DialogDescription>
                {totals.found === 0 && totals.lost > 0
                  ? 'El traslado quedará en estado "Recibido" (no "Cancelado") con toda la mercancía dada de baja como pérdida en tránsito. Es la forma correcta de cerrar cuando el destino ya recibió parcialmente y el resto no va a llegar.'
                  : "Esta acción es definitiva y queda registrada en el kardex."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Entran al destino</span>
                  <b className="text-emerald-600 dark:text-emerald-400">{totals.found} uds.</b>
                </div>
                <div className="flex justify-between">
                  <span>Se dan de baja como pérdida</span>
                  <b className="text-destructive">{totals.lost} uds.</b>
                </div>
                {totals.lostValue > 0 && (
                  <div className="flex justify-between border-t pt-1 mt-1">
                    <span>Costo de la pérdida</span>
                    <b className="text-destructive">{formatCurrency(totals.lostValue)}</b>
                  </div>
                )}
              </div>

              {totals.lost > 0 && (
                <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    Vas a dar de baja {totals.lost} unidad(es). El movimiento quedará como
                    ajuste negativo en tránsito, a tu nombre.
                  </span>
                </div>
              )}

              <div>
                <Label>Motivo / observaciones</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: faltante confirmado con transportadora"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={working} className="gap-2">
                {working && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar cierre
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ─────────── Lista ───────────
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Reconciliar traslados"
        description="Traslados recibidos con faltantes. Cierra los pendientes y registra las pérdidas."
        icon={ClipboardCheck}
      />

      {isLoading && (
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && transfers.length === 0 && (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <PackageCheck className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="font-medium">No hay traslados por reconciliar</p>
            <p className="mt-1 text-sm">
              Aquí aparecerán los traslados que se recibieron incompletos.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {(transfers as any[]).map((t) => {
          const pending = (t.transfer_items || []).reduce((s: number, i: any) => s + i.pending, 0)
          const refs = (t.transfer_items || []).filter((i: any) => i.pending > 0).length
          return (
            <Card
              key={t.transfer_id}
              className="cursor-pointer transition-colors hover:bg-accent/40"
              onClick={() => open(t)}
            >
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="font-medium">
                    {t.from_wh?.sites?.name} → {t.to_wh?.sites?.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Enviado el{" "}
                    {new Date(t.transfer_date).toLocaleDateString("es-CO", {
                      day: "2-digit", month: "long", year: "numeric",
                    })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">
                    {refs} ref. · {pending} uds. pendientes
                  </div>
                  <Badge variant="outline" className="mt-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
                    Con pendiente
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
