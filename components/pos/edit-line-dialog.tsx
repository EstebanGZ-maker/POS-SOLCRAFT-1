"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { X, Tag, Trash2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

export interface CartLine {
  product_id: string
  name: string
  code: string | null
  price: number
  base_price: number
  tax_rate: number
  discount: number
  quantity: number
  stock_quantity: number
  description: string
}

interface EditLineDialogProps {
  line: CartLine | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (line: CartLine) => void
  onDelete: (productId: string) => void
}

const TAX_OPTIONS = [
  { label: "Ninguno (0%)", value: 0 },
  { label: "IVA (5%)", value: 5 },
  { label: "IVA (19%)", value: 19 },
]

export function EditLineDialog({ line, open, onOpenChange, onSave, onDelete }: EditLineDialogProps) {
  const [basePrice, setBasePrice] = useState(0)
  const [taxRate, setTaxRate] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [discount, setDiscount] = useState(0)
  const [description, setDescription] = useState("")

  useEffect(() => {
    if (line) {
      setBasePrice(line.base_price)
      setTaxRate(line.tax_rate)
      setQuantity(line.quantity)
      setDiscount(line.discount)
      setDescription(line.description)
    }
  }, [line])

  if (!line) return null

  const finalPrice = basePrice * (1 + taxRate / 100)
  const subtotal = finalPrice * quantity
  const total = subtotal * (1 - discount / 100)

  const handleSave = () => {
    onSave({
      ...line,
      base_price: basePrice,
      tax_rate: taxRate,
      price: finalPrice,
      quantity: Math.max(1, quantity),
      discount,
      description,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden [&>button]:hidden">
        <div className="flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-xl font-semibold text-foreground">Editar venta</h2>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-6 py-5">
            {/* Product row */}
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <Tag className="mt-1 h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Producto</p>
                  <p className="font-semibold text-foreground">{line.name}</p>
                  <p className="text-sm text-primary">{line.code}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onDelete(line.product_id)
                  onOpenChange(false)
                }}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Eliminar producto"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <div className="my-5 border-t" />

            {/* Price / tax / final */}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label>Precio base</Label>
                <Input
                  type="number"
                  min={0}
                  value={basePrice}
                  onChange={(e) => setBasePrice(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
              <span className="pb-2 text-lg text-muted-foreground">+</span>
              <div className="flex-1 space-y-1.5">
                <Label>Impuestos</Label>
                <Select
                  value={String(taxRate)}
                  onValueChange={(v) => setTaxRate(Number.parseFloat(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={String(t.value)}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="pb-2 text-lg text-muted-foreground">=</span>
              <div className="flex-1 space-y-1.5">
                <Label>Precio final</Label>
                <Input value={formatCurrency(finalPrice)} readOnly className="bg-muted" />
              </div>
            </div>

            {/* Quantity / discount */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min={1}
                  max={line.stock_quantity}
                  value={quantity}
                  onChange={(e) => setQuantity(Number.parseInt(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descuento (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={discount}
                  onChange={(e) => setDiscount(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            {/* Description */}
            <div className="mt-4 space-y-1.5">
              <Label>Descripción del producto</Label>
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Totals */}
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-lg font-semibold text-foreground">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={handleSave}>
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
