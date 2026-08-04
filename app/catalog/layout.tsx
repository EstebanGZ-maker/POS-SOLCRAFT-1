import type { ReactNode } from "react"
import { Cinzel } from "next/font/google"
import { CartProvider } from "@/lib/cart-context"
import { CatalogHeader } from "@/components/catalog/catalog-header"
import { CatalogFooter } from "@/components/catalog/catalog-footer"

// Tipografía display de la tienda. Scoped al catálogo vía CSS var — el
// POS interno sigue con Inter.
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-cinzel",
  display: "swap",
})

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      {/* .catalog-theme aísla la paleta gold/black del resto del POS */}
      <div className={`${cinzel.variable} catalog-theme min-h-screen flex flex-col antialiased`}>
        <CatalogHeader />
        <main className="flex-1">{children}</main>
        <CatalogFooter />
      </div>
    </CartProvider>
  )
}
