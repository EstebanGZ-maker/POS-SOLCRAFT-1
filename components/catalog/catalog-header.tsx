"use client"

import Link from "next/link"
import useSWR from "swr"
import { useCart } from "@/lib/cart-context"
import { getPublicCommerceConfig } from "@/lib/catalog-actions"
import { Button } from "@/components/ui/button"
import { ShoppingBag } from "lucide-react"

/** Rombo dorado — marca de agua de SOLCRAFT */
function DiamondMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="solcraft-diamond" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--gold-hi))" />
          <stop offset="50%" stopColor="hsl(var(--gold-mid))" />
          <stop offset="100%" stopColor="hsl(var(--gold-lo))" />
        </linearGradient>
      </defs>
      <path d="M16 2 L30 16 L16 30 L2 16 Z" fill="url(#solcraft-diamond)" />
      <path d="M16 7 L25 16 L16 25 L7 16 Z" fill="hsl(var(--background))" opacity=".35" />
    </svg>
  )
}

export function CatalogHeader() {
  const { itemCount } = useCart()
  const { data: config } = useSWR("commerce-config", getPublicCommerceConfig)
  const brand = config?.business_name || "SOLCRAFT"

  return (
    <header className="sticky top-0 z-30 border-b border-gold-soft bg-[hsl(var(--background)/0.85)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/catalog" className="flex items-center gap-2.5 group">
          {config?.logo_url ? (
            <img src={config.logo_url} alt={brand} className="h-8 w-8 rounded object-contain" />
          ) : (
            <DiamondMark className="h-7 w-7 transition-transform duration-300 group-hover:rotate-90 motion-reduce:transition-none" />
          )}
          <span className="font-display text-lg tracking-[0.18em] text-gold-gradient">
            {brand.toUpperCase()}
          </span>
        </Link>

        <nav className="ml-auto mr-3 hidden items-center gap-6 sm:flex">
          <Link
            href="/catalog/productos"
            className="text-sm text-muted-foreground transition-colors hover:text-[hsl(var(--gold-mid))]"
          >
            Catálogo
          </Link>
        </nav>

        <Button
          asChild
          variant="outline"
          size="sm"
          className="relative gap-2 border-gold-soft hover:border-gold-strong bg-transparent"
        >
          <Link href="/catalog/cart">
            <ShoppingBag className="h-4 w-4" />
            <span className="hidden sm:inline">Carrito</span>
            {itemCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground glow-gold-sm">
                {itemCount}
              </span>
            )}
          </Link>
        </Button>
      </div>
    </header>
  )
}
