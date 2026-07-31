"use client"

import { useState } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import {
  getWebOrders, getWebOrderDetail, updateWebOrderStatus, fulfillWebOrder,
  type WebOrderRow, type WebOrderStatus,
} from "@/lib/web-orders-actions"
import { getSitesForSelect } from "@/lib/user-actions"
import {
  ShoppingBag, Truck, MapPin, Phone, Mail, PackageCheck, Loader2, ExternalLink,
} from "lucide-react"

const STATUS_LABELS: Record<WebOrderStatus, string> = {
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  preparing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
}

const STATUS_COLORS: Record<WebOrderStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  paid: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  preparing: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  shipped: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  delivered: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
}

// Transiciones permitidas desde cada estado
const NEXT_STATUS: Record<WebOrderStatus, WebOrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
}

const FILTERS: { key: WebOrderStatus | "all"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "pending_payment", label: "Pendientes de pago" },
  { key: "paid", label: "Pagados" },
  { key: "preparing", label: "En preparación" },
  { key: "shipped", label: "Enviados" },
  { key: "delivered", label: "Entregados" },
  { key: "cancelled", label: "Cancelados" },
]

export default function WebOrdersPage() {
  const { toast } = useToast()
  const [filter, setFilter] = useState<WebOrderStatus | "all">("all")
  const { data: orders = [], mutate, isLoading } = useSWR(
    ["web-orders", filter],
    () => getWebOrders(filter),
  )
  const { data: sites = [] } = useSWR("sites-select", getSitesForSelect)

  const [detailId, setDetailId] = useState<string | null>(null)
  const { data: detail, mutate: mutateDetail } = useSWR(
    detailId ? ["web-order-detail", detailId] : null,
    () => getWebOrderDetail(detailId!),
  )

  const [fulfillSiteId, setFulfillSiteId] = useState<string>("")
  const [working, setWorking] = useState(false)

  async function changeStatus(orderId: string, status: WebOrderStatus) {
    setWorking(true)
    const res = await updateWebOrderStatus(orderId, status)
    toast({
      title: res.success ? "Actualizado" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      mutate()
      mutateDetail()
    }
    setWorking(false)
  }

  async function doFulfill(orderId: string) {
    if (!fulfillSiteId) {
      toast({ title: "Elige una sede", description: "Selecciona de qué sede se despacha.", variant: "destructive" })
      return
    }
    setWorking(true)
    const res = await fulfillWebOrder(orderId, fulfillSiteId)
    toast({
      title: res.success ? "Despachado" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      mutate()
      setDetailId(null)
      setFulfillSiteId("")
    }
    setWorking(false)
  }

  const storeSites = sites.filter((s: any) => !s.is_central)
  const counts = FILTERS.reduce((acc, f) => {
    acc[f.key] = f.key === "all" ? orders.length : orders.filter((o) => o.status === f.key).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Pedidos web"
        description="Pedidos hechos por clientes desde el catálogo público."
        icon={ShoppingBag}
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {filter === f.key && counts[f.key] > 0 && (
              <span className="ml-1.5 opacity-70">({counts[f.key]})</span>
            )}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell></TableRow>
              )}
              {!isLoading && orders.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No hay pedidos {filter !== "all" ? "en este estado" : "todavía"}.
                </TableCell></TableRow>
              )}
              {orders.map((o: WebOrderRow) => (
                <TableRow key={o.order_id}>
                  <TableCell className="font-mono text-xs font-medium">{o.order_number}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{o.guest_name}</div>
                    <div className="text-xs text-muted-foreground">{o.guest_phone}</div>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-xs">
                      {o.delivery_method === "pickup"
                        ? <><MapPin className="h-3 w-3" /> Recoge{o.sites?.name ? ` · ${o.sites.name}` : ""}</>
                        : <><Truck className="h-3 w-3" /> Domicilio</>}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(Number(o.total))}
                    {o.payment_status === "approved" && (
                      <span className="block text-[10px] text-green-600 font-normal">✓ Pagado en línea</span>
                    )}
                    {o.payment_status === "declined" && (
                      <span className="block text-[10px] text-red-600 font-normal">Pago rechazado</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString("es-CO", {
                      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => { setDetailId(o.order_id); setFulfillSiteId("") }}>
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detalle */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{detail?.order.order_number}</DialogTitle>
            <DialogDescription>
              {detail && new Date(detail.order.created_at).toLocaleString("es-CO")}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              <Badge className={STATUS_COLORS[detail.order.status]}>
                {STATUS_LABELS[detail.order.status]}
              </Badge>

              {/* Cliente */}
              <div className="text-sm space-y-1">
                <div className="font-semibold">{detail.order.guest_name}</div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" /> {detail.order.guest_phone}
                  <a
                    href={`https://wa.me/${detail.order.guest_phone.replace(/\D/g, "")}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-green-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    WhatsApp <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {detail.order.guest_email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" /> {detail.order.guest_email}
                  </div>
                )}
              </div>

              <Separator />

              {/* Entrega */}
              <div className="text-sm space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  {detail.order.delivery_method === "pickup"
                    ? <><MapPin className="h-4 w-4" /> Recoge en tienda</>
                    : <><Truck className="h-4 w-4" /> Envío a domicilio</>}
                </div>
                {detail.order.delivery_method === "delivery" ? (
                  <>
                    <div className="text-muted-foreground">{detail.order.shipping_address}</div>
                    {detail.order.shipping_city && (
                      <div className="text-muted-foreground">{detail.order.shipping_city}</div>
                    )}
                  </>
                ) : (
                  <div className="text-muted-foreground">{detail.order.sites?.name || "Sede sin definir"}</div>
                )}
                {detail.order.notes && (
                  <div className="text-xs bg-muted/50 rounded p-2 mt-2">
                    <b>Notas:</b> {detail.order.notes}
                  </div>
                )}
              </div>

              <Separator />

              {/* Items */}
              <div className="space-y-2">
                {detail.items.map((it: any) => (
                  <div key={it.order_item_id} className="flex justify-between text-sm">
                    <div>
                      <div className="font-medium">{it.product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.product_code} · {it.quantity} × {formatCurrency(Number(it.unit_price))}
                      </div>
                    </div>
                    <div className="font-medium whitespace-nowrap">
                      {formatCurrency(Number(it.unit_price) * it.quantity)}
                    </div>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span><span>{formatCurrency(Number(detail.order.subtotal))}</span>
                </div>
                {Number(detail.order.tax_total) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>IVA</span><span>{formatCurrency(Number(detail.order.tax_total))}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Envío</span><span>{formatCurrency(Number(detail.order.shipping_cost))}</span>
                </div>
                <div className="flex justify-between font-bold text-base pt-1 border-t">
                  <span>Total</span><span>{formatCurrency(Number(detail.order.total))}</span>
                </div>
              </div>

              {/* Despachar: convierte en venta y descuenta stock */}
              {!detail.order.sale_id && ["paid", "preparing"].includes(detail.order.status) && (
                <>
                  <Separator />
                  <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      <PackageCheck className="h-4 w-4" /> Despachar pedido
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Crea la venta y descuenta el stock de la sede que elijas.
                    </p>
                    <Label className="text-xs">Sede que despacha</Label>
                    <Select value={fulfillSiteId} onValueChange={setFulfillSiteId}>
                      <SelectTrigger><SelectValue placeholder="Elegir sede..." /></SelectTrigger>
                      <SelectContent>
                        {storeSites.map((s: any) => (
                          <SelectItem key={s.site_id} value={s.site_id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      className="w-full"
                      onClick={() => doFulfill(detail.order.order_id)}
                      disabled={working || !fulfillSiteId}
                    >
                      {working ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Convertir en venta y descontar stock
                    </Button>
                  </div>
                </>
              )}

              {detail.order.sale_id && (
                <div className="text-xs text-green-700 dark:text-green-400 bg-green-500/10 rounded p-2">
                  ✓ Ya convertido en venta. El stock fue descontado
                  {detail.order.sites?.name ? ` de ${detail.order.sites.name}` : ""}.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {detail && NEXT_STATUS[detail.order.status].map((s) => (
              <Button
                key={s}
                variant={s === "cancelled" ? "destructive" : "default"}
                size="sm"
                disabled={working}
                onClick={() => changeStatus(detail.order.order_id, s)}
              >
                Marcar como {STATUS_LABELS[s].toLowerCase()}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDetailId(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
