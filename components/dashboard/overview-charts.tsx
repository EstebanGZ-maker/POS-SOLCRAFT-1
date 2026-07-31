"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { fmtCurrency, fmtDate, fmtNum } from "@/lib/format"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"

const PIE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
]

export function RevenueChart({ data }: { data: { date: string; revenue: number; sales: number }[] }) {
  const chartData = data.map((d) => ({ ...d, label: fmtDate(d.date) }))
  const config: ChartConfig = {
    revenue: { label: "Ventas", color: "hsl(var(--chart-1))" },
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tendencia de ventas</CardTitle>
        <CardDescription>Ingresos por día en el periodo seleccionado</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-[280px] w-full">
          <AreaChart data={chartData} margin={{ left: 4, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
            />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(value) => fmtCurrency(Number(value))} />}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--color-revenue)"
              strokeWidth={2}
              fill="url(#revFill)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export function PaymentDonut({ data }: { data: { method: string; amount: number }[] }) {
  const config: ChartConfig = Object.fromEntries(
    data.map((d, i) => [d.method, { label: d.method, color: PIE_COLORS[i % PIE_COLORS.length] }]),
  )
  const total = data.reduce((s, d) => s + d.amount, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Métodos de pago</CardTitle>
        <CardDescription>Distribución de ingresos</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Sin ventas en el periodo</p>
        ) : (
          <ChartContainer config={config} className="mx-auto h-[220px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => fmtCurrency(Number(value))} />} />
              <Pie data={data} dataKey="amount" nameKey="method" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {data.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        )}
        <div className="mt-2 space-y-1.5">
          {data.map((d, i) => (
            <div key={d.method} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                {d.method}
              </span>
              <span className="font-medium">{fmtCurrency(d.amount)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function CategoryBars({ data }: { data: { category: string; revenue: number }[] }) {
  const chartData = data.slice(0, 6)
  const config: ChartConfig = { revenue: { label: "Ingresos", color: "hsl(var(--chart-2))" } }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ventas por categoría</CardTitle>
        <CardDescription>Ingresos agrupados por categoría de producto</CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Sin datos en el periodo</p>
        ) : (
          <ChartContainer config={config} className="h-[220px] w-full">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="category"
                tickLine={false}
                axisLine={false}
                width={110}
                tickFormatter={(v: string) => (v.length > 14 ? v.slice(0, 13) + "…" : v)}
              />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => fmtCurrency(Number(value))} />} />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 6, 6, 0]} maxBarSize={28} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export { fmtNum }
