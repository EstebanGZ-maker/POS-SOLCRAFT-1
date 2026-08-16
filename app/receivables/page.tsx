"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ChevronDown, ChevronRight, HandCoins, Wallet } from "lucide-react"
import { Fragment } from "react"
import { getReceivables, type AgeBucket, type ReceivableGroup, type ReceivableSale } from "@/lib/actions"
import { getSites, type Site } from "@/lib/site-actions"
import { getCurrentShift } from "@/lib/shift-actions"
import { formatCurrency } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { RegisterPaymentDialog } from "@/components/credit/register-payment-dialog"

function bucketBadge(bucket: AgeBucket) {
  if (bucket === "0-30")
    return (
      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        0–30 días
      </Badge>
    )
  if (bucket === "31-60")
    return (
      <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
        31–60 días
      </Badge>
    )
  return (
    <Badge variant="destructive">
      60+ días
    </Badge>
  )
}

interface PaymentTarget {
  sale: ReceivableSale & { customer_id: string; customer_name: string }
  shiftId: string | null
}

export default function ReceivablesPage() {
  const { role } = useAuth()
  // Rol contador puede leer /receivables (defensa en profundidad ya está en
  // getReceivables), pero no puede mutar. Ocultamos el CTA de "Registrar
  // abono" para no mostrar un botón que fallaría server-side.
  const canMutate = role !== "contador"
  const [siteFilter, setSiteFilter] = useState<string>("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Sedes que el usuario puede ver — para el filtro. RLS ya recorta el
  // dropdown a las accesibles.
  const { data: sites } = useSWR<Site[]>("receivables-sites", () => getSites())

  // Listado principal.
  const { data, mutate, isLoading } = useSWR(
    ["receivables", siteFilter, refreshKey],
    async () => {
      const res = await getReceivables({
        site_id: siteFilter === "all" ? null : siteFilter,
      })
      return res
    },
  )

  const groups: ReceivableGroup[] = data?.success ? data.groups : []
  const totalPendiente = useMemo(
    () => groups.reduce((s, g) => s + g.total_pendiente, 0),
    [groups],
  )
  const totalClientes = groups.length
  const totalVentas = useMemo(
    () => groups.reduce((s, g) => s + g.sales_count, 0),
    [groups],
  )

  function toggle(cid: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cid)) next.delete(cid)
      else next.add(cid)
      return next
    })
  }

  async function openPayment(
    sale: ReceivableSale,
    group: ReceivableGroup,
  ) {
    // Averigua si hay turno abierto en la sede DE LA VENTA para permitir cash.
    let shiftId: string | null = null
    if (sale.site_id) {
      const shift = await getCurrentShift(sale.site_id)
      shiftId = shift?.shift_id ?? null
    }
    setPaymentTarget({
      sale: { ...sale, customer_id: group.customer_id, customer_name: group.customer_name },
      shiftId,
    })
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader
        title="Cuentas por cobrar"
        description={
          canMutate
            ? "Ventas a crédito con saldo pendiente, agrupadas por cliente."
            : "Vista de solo lectura. Los abonos se registran desde el POS."
        }
      >
        <Select value={siteFilter} onValueChange={setSiteFilter}>
          <SelectTrigger className="w-[220px]">
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
      </PageHeader>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Total por cobrar</div>
            <div className="text-2xl font-bold">{formatCurrency(totalPendiente)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Clientes con saldo</div>
            <div className="text-2xl font-bold">{totalClientes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Ventas abiertas</div>
            <div className="text-2xl font-bold">{totalVentas}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-4 text-sm text-muted-foreground">Cargando…</div>
          )}
          {!isLoading && groups.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No hay saldos pendientes con el filtro actual.
            </div>
          )}
          {!isLoading && groups.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Facturado</TableHead>
                  <TableHead className="text-right">Abonado</TableHead>
                  <TableHead className="text-right">Por cobrar</TableHead>
                  <TableHead>Antigüedad</TableHead>
                  <TableHead className="text-right">Saldo a favor</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <Fragment key={g.customer_id}>
                      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(g.customer_id)}>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); toggle(g.customer_id) }}>
                            {expanded.has(g.customer_id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{g.customer_name}</div>
                          {g.customer_phone && (
                            <div className="text-xs text-muted-foreground">
                              {g.customer_phone}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(g.total_facturado)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(g.total_abonado)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary">
                          {formatCurrency(g.total_pendiente)}
                        </TableCell>
                        <TableCell>{bucketBadge(g.oldest_bucket)}</TableCell>
                        <TableCell className="text-right">
                          {g.customer_credit_balance > 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <Wallet className="h-3 w-3" />
                              {formatCurrency(g.customer_credit_balance)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {g.sales_count}
                        </TableCell>
                      </TableRow>

                      {expanded.has(g.customer_id) && (
                        <TableRow className="bg-muted/20">
                          <TableCell />
                          <TableCell colSpan={7} className="p-0">
                            <div className="px-3 py-2 space-y-2">
                              {g.sales.map((s) => (
                                <div
                                  key={s.sale_id}
                                  className="flex items-center justify-between rounded-md border bg-background p-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-sm font-medium">
                                        {s.numero != null ? `Venta #${s.numero}` : `Venta ${s.sale_id.slice(0, 8)}`}
                                      </span>
                                      {bucketBadge(s.age_bucket)}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      <span>
                                        Total: <b className="text-foreground">{formatCurrency(s.total_amount)}</b>
                                      </span>
                                      <span>
                                        Abonado: <b className="text-foreground">{formatCurrency(s.amount_paid)}</b>
                                      </span>
                                      <span>
                                        Por cobrar: <b className="text-primary">{formatCurrency(s.balance_due)}</b>
                                      </span>
                                      <span>{s.age_days} días</span>
                                    </div>
                                  </div>
                                  {canMutate && (
                                    <Button
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        openPayment(s, g)
                                      }}
                                    >
                                      <HandCoins className="mr-1.5 h-4 w-4" />
                                      Registrar abono
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RegisterPaymentDialog
        open={!!paymentTarget}
        onOpenChange={(v) => !v && setPaymentTarget(null)}
        sale={
          paymentTarget
            ? {
                sale_id: paymentTarget.sale.sale_id,
                numero: paymentTarget.sale.numero,
                customer_id: paymentTarget.sale.customer_id,
                customer_name: paymentTarget.sale.customer_name,
                total_amount: paymentTarget.sale.total_amount,
                amount_paid: paymentTarget.sale.amount_paid,
                balance_due: paymentTarget.sale.balance_due,
              }
            : null
        }
        shiftId={paymentTarget?.shiftId ?? null}
        onDone={() => {
          setPaymentTarget(null)
          setRefreshKey((k) => k + 1)
          mutate()
        }}
      />
    </div>
  )
}
