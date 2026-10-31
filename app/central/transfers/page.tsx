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
import { dispatchPendingTransfer, getTransfersPaginated, getTransfersTotals, getTransferSummary } from "@/lib/inventory-actions"
import { formatCurrency } from "@/lib/utils"
import { CancelTransferDialog } from "@/components/central/cancel-transfer-dialog"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
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
  const canSeeValue = role === "admin" || role === "contador"
  const [dispatchTarget, setDispatchTarget] = useState<{ id: string; label: string } | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<{ transfer_id: string; status: string; label: string } | null>(null)

  const status: TransferStatus | "all" = isTransferStatus(searchParams.get("status"))
    ? (searchParams.get("status") as TransferStatus)
    : "all"
  const siteFilter = searchParams.get("site") ?? "all"
  const fromSiteFilter = searchParams.get("from_site") ?? "all"
  const toSiteFilter = searchParams.get("to_site") ?? "all"
  const dateFrom = searchParams.get("from") ?? ""
  const dateTo = searchParams.get("to") ?? ""
  const urlQ = searchParams.get("q") ?? ""
  const numeroStr = searchParams.get("numero") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1)
  const PAGE_SIZE = 50

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

  function updateParams(patch: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      const isAllFilter = ["status", "site", "from_site", "to_site"].includes(k)
      if (v == null || v === "" || (isAllFilter && v === "all")) {
        next.delete(k)
      } else {
        next.set(k, v)
      }
    }
    // Al cambiar cualquier filtro reiniciamos la paginación — solo
    // conservamos page cuando se pide explícitamente (botones de paginar).
    if (resetPage && !("page" in patch)) next.delete("page")
    const qs = next.toString()
    router.replace(qs ? `/central/transfers?${qs}` : "/central/transfers", { scroll: false })
  }

  const { data: sites } = useSWR<Site[]>("transfers-sites", () => getSites())

  // Summary independiente de los filtros de la tabla (siempre refleja el
  // total real dentro del scope RLS). Se cachea por su propia key SWR.
  const { data: summary, mutate: mutateSummary } = useSWR("transfer-summary", () => getTransferSummary())

  const { data: transfersData, isLoading, mutate } = useSWR(
    ["transfers-paginated", status, siteFilter, fromSiteFilter, toSiteFilter, dateFrom, dateTo, urlQ, numeroStr, page],
    () =>
      getTransfersPaginated({
        page,
        pageSize: PAGE_SIZE,
        status: status === "all" ? null : status,
        site_id: siteFilter === "all" ? null : siteFilter,
        from_site_id: fromSiteFilter === "all" ? null : fromSiteFilter,
        to_site_id: toSiteFilter === "all" ? null : toSiteFilter,
        // date_to inclusivo hasta fin del día para no cortar traslados del mismo día seleccionado.
        date_from: dateFrom || null,
        date_to: dateTo ? `${dateTo}T23:59:59.999Z` : null,
        q: urlQ || null,
        numero: numeroStr.trim() ? Number(numeroStr) : null,
      }),
  )
  const transfers = transfersData?.rows ?? []
  const total = transfersData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Totales sobre TODOS los resultados filtrados (admin|contador). El
  // server devuelve null para otros roles → no se dispara el fetch.
  const { data: totals } = useSWR(
    canSeeValue
      ? ["transfers-totals", status, siteFilter, fromSiteFilter, toSiteFilter, dateFrom, dateTo, urlQ, numeroStr]
      : null,
    () =>
      getTransfersTotals({
        status: status === "all" ? null : status,
        site_id: siteFilter === "all" ? null : siteFilter,
        from_site_id: fromSiteFilter === "all" ? null : fromSiteFilter,
        to_site_id: toSiteFilter === "all" ? null : toSiteFilter,
        date_from: dateFrom || null,
        date_to: dateTo ? `${dateTo}T23:59:59.999Z` : null,
        q: urlQ || null,
        numero: numeroStr.trim() ? Number(numeroStr) : null,
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

      {canSeeValue && totals && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Unidades enviadas</div>
                <div className="text-2xl font-bold">{totals.units_total}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Excluye cancelados.
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Valor a costo</div>
                <div className="text-2xl font-bold">{formatCurrency(totals.value_total)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {totals.has_estimated
                    ? "Incluye valores aproximados (traslados pendientes o backfill)."
                    : "Costo congelado al despacho."}
                </div>
              </CardContent>
            </Card>
          </div>
          {totals.by_destination.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="border-b px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                  Desglose por sede destino
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Sede</th>
                      <th className="px-3 py-2 text-right font-medium">Traslados</th>
                      <th className="px-3 py-2 text-right font-medium">Unidades</th>
                      <th className="px-3 py-2 text-right font-medium">Valor a costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.by_destination.map((d: any) => (
                      <tr key={d.site_id} className="border-t">
                        <td className="px-3 py-2">{d.site_name}</td>
                        <td className="px-3 py-2 text-right">{d.transfers_count}</td>
                        <td className="px-3 py-2 text-right">{d.units}</td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatCurrency(d.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Buscar producto (nombre o código)"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <Input
          type="number"
          placeholder="N° traslado"
          value={numeroStr}
          onChange={(e) => updateParams({ numero: e.target.value || null })}
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
        <Select value={siteFilter} onValueChange={(v) => updateParams({ site: v, from_site: null, to_site: null })}>
          <SelectTrigger>
            <SelectValue placeholder="Sede (cualquier dirección)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sede (todas)</SelectItem>
            {(sites ?? []).map((s) => (
              <SelectItem key={s.site_id} value={s.site_id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fromSiteFilter} onValueChange={(v) => updateParams({ from_site: v, site: null })}>
          <SelectTrigger>
            <SelectValue placeholder="Origen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Origen (todas)</SelectItem>
            {(sites ?? []).map((s) => (
              <SelectItem key={s.site_id} value={s.site_id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={toSiteFilter} onValueChange={(v) => updateParams({ to_site: v, site: null })}>
          <SelectTrigger>
            <SelectValue placeholder="Destino" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Destino (todas)</SelectItem>
            {(sites ?? []).map((s) => (
              <SelectItem key={s.site_id} value={s.site_id}>{s.name}</SelectItem>
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.replace("/central/transfers", { scroll: false })}
          className="gap-1 self-end"
        >
          <X className="h-3.5 w-3.5" /> Limpiar
        </Button>
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
                {canSeeValue && <th className="p-3 font-medium text-right">Valor</th>}
                <th className="p-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={canSeeValue ? 8 : 7} className="p-6 text-center text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={canSeeValue ? 8 : 7} className="p-6 text-center text-muted-foreground">
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
                    {canSeeValue && (
                      <td className="p-3 text-right">
                        <span
                          className={
                            t.status === "cancelado"
                              ? "text-muted-foreground line-through"
                              : t.has_estimated
                              ? "text-amber-700 dark:text-amber-300"
                              : ""
                          }
                          title={t.has_estimated ? "Incluye valores aproximados" : undefined}
                        >
                          {formatCurrency(Number(t.value_at_cost ?? 0))}
                        </span>
                      </td>
                    )}
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
            <div className="text-muted-foreground">
              {total > 0 ? (
                <>
                  Página <strong>{page}</strong> de <strong>{totalPages}</strong> ·{" "}
                  <strong>{total}</strong> resultado{total === 1 ? "" : "s"}
                </>
              ) : (
                <>Sin resultados</>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateParams({ page: String(Math.max(1, page - 1)) }, false)}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) }, false)}
                disabled={page >= totalPages}
              >
                Siguiente <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
