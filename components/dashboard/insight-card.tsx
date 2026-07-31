import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

type InsightCardProps = {
  icon: LucideIcon
  title: string
  description: string
  tone?: "default" | "success" | "warning" | "danger"
}

const toneStyles: Record<NonNullable<InsightCardProps["tone"]>, string> = {
  default: "border-border bg-card text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
}

export function InsightCard({ icon: Icon, title, description, tone = "default" }: InsightCardProps) {
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-4", toneStyles[tone])}>
      <div className="mt-0.5 shrink-0">
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs leading-relaxed">{description}</p>
      </div>
    </div>
  )
}
