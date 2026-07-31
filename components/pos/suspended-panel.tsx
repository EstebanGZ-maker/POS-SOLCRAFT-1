"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatCurrency } from "@/lib/utils"
import { getSuspendedSales, resumeSuspendedSale, deleteSuspendedSale } from "@/lib/suspended-actions"
import { toast } from "@/components/ui/use-toast"
import { Pause, Play, Trash2, Clock, User } from "lucide-react"

interface SuspendedPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string | null
  onResume: (sale: { customer_id: string | null; price_list: string; items: any[] }) => void
}

export function SuspendedPanel({ open, onOpenChange, siteId, onResume }: SuspendedPanelProps) {
  const [sales, setSales] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && siteId) {
      setLoading(true)
      getSuspendedSales(siteId).then((data) => {
        setSales(data)
        setLoading(false)
      })
    }
  }, [open, siteId])

  async function handleResume(id: string) {
    const result = await resumeSuspendedSale(id)
    if (result.success && result.sale) {
      toast({ title: "Venta retomada", description: result.message })
      onResume(result.sale)
      onOpenChange(false)
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  async function handleDelete(id: string) {
    const result = await deleteSuspendedSale(id)
    if (result.success) {
      setSales((prev) => prev.filter((s) => s.suspended_sale_id !== id))
      toast({ title: "Eliminada", description: result.message })
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[450px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Pause className="h-5 w-5" />
            Ventas suspendidas
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando...</p>
          ) : sales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No hay ventas suspendidas.</p>
          ) : (
            sales.map((sale) => {
              const items = (sale.items as any[]) || []
              const itemCount = items.reduce((s: number, i: any) => s + (i.quantity || 0), 0)
              const total = items.reduce(
                (s: number, i: any) => s + (i.price || 0) * (i.quantity || 0) * (1 - (i.discount || 0) / 100),
                0,
              )
              return (
                <div
                  key={sale.suspended_sale_id}
                  className="rounded-lg border p-3 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">
                          {(sale.customers as any)?.name || "Sin cliente"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(sale.created_at).toLocaleString("es-CO", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(total)}</p>
                      <p className="text-xs text-muted-foreground">{itemCount} producto(s)</p>
                    </div>
                  </div>

                  {sale.notes && (
                    <p className="text-xs text-muted-foreground italic">{sale.notes}</p>
                  )}

                  <div className="text-xs text-muted-foreground">
                    {items.slice(0, 3).map((item: any, idx: number) => (
                      <span key={idx}>
                        {item.name} x{item.quantity}
                        {idx < Math.min(items.length, 3) - 1 ? ", " : ""}
                      </span>
                    ))}
                    {items.length > 3 && <span> +{items.length - 3} más</span>}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleResume(sale.suspended_sale_id)}
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                      Retomar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(sale.suspended_sale_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
