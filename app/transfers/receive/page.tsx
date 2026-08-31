"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/auth-context"
import { useSite } from "@/lib/site-context"
import {
  getPendingTransfersForSite,
  getTransferById,
  receiveTransfer,
} from "@/lib/inventory-actions"
import {
  PackageCheck,
  Truck,
  ArrowLeft,
  Check,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react"

function TransferList({
  transfers,
  onSelect,
}: {
  transfers: any[]
  onSelect: (id: string) => void
}) {
  if (transfers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <PackageCheck className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No hay envíos pendientes de recibir</p>
          <p className="text-sm mt-1">Cuando te envíen mercancía desde la bodega central o desde otra sede, aparecerá aquí.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {transfers.map((t: any) => {
        const totalItems = (t.transfer_items || []).reduce(
          (s: number, i: any) => s + i.quantity,
          0
        )
        const totalReceived = (t.transfer_items || []).reduce(
          (s: number, i: any) => s + (i.quantity_received || 0),
          0
        )
        const isPartial = t.status === "recibido_con_pendiente"

        return (
          <Card
            key={t.transfer_id}
            className="cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => onSelect(t.transfer_id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm">
                      Desde: {(t.from_wh as any)?.sites?.name || "—"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.transfer_date).toLocaleDateString("es-CO", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  {t.notes && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {t.notes}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium">
                    {(t.transfer_items || []).length} ref. · {totalItems} uds.
                  </div>
                  {isPartial && (
                    <Badge variant="outline" className="mt-1 text-amber-600 border-amber-300">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Parcial ({totalReceived}/{totalItems})
                    </Badge>
                  )}
                  {!isPartial && (
                    <Badge variant="outline" className="mt-1 text-blue-600 border-blue-300">
                      <Clock className="h-3 w-3 mr-1" />
                      Pendiente
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function ReceiveChecklist({
  transferId,
  onBack,
  onDone,
}: {
  transferId: string
  onBack: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const { data: transfer, isLoading } = useSWR(
    `transfer-${transferId}`,
    () => getTransferById(transferId)
  )
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)

  const items = useMemo(() => {
    if (!transfer) return []
    return ((transfer as any).transfer_items || []).map((ti: any) => {
      const alreadyReceived = ti.quantity_received || 0
      const remaining = ti.quantity - alreadyReceived
      return {
        ...ti,
        alreadyReceived,
        remaining,
        product: ti.products,
      }
    })
  }, [transfer])

  // Initialize quantities to remaining when data loads
  useMemo(() => {
    if (items.length > 0 && Object.keys(quantities).length === 0) {
      const init: Record<string, number> = {}
      for (const item of items) {
        if (item.remaining > 0) {
          init[item.product_id] = item.remaining
        }
      }
      setQuantities(init)
    }
  }, [items])

  if (isLoading || !transfer) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando detalle del envío...
        </CardContent>
      </Card>
    )
  }

  const hasItemsToReceive = items.some((i: any) => i.remaining > 0)

  async function handleSubmit() {
    const toReceive = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([product_id, quantity_received]) => ({ product_id, quantity_received }))

    if (toReceive.length === 0) {
      toast({ title: "Sin cambios", description: "No hay cantidades para recibir.", variant: "destructive" })
      return
    }

    setSubmitting(true)
    const res = await receiveTransfer(transferId, toReceive)
    toast({
      title: res.success ? "Recepción registrada" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    setSubmitting(false)
    if (res.success) onDone()
  }

  function setAllToMax() {
    const init: Record<string, number> = {}
    for (const item of items) {
      if (item.remaining > 0) init[item.product_id] = item.remaining
    }
    setQuantities(init)
  }

  function setAllToZero() {
    const init: Record<string, number> = {}
    for (const item of items) {
      init[item.product_id] = 0
    }
    setQuantities(init)
  }

  const totalSent = items.reduce((s: number, i: any) => s + i.quantity, 0)
  const totalAlreadyReceived = items.reduce((s: number, i: any) => s + i.alreadyReceived, 0)
  const totalToReceiveNow = Object.values(quantities).reduce((s, q) => s + q, 0)

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> Volver a la lista
      </Button>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Envío desde {(transfer as any).from_wh?.sites?.name || "—"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {new Date(transfer.transfer_date).toLocaleDateString("es-CO", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {transfer.notes && ` · ${transfer.notes}`}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center text-sm mb-4">
            <div>
              <div className="text-muted-foreground">Enviado</div>
              <div className="text-xl font-bold">{totalSent}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Ya recibido</div>
              <div className="text-xl font-bold text-green-600">{totalAlreadyReceived}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Recibir ahora</div>
              <div className="text-xl font-bold text-blue-600">{totalToReceiveNow}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {hasItemsToReceive && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={setAllToMax}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Todo conforme
          </Button>
          <Button variant="outline" size="sm" onClick={setAllToZero}>
            Limpiar cantidades
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3 font-medium">Producto</th>
                <th className="p-3 font-medium text-center">Enviado</th>
                <th className="p-3 font-medium text-center">Ya recibido</th>
                <th className="p-3 font-medium text-center">Pendiente</th>
                <th className="p-3 font-medium text-center">Recibir</th>
                <th className="p-3 font-medium text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => {
                const qtyNow = quantities[item.product_id] ?? 0
                const isComplete = item.alreadyReceived >= item.quantity
                const willComplete = item.alreadyReceived + qtyNow >= item.quantity
                const hasDiff = qtyNow < item.remaining && qtyNow > 0

                return (
                  <tr key={item.transfer_item_id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{item.product?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.product?.code || ""}
                      </div>
                    </td>
                    <td className="p-3 text-center font-mono">{item.quantity}</td>
                    <td className="p-3 text-center font-mono text-green-600">
                      {item.alreadyReceived > 0 ? item.alreadyReceived : "—"}
                    </td>
                    <td className="p-3 text-center font-mono">
                      {isComplete ? (
                        <Check className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <span className="text-amber-600">{item.remaining}</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {isComplete ? (
                        <span className="text-xs text-muted-foreground">Completo</span>
                      ) : (
                        <Input
                          type="number"
                          min={0}
                          max={item.remaining}
                          value={qtyNow}
                          onChange={(e) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [item.product_id]: Math.min(
                                Math.max(0, parseInt(e.target.value) || 0),
                                item.remaining
                              ),
                            }))
                          }
                          className="w-20 text-center mx-auto h-8"
                        />
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {isComplete ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <Check className="h-3 w-3 mr-1" /> OK
                        </Badge>
                      ) : willComplete ? (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Conforme
                        </Badge>
                      ) : hasDiff ? (
                        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Parcial
                        </Badge>
                      ) : qtyNow === 0 && item.remaining > 0 ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Sin recibir
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {hasItemsToReceive && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onBack}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || totalToReceiveNow === 0}
          >
            <PackageCheck className="h-4 w-4 mr-2" />
            {submitting ? "Registrando..." : "Confirmar recepción"}
          </Button>
        </div>
      )}

      {!hasItemsToReceive && (
        <Card>
          <CardContent className="py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
            <p className="font-medium text-green-700">Todo recibido</p>
            <p className="text-sm text-muted-foreground mt-1">
              Esta transferencia ya fue recibida completamente.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function ReceiveTransfersPage() {
  const { role, assignedSiteId } = useAuth()
  const { currentSite } = useSite()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Se recibe en la sede activa del selector, no en la sede primaria fija:
  // un encargado con varias sedes debe poder recibir en cualquiera de ellas.
  const effectiveSiteId = currentSite?.site_id ?? assignedSiteId
  const { data: transfers = [], mutate } = useSWR(
    effectiveSiteId ? `pending-transfers-${effectiveSiteId}` : null,
    () => getPendingTransfersForSite(effectiveSiteId!)
  )

  async function handleRefresh() {
    setRefreshing(true)
    await mutate()
    setRefreshing(false)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Recibir mercancía"
          description="Verifica y confirma la mercancía que llega a esta sede, venga de la bodega central o de otra sede."
        />
        {!selectedId && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing || !effectiveSiteId}
            className="gap-2 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        )}
      </div>

      {!selectedId ? (
        <TransferList
          transfers={transfers}
          onSelect={(id) => setSelectedId(id)}
        />
      ) : (
        <ReceiveChecklist
          transferId={selectedId}
          onBack={() => setSelectedId(null)}
          onDone={() => {
            setSelectedId(null)
            mutate()
          }}
        />
      )}
    </div>
  )
}
