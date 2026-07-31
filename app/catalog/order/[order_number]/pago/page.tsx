import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { verifyAndApplyTransaction } from "@/lib/wompi-actions"
import { getPublicCommerceConfig } from "@/lib/catalog-actions"
import { CheckCircle2, XCircle, Clock, AlertTriangle, MessageCircle } from "lucide-react"

interface Props {
  params: Promise<{ order_number: string }>
  searchParams: Promise<{ id?: string; env?: string }>
}

export default async function PaymentReturnPage({ params, searchParams }: Props) {
  const { order_number } = await params
  const { id } = await searchParams
  const orderNumber = decodeURIComponent(order_number)

  const config = await getPublicCommerceConfig()
  const waNumber = (config.whatsapp_number || config.phone || "").replace(/\D/g, "")

  // Wompi devuelve el id de la transacción en el redirect
  let result: Awaited<ReturnType<typeof verifyAndApplyTransaction>> | null = null
  if (id) {
    result = await verifyAndApplyTransaction(id)
  }

  const status = result?.success ? result.status : null
  const approved = status === "APPROVED"
  const declined = status === "DECLINED" || status === "ERROR" || status === "VOIDED"
  const pending = status === "PENDING"

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <Card className="border-gold-soft surface-gold">
        <CardContent className="p-8 text-center space-y-4">
          {!id && (
            <>
              <AlertTriangle className="h-14 w-14 mx-auto text-amber-500" />
              <h1 className="font-display text-2xl">No recibimos la transacción</h1>
              <p className="text-sm text-muted-foreground">
                Si ya pagaste, tu pedido se actualizará automáticamente en unos minutos.
              </p>
            </>
          )}

          {id && !result?.success && (
            <>
              <AlertTriangle className="h-14 w-14 mx-auto text-amber-500" />
              <h1 className="font-display text-2xl">No pudimos confirmar el pago</h1>
              <p className="text-sm text-muted-foreground">{result?.message}</p>
              <p className="text-xs text-muted-foreground">
                Si el cobro se realizó, lo confirmaremos automáticamente al recibir la
                notificación de Wompi.
              </p>
            </>
          )}

          {approved && (
            <>
              <CheckCircle2 className="h-14 w-14 mx-auto text-green-600" />
              <h1 className="font-display text-2xl">¡Pago aprobado!</h1>
              <p className="text-sm text-muted-foreground">
                Tu pedido <b className="font-mono">{orderNumber}</b> quedó confirmado.
                Ya estamos preparándolo.
              </p>
            </>
          )}

          {pending && (
            <>
              <Clock className="h-14 w-14 mx-auto text-blue-500" />
              <h1 className="font-display text-2xl">Pago en proceso</h1>
              <p className="text-sm text-muted-foreground">
                Tu pago está siendo procesado. Te confirmaremos apenas el banco responda.
              </p>
            </>
          )}

          {declined && (
            <>
              <XCircle className="h-14 w-14 mx-auto text-red-600" />
              <h1 className="font-display text-2xl">El pago no se completó</h1>
              <p className="text-sm text-muted-foreground">
                Tu pedido <b className="font-mono">{orderNumber}</b> sigue reservado.
                Puedes intentar de nuevo o coordinar el pago por WhatsApp.
              </p>
              {waNumber && (
                <Button asChild className="bg-green-600 hover:bg-green-700 gap-2">
                  <a
                    href={`https://wa.me/${waNumber}?text=${encodeURIComponent(
                      `Hola, tuve un problema pagando el pedido ${orderNumber}.`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Escribir por WhatsApp
                  </a>
                </Button>
              )}
            </>
          )}

          <div className="pt-2 flex flex-col gap-2">
            <Button asChild variant="outline">
              <Link href={`/catalog/order/${encodeURIComponent(orderNumber)}`}>
                Ver mi pedido
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/catalog">Volver a la tienda</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
