"use client"

import useSWR from "swr"
import { getPublicCommerceConfig } from "@/lib/catalog-actions"
import { Phone, Mail, MapPin } from "lucide-react"

export function CatalogFooter() {
  const { data: config } = useSWR("commerce-config", getPublicCommerceConfig)
  const brand = config?.business_name || "Tienda"
  const tagline = config?.catalog_tagline || "Tienda en línea"

  return (
    <footer className="mt-16 border-t border-gold-soft">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <div className="font-display text-base tracking-[0.18em] text-gold-gradient">
              {brand.toUpperCase()}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {tagline}
            </p>
          </div>

          <div className="space-y-1.5 text-sm text-muted-foreground">
            {config?.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-[hsl(var(--gold-lo))]" />
                {config.phone}
              </div>
            )}
            {config?.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-[hsl(var(--gold-lo))]" />
                {config.email}
              </div>
            )}
            {config?.address && (
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-lo))]" />
                {config.address}
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            <p>Los precios y la disponibilidad pueden variar sin previo aviso.</p>
          </div>
        </div>

        <div className="mt-8 border-t border-gold-soft pt-5 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {brand}. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  )
}
