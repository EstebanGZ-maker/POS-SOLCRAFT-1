"use client"

import { useEffect, useState, useCallback } from "react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { useToast } from "@/hooks/use-toast"
import { useSite } from "@/lib/site-context"
import { formatCurrency } from "@/lib/utils"
import {
  getAccountingEntries,
  getAccountingReport,
  deleteAccountingEntry,
} from "@/lib/accounting-actions"
import { EntryDialog } from "@/components/accounting/entry-dialog"
import { Calculator, Plus, TrendingUp, TrendingDown, Wallet, Trash2, Filter } from "lucide-react"

export default function AccountingPage() {
  const { toast } = useToast()
  const { currentSite } = useSite()
  const siteId = currentSite?.site_id ?? null

  const [entries, setEntries] = useState<any[]>([])
  const [report, setReport] = useState<any>({ income: 0, expense: 0, balance: 0, byMonth: [], byCategory: [] })
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const load = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    const opts = { from: from || undefined, to: to || undefined, type: typeFilter }
    const [e, r] = await Promise.all([
      getAccountingEntries(siteId, opts),
      getAccountingReport(siteId, { from: from || undefined, to: to || undefined }),
    ])
    setEntries(e)
    setReport(r)
    setLoading(false)
  }, [siteId, from, to, typeFilter])

  useEffect(() => {
    load()
  }, [load])

  async function handleDelete(id: string) {
    const res = await deleteAccountingEntry(id)
    if (res.success) {
      toast({ title: "Eliminado" })
      load()
    } else {
      toast({ title: "No permitido", description: res.message, variant: "destructive" })
    }
  }

  const monthLabels = (report.byMonth || []).map((m: any) => {
    const [y, mo] = m.month.split("-")
    const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    return { ...m, label: `${names[Number(mo) - 1]} ${y.slice(2)}` }
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Contabilidad"
        description={`Ingresos, egresos y balance de ${currentSite?.name ?? "la sede"}.`}
        icon={Calculator}
      >
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo movimiento
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-full bg-primary/10 p-3">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Ingresos</div>
              <div className="text-2xl font-bold text-primary">{formatCurrency(report.income)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-full bg-destructive/10 p-3">
              <TrendingDown className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Egresos</div>
              <div className="text-2xl font-bold">{formatCurrency(report.expense)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-full bg-secondary p-3">
              <Wallet className="h-5 w-5 text-secondary-foreground" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Balance</div>
              <div className={`text-2xl font-bold ${report.balance >= 0 ? "text-primary" : "text-destructive"}`}>
                {formatCurrency(report.balance)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingresos vs. egresos por mes</CardTitle>
        </CardHeader>
        <CardContent>
          {monthLabels.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">Sin datos para graficar.</div>
          ) : (
            <ChartContainer
              config={{
                income: { label: "Ingresos", color: "hsl(var(--primary))" },
                expense: { label: "Egresos", color: "hsl(var(--destructive))" },
              }}
              className="h-[280px] w-full"
            >
              <BarChart data={monthLabels}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={80} tickFormatter={(v) => formatCurrency(v)} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="income" fill="var(--color-income)" radius={4} />
                <Bar dataKey="expense" fill="var(--color-expense)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Filters + table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Movimientos
            </CardTitle>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="income">Ingresos</SelectItem>
                  <SelectItem value="expense">Egresos</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 h-9" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 h-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3 font-medium">Fecha</th>
                <th className="p-3 font-medium">Tipo</th>
                <th className="p-3 font-medium">Categoría</th>
                <th className="p-3 font-medium">Descripción</th>
                <th className="p-3 font-medium text-right">Monto</th>
                <th className="p-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No hay movimientos registrados.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.entry_id} className="border-t">
                    <td className="p-3">{new Date(e.entry_date).toLocaleDateString("es-CO")}</td>
                    <td className="p-3">
                      <Badge variant={e.entry_type === "income" ? "default" : "secondary"}>
                        {e.entry_type === "income" ? "Ingreso" : "Egreso"}
                      </Badge>
                    </td>
                    <td className="p-3">{e.category || "—"}</td>
                    <td className="p-3 text-muted-foreground">{e.description || "—"}</td>
                    <td
                      className={`p-3 text-right font-medium ${
                        e.entry_type === "income" ? "text-primary" : "text-destructive"
                      }`}
                    >
                      {e.entry_type === "income" ? "+" : "-"}
                      {formatCurrency(Number(e.amount))}
                    </td>
                    <td className="p-3">
                      {!e.sale_id && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(e.entry_id)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {siteId && (
        <EntryDialog open={dialogOpen} onOpenChange={setDialogOpen} siteId={siteId} onSaved={load} />
      )}
    </div>
  )
}
