"use client"

import Link from "next/link"
import useSWR from "swr"
import { useCart } from "@/lib/cart-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getPublicCommerceConfig } from "@/lib/catalog-actions"
import { formatCurrency } from "@/lib/utils"
import { ImageOff, Minus, Plus, ShoppingBag, Trash2, ArrowRight } from "lucide-react"

export default function CartPage() {
  const { items, subtotal, updateQuantity, removeItem, itemCount } = useCart()
  const { data: business } = useSWR("commerce-config", getPublicCommerceConfig)

  const shipping = business?.shipping_cost ?? 0
  const free = business?.free_shipping_over ?? null
  const shippingApplied = free && subtotal >= free ? 0 : shipping
  const total = subtotal + shippingApplied

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <ShoppingBag className="h-16 w-16 mx-auto text-[hsl(var(--gold-lo))] opacity-40 mb-4" />
        <h1 className="font-display text-2xl mb-2">Tu carrito está vacío</h1>
        <p className="text-muted-foreground mb-6">Explora el catálogo y agrega productos.</p>
        <Button asChild className="glow-gold-sm">
          <Link href="/catalog/productos">Ir al catálogo</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <h1 className="font-display text-3xl flex items-center gap-3">
        <ShoppingBag className="h-6 w-6 text-[hsl(var(--gold-mid))]" />
        Tu carrito
        <span className="text-base font-normal text-muted-foreground">({itemCount})</span>
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-3">
          {items.map((it) => (
            <Card key={it.product_id} className="border-gold-soft surface-gold">
              <CardContent className="p-4 flex gap-4">
                <div className="h-20 w-20 shrink-0 rounded-xl bg-muted overflow-hidden flex items-center justify-center">
                  {it.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff className="h-8 w-8 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--gold-lo))]">{it.code}</div>
                  <div className="font-medium line-clamp-2">{it.name}</div>
                  <div className="text-sm text-muted-foreground">{formatCurrency(it.price)} c/u</div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="icon" variant="outline" className="h-7 w-7 border-gold-soft bg-transparent" onClick={() => updateQuantity(it.product_id, it.quantity - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      className="h-7 w-14 text-center border-gold-soft bg-transparent"
                      type="number"
                      min={1}
                      value={it.quantity}
                      onChange={(e) => updateQuantity(it.product_id, Number(e.target.value) || 1)}
                    />
                    <Button size="icon" variant="outline" className="h-7 w-7 border-gold-soft bg-transparent" onClick={() => updateQuantity(it.product_id, it.quantity + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto text-destructive" onClick={() => removeItem(it.product_id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="text-right font-mono font-bold text-[hsl(var(--gold-mid))]">
                  {formatCurrency(it.price * it.quantity)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          <Card className="sticky top-24 border-gold-soft surface-gold">
            <CardContent className="p-5 space-y-3">
              <h2 className="font-display text-lg">Resumen</h2>
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Envío</span>
                <span>{shippingApplied === 0 ? <span className="text-green-600 font-medium">Gratis</span> : formatCurrency(shippingApplied)}</span>
              </div>
              {free && subtotal < free && (
                <p className="text-xs text-muted-foreground">
                  Añade {formatCurrency(free - subtotal)} más para envío gratis.
                </p>
              )}
              <div className="border-t border-gold-soft pt-3 flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="font-mono text-gold-gradient">{formatCurrency(total)}</span>
              </div>
              <Button asChild className="w-full gap-2 mt-2 glow-gold-sm" size="lg">
                <Link href="/catalog/checkout">
                  Finalizar compra <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full border-gold-soft bg-transparent hover:border-gold-strong">
                <Link href="/catalog/productos">Seguir comprando</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
