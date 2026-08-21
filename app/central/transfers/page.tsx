"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getTransfers } from "@/lib/inventory-actions"
import { getSites, type Site } from "@/lib/site-actions"
import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_LABELS,
  isTransferStatus,
  type TransferStatus,
} from "@/lib/transfer-status"
import { Truck } from "lucide-react"

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

  const { data: transfers = [], isLoading } = useSWR(
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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Historial de envíos"
        description="Consulta los envíos de mercancía realizados desde la Bodega Central a las sedes."
        icon={Truck}
      />

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
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No hay traslados con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                transfers.map((t: any) => (
                  <tr key={t.transfer_id} className="border-t">
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {t.transfer_id.slice(0, 8)}
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
