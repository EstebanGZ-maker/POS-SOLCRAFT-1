import type { ReactNode } from "react"
import { CartProvider } from "@/lib/cart-context"
import { CatalogHeader } from "@/components/catalog/catalog-header"
import { CatalogFooter } from "@/components/catalog/catalog-footer"

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      {/* .catalog-theme aísla la paleta gold/black del resto del POS */}
      <div className="catalog-theme min-h-screen flex flex-col antialiased">
        <CatalogHeader />
        <main className="flex-1">{children}</main>
        <CatalogFooter />
      </div>
    </CartProvider>
  )
}
