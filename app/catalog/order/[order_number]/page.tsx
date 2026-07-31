import Link from "next/link"
import { notFound } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { lookupWebOrder, getPublicCommerceConfig } from "@/lib/catalog-actions"
import { PayNowButton } from "@/components/catalog/pay-now-button"
import { formatCurrency } from "@/lib/utils"
import { CheckCircle2, MessageCircle, Package, Truck, MapPin, CreditCard } from "lucide-react"

interface Props {
  params: Promise<{ order_number: string }>
  searchParams: Promise<{ phone?: string }>
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pendiente de pago",
  paid: "Pago confirmado",
  preparing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  paid: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  preparing: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  shipped: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  delivered: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
}

export default async function OrderConfirmationPage({ params, searchParams }: Props) {
  const { order_number } = await params
  const { phone } = await searchParams

  if (!phone) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center space-y-4">
        <h1 className="text-xl font-bold">Consultar pedido</h1>
        <p className="text-muted-foreground text-sm">
          Para ver el estado de tu pedido necesitamos el teléfono con el que lo hiciste.
        </p>
        <form action={`/catalog/order/${encodeURIComponent(order_number)}`} className="flex gap-2">
          <input
            name="phone"
            placeholder="Tu teléfono"
            className="flex-1 h-10 rounded-md border bg-background px-3 text-sm"
            required
          />
          <Button type="submit">Consultar</Button>
        </form>
      </div>
    )
  }

  const decoded = decodeURIComponent(order_number)
  const [order, config] = await Promise.all([
    lookupWebOrder(decoded, phone),
    getPublicCommerceConfig(),
  ])

  if (!order) notFound()

  const items = (order.items || []) as any[]
  const waNumber = (config.whatsapp_number || config.phone || "").replace(/\D/g, "")
  const waText = encodeURIComponent(
    `Hola, acabo de hacer el pedido ${order.order_number} por ${formatCurrency(Number(order.total))}. ` +
    `Quiero coordinar el pago. Mi nombre es ${order.customer_name}.`
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Confirmación */}
      <div className="text-center space-y-3">
        <CheckCircle2 className="h-16 w-16 mx-auto text-emerald-400" />
        <h1 className="font-display text-3xl text-gold-gradient">¡Pedido recibido!</h1>
        <p className="text-muted-foreground">
          Tu número de pedido es{" "}
          <span className="font-mono font-bold text-[hsl(var(--gold-mid))]">{order.order_number}</span>
        </p>
        <Badge className={STATUS_COLORS[order.status] || ""}>
          {STATUS_LABELS[order.status] || order.status}
        </Badge>
      </div>

      {/* Pago en línea pendiente */}
      {order.status === "pending_payment" && order.payment_status !== "approved" && config.wompi_enabled && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-5 text-center space-y-3">
            <CreditCard className="h-8 w-8 mx-auto text-primary" />
            <h2 className="font-bold">Paga tu pedido en línea</h2>
            <p className="text-sm text-muted-foreground">
              Tarjeta, PSE o Nequi. Tu pedido se confirma al instante.
            </p>
            <PayNowButton
              orderId={order.order_id}
              amountLabel={formatCurrency(Number(order.total))}
            />
          </CardContent>
        </Card>
      )}

      {order.payment_status === "approved" && (
        <Card className="border-green-500/40 bg-green-500/5">
          <CardContent className="p-4 text-center text-sm text-green-700 dark:text-green-400">
            ✓ Pago confirmado{order.paid_at ? ` el ${new Date(order.paid_at).toLocaleString("es-CO")}` : ""}.
          </CardContent>
        </Card>
      )}

      {/* Coordinar pago */}
      {order.status === "pending_payment" && order.payment_status !== "approved" && waNumber && (
        <Card className="border-green-500/40 bg-green-500/5">
          <CardContent className="p-5 text-center space-y-3">
            <MessageCircle className="h-8 w-8 mx-auto text-green-600" />
            <h2 className="font-bold">Último paso: coordina tu pago</h2>
            <p className="text-sm text-muted-foreground">
              Escríbenos por WhatsApp para confirmar el pago y coordinar la entrega.
            </p>
            <Button asChild size="lg" className="bg-green-600 hover:bg-green-700 gap-2">
              <a href={`https://wa.me/${waNumber}?text=${waText}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" />
                Escribir por WhatsApp
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Detalle */}
      <Card className="border-gold-soft surface-gold">
        <CardHeader><CardTitle className="text-base font-display flex items-center gap-2">
          <Package className="h-4 w-4" /> Detalle del pedido
        </CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="flex justify-between text-sm border-b pb-2 last:border-0">
              <div>
                <div className="font-medium">{it.name}</div>
                <div className="text-xs text-muted-foreground">
                  {it.code} · {it.quantity} × {formatCurrency(Number(it.unit_price))}
                </div>
              </div>
              <div className="font-medium whitespace-nowrap">
                {formatCurrency(Number(it.unit_price) * it.quantity)}
              </div>
            </div>
          ))}
          <div className="pt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span><span>{formatCurrency(Number(order.subtotal))}</span>
            </div>
            {Number(order.tax_total) > 0 && (
              <div className="flex justify-between text-sm">
                <span>IVA</span><span>{formatCurrency(Number(order.tax_total))}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span>Envío</span>
              <span>
                {Number(order.shipping_cost) === 0
                  ? <span className="text-green-600 font-medium">Gratis</span>
                  : formatCurrency(Number(order.shipping_cost))}
              </span>
            </div>
            <div className="flex justify-between font-bold text-lg pt-2 border-t border-gold-soft">
              <span>Total</span>
              <span className="font-mono text-gold-gradient">{formatCurrency(Number(order.total))}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entrega */}
      <Card className="border-gold-soft surface-gold">
        <CardHeader><CardTitle className="text-base font-display flex items-center gap-2">
          {order.delivery_method === "pickup"
            ? <><MapPin className="h-4 w-4" /> Recoger en tienda</>
            : <><Truck className="h-4 w-4" /> Envío a domicilio</>}
        </CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div><span className="text-muted-foreground">A nombre de:</span> {order.customer_name}</div>
          {order.delivery_method === "pickup" ? (
            <div><span className="text-muted-foreground">Sede:</span> {order.fulfillment_site || "—"}</div>
          ) : (
            <>
              <div><span className="text-muted-foreground">Dirección:</span> {order.address}</div>
              {order.city && <div><span className="text-muted-foreground">Ciudad:</span> {order.city}</div>}
            </>
          )}
        </CardContent>
      </Card>

      <div className="text-center space-y-2">
        <p className="text-xs text-muted-foreground">
          Guarda tu número de pedido <b>{order.order_number}</b> para consultar el estado más adelante.
        </p>
        <Button asChild variant="outline">
          <Link href="/catalog">Seguir comprando</Link>
        </Button>
      </div>
    </div>
  )
}
