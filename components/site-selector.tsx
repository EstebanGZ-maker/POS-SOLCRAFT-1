"use client"

import { Store, Warehouse } from "lucide-react"
import { useSite } from "@/lib/site-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function SiteSelector() {
  const { sites, currentSite, selectSite, isLoading } = useSite()

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline text-xs font-medium text-muted-foreground">Sede</span>
      <Select value={currentSite?.site_id ?? ""} onValueChange={(v) => selectSite(v)} disabled={isLoading}>
        <SelectTrigger className="h-9 w-[190px] bg-background">
          <SelectValue placeholder="Selecciona sede" />
        </SelectTrigger>
        <SelectContent>
          {sites.map((s) => (
            <SelectItem key={s.site_id} value={s.site_id}>
              <span className="flex items-center gap-2">
                {s.is_central ? (
                  <Warehouse className="h-4 w-4 text-primary" />
                ) : (
                  <Store className="h-4 w-4 text-muted-foreground" />
                )}
                {s.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
