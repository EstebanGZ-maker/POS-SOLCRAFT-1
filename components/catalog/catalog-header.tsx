"use client"

import Link from "next/link"
import Image from "next/image"
import useSWR from "swr"
import { useCart } from "@/lib/cart-context"
import { getPublicCommerceConfig } from "@/lib/catalog-actions"
import { Button } from "@/components/ui/button"
import { ShoppingBag } from "lucide-react"

export function CatalogHeader() {
  const { itemCount } = useCart()
  const { data: config } = useSWR("commerce-config", getPublicCommerceConfig)
  const brand = config?.business_name || "Tienda"

  return (
    <header className="sticky top-0 z-30 border-b border-gold-soft bg-[hsl(var(--background)/0.85)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/catalog" className="flex items-center gap-2.5 group">
          {config?.logo_url ? (
            <img src={config.logo_url} alt={brand} className="h-8 w-8 rounded object-contain" />
          ) : (
            <Image
              src="/taiwy-logo.png"
              alt={brand}
              width={64}
              height={64}
              priority
              className="h-8 w-8 object-contain transition-transform duration-300 group-hover:rotate-90 motion-reduce:transition-none"
            />
          )}
          <span className="font-display text-lg tracking-[0.18em] text-gold-gradient">
            {`${brand.toUpperCase()} STORE`}
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
