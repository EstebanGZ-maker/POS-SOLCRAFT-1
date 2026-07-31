"use client"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { fmtPct } from "@/lib/format"
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer } from "recharts"

type KpiCardProps = {
  title: string
  value: string
  change?: number
  icon: LucideIcon
  sparkline?: number[]
  positiveIsGood?: boolean
}

export function KpiCard({ title, value, change, icon: Icon, sparkline = [], positiveIsGood = true }: KpiCardProps) {
  const hasChange = typeof change === "number" && Number.isFinite(change)
  const isUp = (change ?? 0) >= 0
  const isGood = positiveIsGood ? isUp : !isUp
  const data = sparkline.map((v, i) => ({ i, v }))
  const chartColor = isGood ? "hsl(var(--success, 142 71% 45%))" : "hsl(var(--destructive))"

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span>{title}</span>
          </div>
          {hasChange && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                isGood
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/15 text-red-600 dark:text-red-400",
              )}
            >
              {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {fmtPct(change!)}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="text-2xl font-bold tracking-tight">{value}</div>
          {data.length > 1 && (
            <div className="h-10 w-24">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                  <defs>
                    <linearGradient id={`spark-${title}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill={`url(#spark-${title})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
