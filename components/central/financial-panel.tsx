"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency } from "@/lib/utils"
import {
  getCentralPurchases,
  getCentralDistributions,
  getCentralMarginReport,
} from "@/lib/inventory-actions"
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, Truck, BarChart3 } from "lucide-react"

export function FinancialPanel() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const opts = { from: from || undefined, to: to || undefined }

  const { data: purchases = [] } = useSWR(["central-purchases", from, to], () => getCentralPurchases(opts))
  const { data: distributions = [] } = useSWR(["central-distributions", from, to], () => getCentralDistributions(opts))
  const { data: margins = [] } = useSWR("central-margins", getCentralMarginReport)

  const totalPurchaseCost = purchases.reduce((s: number, p: any) => s + p.total_cost, 0)
  const totalPurchaseValue = purchases.reduce((s: number, p: any) => s + p.total_price, 0)
  const totalDistCost = distributions.reduce((s: number, d: any) => s + d.total_cost, 0)
  const totalDistPrice = distributions.reduce((s: number, d: any) => s + d.total_price, 0)
  const totalMargin = totalDistPrice - totalDistCost

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-blue-500/10 p-2.5">
              <ShoppingBag className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Compras (costo)</div>
              <div className="text-lg font-bold">{formatCurrency(totalPurchaseCost)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-orange-500/10 p-2.5">
              <Truck className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Distribuido (costo)</div>
              <div className="text-lg font-bold">{formatCurrency(totalDistCost)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2.5">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Valor venta distribuido</div>
              <div className="text-lg font-bold text-primary">{formatCurrency(totalDistPrice)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`rounded-full p-2.5 ${totalMargin >= 0 ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
              {totalMargin >= 0 ? (
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              ) : (
                <TrendingDown className="h-5 w-5 text-destructive" />
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Margen distribución</div>
              <div className={`text-lg font-bold ${totalMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                {formatCurrency(totalMargin)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Date filters */}
      <div className="flex gap-2 items-center">
        <span className="text-sm text-muted-foreground">Desde</span>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 h-9" />
        <span className="text-sm text-muted-foreground">Hasta</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 h-9" />
      </div>

      <Tabs defaultValue="purchases">
        <TabsList>
          <TabsTrigger value="purchases">Compras</TabsTrigger>
          <TabsTrigger value="distributions">Distribuciones por sede</TabsTrigger>
          <TabsTrigger value="margins">Márgenes por producto</TabsTrigger>
        </TabsList>

        {/* COMPRAS */}
        <TabsContent value="purchases" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Historial de compras
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {purchases.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No hay entradas de mercancía registradas.</div>
              ) : (
                <div className="divide-y">
                  {purchases.map((p: any) => (
                    <div key={p.adjustment_id} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-medium">{p.notes}</span>
                          <span className="text-sm text-muted-foreground ml-3">
                            {new Date(p.date).toLocaleDateString("es-CO")}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Costo: {formatCurrency(p.total_cost)}</div>
                          <div className="text-sm font-medium text-primary">Valor venta: {formatCurrency(p.total_price)}</div>
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left py-1">Producto</th>
                            <th className="text-right py-1">Cant.</th>
                            <th className="text-right py-1">Costo u.</th>
                            <th className="text-right py-1">Precio venta u.</th>
                            <th className="text-right py-1">Total costo</th>
                            <th className="text-right py-1">Total venta</th>
                            <th className="text-right py-1">Margen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.items.map((it: any, idx: number) => (
                            <tr key={idx} className="border-t border-border/50">
                              <td className="py-1">{it.name} <span className="text-muted-foreground">({it.code})</span></td>
                              <td className="text-right py-1">{it.quantity}</td>
                              <td className="text-right py-1">{formatCurrency(it.cost)}</td>
                              <td className="text-right py-1">{formatCurrency(it.price)}</td>
                              <td className="text-right py-1">{formatCurrency(it.total_cost)}</td>
                              <td className="text-right py-1 text-primary">{formatCurrency(it.total_price)}</td>
                              <td className="text-right py-1 text-emerald-500">
                                {formatCurrency(it.total_price - it.total_cost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DISTRIBUCIONES */}
        <TabsContent value="distributions" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Distribuciones a sedes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {distributions.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No hay distribuciones registradas.</div>
              ) : (
                <div className="divide-y">
                  {distributions.map((d: any) => (
                    <div key={d.transfer_id} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{d.site_name}</Badge>
                          <span className="text-sm text-muted-foreground">
                            {new Date(d.date).toLocaleDateString("es-CO")}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Costo: {formatCurrency(d.total_cost)}</div>
                          <div className="text-sm font-medium text-primary">Venta: {formatCurrency(d.total_price)}</div>
                          <div className="text-xs text-emerald-500 font-medium">Margen: {formatCurrency(d.margin)}</div>
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left py-1">Producto</th>
                            <th className="text-right py-1">Cant.</th>
                            <th className="text-right py-1">Costo u.</th>
                            <th className="text-right py-1">Precio venta u.</th>
                            <th className="text-right py-1">Margen u.</th>
                            <th className="text-right py-1">Margen total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.items.map((it: any, idx: number) => (
                            <tr key={idx} className="border-t border-border/50">
                              <td className="py-1">{it.name}</td>
                              <td className="text-right py-1">{it.quantity}</td>
                              <td className="text-right py-1">{formatCurrency(it.cost)}</td>
                              <td className="text-right py-1">{formatCurrency(it.price)}</td>
                              <td className="text-right py-1 text-emerald-500">{formatCurrency(it.price - it.cost)}</td>
                              <td className="text-right py-1 text-emerald-500 font-medium">
                                {formatCurrency((it.price - it.cost) * it.quantity)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MÁRGENES */}
        <TabsContent value="margins" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Margen por producto
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-3 font-medium">Producto</th>
                    <th className="p-3 font-medium">Código</th>
                    <th className="p-3 font-medium text-right">Costo compra</th>
                    <th className="p-3 font-medium text-right">Precio venta</th>
                    <th className="p-3 font-medium text-right">Margen $</th>
                    <th className="p-3 font-medium text-right">Margen %</th>
                  </tr>
                </thead>
                <tbody>
                  {margins.map((m: any) => (
                    <tr key={m.product_id} className="border-t">
                      <td className="p-3 font-medium">{m.name}</td>
                      <td className="p-3 text-muted-foreground">{m.code}</td>
                      <td className="p-3 text-right">{formatCurrency(m.cost)}</td>
                      <td className="p-3 text-right text-primary">{formatCurrency(m.price)}</td>
                      <td className={`p-3 text-right font-medium ${m.margin >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {formatCurrency(m.margin)}
                      </td>
                      <td className={`p-3 text-right ${m.margin_pct >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {m.margin_pct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
