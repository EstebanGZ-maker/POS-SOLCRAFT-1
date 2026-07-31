"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { getSales, getSaleDetails, voidSale } from "@/lib/actions"
import { useAuth } from "@/lib/auth-context"
import { useToast } from "@/hooks/use-toast"
import { Eye, Ban, Receipt, AlertTriangle } from "lucide-react"

export default function SalesPage() {
  const { data: sales = [], mutate } = useSWR("sales", getSales)
  const { role } = useAuth()
  const canVoid = role === "admin" || role === "encargado"

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Historial de ventas"
        description="Consulta todas las transacciones de venta registradas."
        icon={Receipt}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N.°</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No se han registrado ventas.
                  </TableCell>
                </TableRow>
              ) : (
                sales.map((sale: any) => (
                  <SaleRow
                    key={sale.sale_id}
                    sale={sale}
                    canVoid={canVoid}
                    onVoided={() => mutate()}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function SaleRow({
  sale,
  canVoid,
  onVoided,
}: {
  sale: any
  canVoid: boolean
  onVoided: () => void
}) {
  const { toast } = useToast()
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const isVoided = sale.status === "voided"
  const numero = sale.numero
    ? `#${sale.numero}`
    : sale.sale_id.substring(0, 8)

  async function handleViewDetail() {
    setDetailOpen(true)
    if (!detail) {
      setLoadingDetail(true)
      const d = await getSaleDetails(sale.sale_id)
      setDetail(d)
      setLoadingDetail(false)
    }
  }

  async function handleVoid() {
    setVoiding(true)
    const res = await voidSale(sale.sale_id)
    toast({
      title: res.success ? "Venta anulada" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    setVoiding(false)
    setVoidOpen(false)
    if (res.success) onVoided()
  }

  return (
    <TableRow className={isVoided ? "opacity-60" : ""}>
      <TableCell className="font-medium text-primary">{numero}</TableCell>
      <TableCell>{(sale.customers as any)?.name || "Consumidor final"}</TableCell>
      <TableCell>
        {new Date(sale.sale_date).toLocaleDateString("es-CO", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </TableCell>
      <TableCell className="text-right font-mono">
        ${Number(sale.total_amount).toLocaleString("es-CO")}
      </TableCell>
      <TableCell className="text-center">
        {isVoided ? (
          <Badge variant="destructive" className="text-xs">
            <Ban className="h-3 w-3 mr-1" /> Anulada
          </Badge>
        ) : (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
            Activa
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {/* View detail */}
          <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleViewDetail}>
                <Eye className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Detalle de venta {numero}</DialogTitle>
              </DialogHeader>
              {loadingDetail ? (
                <p className="text-muted-foreground py-4">Cargando...</p>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Cliente:</span>
                    <span>{(detail.customers as any)?.name || "Consumidor final"}</span>
                    <span className="text-muted-foreground">Fecha:</span>
                    <span>{new Date(detail.sale_date).toLocaleString("es-CO")}</span>
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-semibold">${Number(detail.total_amount).toLocaleString("es-CO")}</span>
                    <span className="text-muted-foreground">Método de pago:</span>
                    <span className="capitalize">{detail.payment_method || "—"}</span>
                    <span className="text-muted-foreground">Estado:</span>
                    <span>{detail.status === "voided" ? "Anulada" : "Activa"}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-center">Cant.</TableHead>
                        <TableHead className="text-right">P. Unitario</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((detail.sale_items as any[]) ?? []).map((item: any) => (
                        <TableRow key={item.sale_item_id}>
                          <TableCell>{(item.products as any)?.name || "—"}</TableCell>
                          <TableCell className="text-center">{item.quantity}</TableCell>
                          <TableCell className="text-right font-mono">
                            ${Number(item.unit_price).toLocaleString("es-CO")}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${(item.quantity * item.unit_price).toLocaleString("es-CO")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-muted-foreground">Venta no encontrada.</p>
              )}
            </DialogContent>
          </Dialog>

          {/* Void button */}
          {canVoid && !isVoided && (
            <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                  <Ban className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    Anular venta {numero}
                  </DialogTitle>
                  <DialogDescription>
                    Esta acción revertirá el stock de todos los productos y registrará un egreso
                    contable. Esta operación no se puede deshacer.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md bg-muted p-3 text-sm">
                  <p><strong>Total:</strong> ${Number(sale.total_amount).toLocaleString("es-CO")}</p>
                  <p><strong>Cliente:</strong> {(sale.customers as any)?.name || "Consumidor final"}</p>
                  <p><strong>Productos:</strong> {sale.sale_items?.length ?? 0} referencias</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setVoidOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleVoid}
                    disabled={voiding}
                  >
                    {voiding ? "Anulando..." : "Confirmar anulación"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
