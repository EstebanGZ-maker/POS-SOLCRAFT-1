"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/auth-context"
import { dispatchPendingTransfer, getTransfers, getTransferSummary } from "@/lib/inventory-actions"
import { CancelTransferDialog } from "@/components/central/cancel-transfer-dialog"
import { X } from "lucide-react"
import { getSites, type Site } from "@/lib/site-actions"
import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_LABELS,
  isTransferStatus,
  type TransferStatus,
} from "@/lib/transfer-status"
import { AlertTriangle, ArrowRight, Loader2, Send, Truck } from "lucide-react"

function statusBadgeClass(status: string): string {
  switch (status) {
    case "recibido":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    case "en_transito":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    case "recibido_con_pendiente":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
    case "pendiente":
      return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
    case "cancelado":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    default:
      return ""
  }
}

function statusLabel(status: string): string {
  return isTransferStatus(status) ? TRANSFER_STATUS_LABELS[status] : status
}

export default function TransfersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const canDispatch = role === "admin" || role === "encargado"
  const [dispatchTarget, setDispatchTarget] = useState<{ id: string; label: string } | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<{ transfer_id: string; status: string; label: string } | null>(null)

  const status: TransferStatus | "all" = isTransferStatus(searchParams.get("status"))
    ? (searchParams.get("status") as TransferStatus)
    : "all"
  const siteFilter = searchParams.get("site") ?? "all"
  const dateFrom = searchParams.get("from") ?? ""
  const dateTo = searchParams.get("to") ?? ""
  const urlQ = searchParams.get("q") ?? ""

  const [qInput, setQInput] = useState(urlQ)
  useEffect(() => {
    setQInput(urlQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ])
  useEffect(() => {
    const handle = setTimeout(() => {
      if (qInput === urlQ) return
      updateParams({ q: qInput.trim() || null })
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput])

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "" || ((k === "status" || k === "site") && v === "all")) {
        next.delete(k)
      } else {
        next.set(k, v)
      }
    }
    const qs = next.toString()
    router.replace(qs ? `/central/transfers?${qs}` : "/central/transfers", { scroll: false })
  }

  const { data: sites } = useSWR<Site[]>("transfers-sites", () => getSites())

  // Summary independiente de los filtros de la tabla (siempre refleja el
  // total real dentro del scope RLS). Se cachea por su propia key SWR.
  const { data: summary, mutate: mutateSummary } = useSWR("transfer-summary", () => getTransferSummary())

  const { data: transfers = [], isLoading, mutate } = useSWR(
    ["transfers", status, siteFilter, dateFrom, dateTo, urlQ],
    () =>
      getTransfers({
        status: status === "all" ? null : status,
        site_id: siteFilter === "all" ? null : siteFilter,
        // date_to inclusivo hasta fin del día para no cortar traslados del mismo día seleccionado.
        date_from: dateFrom || null,
        date_to: dateTo ? `${dateTo}T23:59:59.999Z` : null,
        q: urlQ || null,
      }),
  )

  async function handleDispatch() {
    if (!dispatchTarget) return
    setDispatching(true)
    const res = await dispatchPendingTransfer(dispatchTarget.id)
    setDispatching(false)
    setDispatchTarget(null)
    toast({
      title: res.success ? "Despachado" : "No se pudo despachar",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      mutate()
      mutateSummary()
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Historial de envíos"
        description="Consulta los envíos de mercancía realizados desde la Bodega Central a las sedes."
        icon={Truck}
      />

      {/* Resumen por estado — clicable, aplica el filtro en la tabla de abajo */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {TRANSFER_STATUSES.map((s) => {
          const n = summary?.by_status?.[s] ?? 0
          const active = status === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => updateParams({ status: active ? "all" : s })}
              className={`rounded-md border p-3 text-left transition hover:bg-muted/50 ${
                active ? "border-primary ring-1 ring-primary" : ""
              }`}
              aria-pressed={active}
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={statusBadgeClass(s)}>
                  {TRANSFER_STATUS_LABELS[s]}
                </Badge>
              </div>
              <div className="mt-2 text-2xl font-bold">{n}</div>
            </button>
          )
        })}
      </div>

      {/* Alerta admin-only: hay al menos 1 fantasma detectado */}
      {role === "admin" && summary?.ghosts && summary.ghosts.count > 0 && summary.ghosts.sample_id && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <span className="font-medium text-amber-800 dark:text-amber-200">
                {summary.ghosts.count} traslado{summary.ghosts.count === 1 ? "" : "s"} con inconsistencia detectada
              </span>
              <p className="text-xs text-muted-foreground">
                En tránsito sin ningún movimiento de stock asociado (registro huérfano).
                Ábrelo para cerrarlo como corrección de registro.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/central/transfers/${summary.ghosts.sample_id}`}>
              Ver traslado
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          placeholder="Buscar producto (nombre o código)"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <Select value={status} onValueChange={(v) => updateParams({ status: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {TRANSFER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TRANSFER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={siteFilter} onValueChange={(v) => updateParams({ site: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sedes</SelectItem>
            {(sites ?? []).map((s) => (
              <SelectItem key={s.site_id} value={s.site_id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => updateParams({ from: e.target.value || null })}
          placeholder="Desde"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => updateParams({ to: e.target.value || null })}
          placeholder="Hasta"
        />
      </div>

      <CancelTransferDialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        transfer={cancelTarget}
        onDone={() => {
          setCancelTarget(null)
          mutate()
          mutateSummary()
        }}
      />

      <AlertDialog open={!!dispatchTarget} onOpenChange={(v) => !v && setDispatchTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Despachar este traslado?</AlertDialogTitle>
            <AlertDialogDescription>
              {dispatchTarget?.label && <span className="block mb-2 font-medium">{dispatchTarget.label}</span>}
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

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3 font-medium">ID</th>
                <th className="p-3 font-medium">Fecha</th>
                <th className="p-3 font-medium">Origen</th>
                <th className="p-3 font-medium">Destino</th>
                <th className="p-3 font-medium text-right">Productos</th>
                <th className="p-3 font-medium">Estado</th>
                <th className="p-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No hay traslados con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                transfers.map((t: any) => (
                  <tr key={t.transfer_id} className="border-t">
                    <td className="p-3 font-mono text-xs">
                      <Link href={`/central/transfers/${t.transfer_id}`} className="text-primary hover:underline">
                        {t.transfer_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="p-3">
                      {new Date(t.transfer_date).toLocaleDateString("es-CO")}
                    </td>
                    <td className="p-3">
                      {t.from_wh?.sites?.name} · {t.from_wh?.name}
                    </td>
                    <td className="p-3">
                      {t.to_wh?.sites?.name} · {t.to_wh?.name}
                    </td>
                    <td className="p-3 text-right">{t.transfer_items?.length ?? 0}</td>
                    <td className="p-3">
                      <Badge variant="secondary" className={statusBadgeClass(t.status)}>
                        {statusLabel(t.status)}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        {t.status === "pendiente" && canDispatch && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDispatchTarget({
                                id: t.transfer_id,
                                label: `${t.from_wh?.sites?.name} → ${t.to_wh?.sites?.name}`,
                              })
                            }
                          >
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            Despachar
                          </Button>
                        )}
                        {(t.status === "pendiente" || t.status === "en_transito") && canDispatch && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              setCancelTarget({
                                transfer_id: t.transfer_id,
                                status: t.status,
                                label: `${t.from_wh?.sites?.name} → ${t.to_wh?.sites?.name}`,
                              })
                            }
                          >
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
