"use client"

import useSWR from "swr"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { useSite } from "@/lib/site-context"
import { formatCurrency } from "@/lib/utils"
import { getSiteInventorySummary } from "@/lib/inventory-actions"
import { getConsolidatedReport } from "@/lib/accounting-actions"
import { setCurrentSite } from "@/lib/site-actions"
import { Store, Warehouse, ShoppingCart, Boxes, Calculator, ArrowRight, Building2 } from "lucide-react"

export default function AdminPage() {
  const { toast } = useToast()
  const { refresh } = useSite()
  const { data: inv = [] } = useSWR("site-inv-summary", getSiteInventorySummary)
  const { data: report = [] } = useSWR("consolidated", getConsolidatedReport)

  const totalIncome = report.reduce((s: number, r: any) => s + r.income, 0)
  const totalExpense = report.reduce((s: number, r: any) => s + r.expense, 0)
  const totalUnits = inv.reduce((s: number, r: any) => s + r.units, 0)

  async function enterSite(site_id: string, name: string) {
    await setCurrentSite(site_id)
    await refresh()
    toast({ title: "Sede activa", description: `Ahora trabajas en ${name}.` })
  }

  const sites = [...inv].sort((a: any, b: any) => Number(b.is_central) - Number(a.is_central))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Administrador principal"
        description="Supervisa todas las sedes y accede al inventario y POS de cada una."
        icon={Building2}
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Ingresos totales</div>
            <div className="text-2xl font-bold text-primary mt-1">{formatCurrency(totalIncome)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Egresos totales</div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(totalExpense)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Unidades en inventario</div>
            <div className="text-2xl font-bold mt-1">{totalUnits.toLocaleString("es-CO")}</div>
          </CardContent>
        </Card>
      </div>

      {/* Site cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sites.map((s: any) => {
          const rep = report.find((r: any) => r.site_id === s.site_id)
          return (
            <Card key={s.site_id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {s.is_central ? (
                      <Warehouse className="h-4 w-4 text-primary" />
                    ) : (
                      <Store className="h-4 w-4 text-primary" />
                    )}
                    {s.name}
                  </CardTitle>
                  {s.is_central && <Badge>Central</Badge>}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Unidades</div>
                    <div className="font-semibold">{s.units.toLocaleString("es-CO")}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Referencias</div>
                    <div className="font-semibold">{s.skus}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Ingresos</div>
                    <div className="font-semibold text-primary">{formatCurrency(rep?.income || 0)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Balance</div>
                    <div className="font-semibold">{formatCurrency(rep?.balance || 0)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-auto pt-2">
                  <Button asChild size="sm" variant="outline" onClick={() => enterSite(s.site_id, s.name)}>
                    <Link href="/inventory/products">
                      <Boxes className="h-4 w-4 mr-1" />
                      Inventario
                    </Link>
                  </Button>
                  {!s.is_central && (
                    <>
                      <Button asChild size="sm" variant="outline" onClick={() => enterSite(s.site_id, s.name)}>
                        <Link href="/pos">
                          <ShoppingCart className="h-4 w-4 mr-1" />
                          POS
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" onClick={() => enterSite(s.site_id, s.name)}>
                        <Link href="/accounting">
                          <Calculator className="h-4 w-4 mr-1" />
                          Contabilidad
                        </Link>
                      </Button>
                    </>
                  )}
                  {s.is_central && (
                    <Button asChild size="sm" onClick={() => enterSite(s.site_id, s.name)}>
                      <Link href="/central">
                        <ArrowRight className="h-4 w-4 mr-1" />
                        Distribuir
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
