"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCart } from "@/lib/cart-context"
import { useToast } from "@/hooks/use-toast"
import { Minus, Plus, ShoppingCart } from "lucide-react"

interface Props {
  product: {
    product_id: string
    code: string
    name: string
    price: number
    image_url: string | null
  }
  disabled?: boolean
}

export function AddToCartButton({ product, disabled }: Props) {
  const { addItem } = useCart()
  const { toast } = useToast()
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)

  function handleAdd() {
    addItem(product, qty)
    setAdded(true)
    toast({ title: "Agregado al carrito", description: `${qty} × ${product.name}` })
  }

  if (disabled) {
    return (
      <Button disabled size="lg" className="w-full">
        Agotado
      </Button>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Cantidad</span>
        <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setQty(Math.max(1, qty - 1))}>
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          className="h-9 w-16 text-center"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
        />
        <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setQty(qty + 1)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Button size="lg" className="w-full gap-2" onClick={handleAdd}>
        <ShoppingCart className="h-4 w-4" />
        Agregar al carrito
      </Button>

      {added && (
        <Button asChild size="lg" variant="outline" className="w-full">
          <Link href="/catalog/cart">Ir al carrito</Link>
        </Button>
      )}
    </div>
  )
}
