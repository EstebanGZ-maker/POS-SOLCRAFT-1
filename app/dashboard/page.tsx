"use client"

import useSWR from "swr"
import { useState } from "react"
import { useSite } from "@/lib/site-context"
import { getDashboardOverview } from "@/lib/dashboard-actions"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { InsightCard } from "@/components/dashboard/insight-card"
import { RevenueChart, PaymentDonut, CategoryBars } from "@/components/dashboard/overview-charts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { fmtCurrency, fmtNum, fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  DollarSign,
  ShoppingCart,
  Receipt,
  Package,
  TrendingUp,
  AlertTriangle,
  Boxes,
  Wallet,
  Loader2,
  Trophy,
} from "lucide-react"

const RANGES = [
  { label: "7 días", value: 7 },
  { label: "30 días", value: 30 },
  { label: "90 días", value: 90 },
]

export default function DashboardPage() {
  const { currentSite, isLoading: siteLoading } = useSite()
  const [days, setDays] = useState(30)
  const siteId = currentSite?.site_id ?? null

  const { data, isLoading } = useSWR(
    siteId ? ["dashboard", siteId, days] : null,
    () => getDashboardOverview(siteId as string, days),
    { revalidateOnFocus: false },
  )

  if (siteLoading || !currentSite) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-balance">Panel general</h1>
          <p className="text-muted-foreground">
            Resumen de <span className="font-medium text-foreground">{currentSite.name}</span> en los últimos {days} días
          </p>
        </div>
        <div className="flex rounded-lg border p-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                days === r.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Ingresos"
              value={fmtCurrency(data.kpis.revenue)}
              change={data.kpis.revenueChange}
              icon={DollarSign}
              sparkline={data.revenueSparkline}
            />
            <KpiCard
              title="Ventas"
              value={fmtNum(data.kpis.salesCount)}
              change={data.kpis.salesCountChange}
              icon={ShoppingCart}
              sparkline={data.salesCountSparkline}
            />
            <KpiCard
              title="Ticket promedio"
              value={fmtCurrency(data.kpis.avgTicket)}
              change={data.kpis.avgTicketChange}
              icon={Receipt}
              sparkline={data.revenueSparkline}
            />
            <KpiCard
              title="Unidades vendidas"
              value={fmtNum(data.kpis.unitsSold)}
              change={data.kpis.unitsSoldChange}
              icon={Package}
              sparkline={data.salesCountSparkline}
            />
          </div>

          {/* Revenue trend */}
          <RevenueChart data={data.salesByDay} />

          {/* Payment + Category */}
          <div className="grid gap-4 lg:grid-cols-2">
            <PaymentDonut data={data.paymentBreakdown} />
            <CategoryBars data={data.categoryBreakdown} />
          </div>

          {/* Top products + insights */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Productos más vendidos</CardTitle>
                <CardDescription>Ranking por ingresos en el periodo</CardDescription>
              </CardHeader>
              <CardContent>
                {data.topProducts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay ventas registradas</p>
                ) : (
                  <div className="space-y-3">
                    {data.topProducts.map((p, i) => (
                      <div key={p.name} className="flex items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtNum(p.units)} unidades</p>
                        </div>
                        <span className="text-sm font-semibold">{fmtCurrency(p.revenue)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Insights</h2>
              {data.kpis.revenueChange >= 0 ? (
                <InsightCard
                  icon={TrendingUp}
                  tone="success"
                  title="Ventas al alza"
                  description={`Los ingresos crecieron respecto al periodo anterior en esta sede.`}
                />
              ) : (
                <InsightCard
                  icon={TrendingUp}
                  tone="warning"
                  title="Ventas a la baja"
                  description="Los ingresos bajaron respecto al periodo anterior. Revisa promociones o inventario."
                />
              )}
              {data.lowStock.length > 0 && (
                <InsightCard
                  icon={AlertTriangle}
                  tone="danger"
                  title={`${data.lowStock.length} productos con stock bajo`}
                  description="Considera solicitar un envío desde la bodega central para reabastecer."
                />
              )}
              <InsightCard
                icon={Boxes}
                tone="default"
                title="Valor del inventario"
                description={`El inventario de esta sede está valorado en ${fmtCurrency(data.inventoryValue)} al costo.`}
              />
            </div>
          </div>

          {/* Low stock + recent sales + accounting */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Stock bajo
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.lowStock.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Todo en orden</p>
                ) : (
                  <div className="space-y-2">
                    {data.lowStock.map((s) => (
                      <div key={s.name} className="flex items-center justify-between text-sm">
                        <span className="truncate pr-2">{s.name}</span>
                        <span className="shrink-0 rounded bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                          {fmtNum(s.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-4 w-4 text-primary" />
                  Ventas recientes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentSales.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Sin ventas recientes</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.recentSales.map((s) => (
                      <div key={s.sale_id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.customer}</p>
                          <p className="text-xs text-muted-foreground">{fmtDateTime(s.date)}</p>
                        </div>
                        <span className="shrink-0 font-semibold">{fmtCurrency(s.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="h-4 w-4 text-primary" />
                  Contabilidad del periodo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Ingresos</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {fmtCurrency(data.accounting.income)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Egresos</span>
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {fmtCurrency(data.accounting.expense)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-3 text-sm">
                  <span className="font-medium">Balance</span>
                  <span
                    className={cn(
                      "text-base font-bold",
                      data.accounting.balance >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {fmtCurrency(data.accounting.balance)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
