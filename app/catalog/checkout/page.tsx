"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import useSWR from "swr"
import { useCart } from "@/lib/cart-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { getPublicCommerceConfig, placeWebOrder } from "@/lib/catalog-actions"
import { createWompiCheckout } from "@/lib/wompi-actions"
import { ArrowLeft, Loader2, CreditCard, MessageCircle, Banknote } from "lucide-react"

type PayMethod = "wompi" | "whatsapp" | "cod"

export default function CheckoutPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { items, subtotal, clear } = useCart()
  const { data: config } = useSWR("commerce-config", getPublicCommerceConfig)

  const shipping = config?.shipping_cost ?? 0
  const free = config?.free_shipping_over ?? null
  const shippingApplied = free && subtotal >= free ? 0 : shipping
  const total = subtotal + shippingApplied

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    customer_id_number: "",
    address: "",
    city: "",
    notes: "",
  })
  const [payMethod, setPayMethod] = useState<PayMethod>("wompi")
  const [placing, setPlacing] = useState(false)

  // Selecciona por defecto el primer método habilitado
  useEffect(() => {
    if (!config) return
    if (config.wompi_enabled) setPayMethod("wompi")
    else if (config.whatsapp_enabled) setPayMethod("whatsapp")
    else if (config.cod_enabled) setPayMethod("cod")
  }, [config])

  if (items.length === 0 && !placing) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground mb-4">Tu carrito está vacío.</p>
        <Button asChild><Link href="/catalog/productos">Ir al catálogo</Link></Button>
      </div>
    )
  }

  const upd = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v })

  const methods: { key: PayMethod; label: string; hint: string; icon: any; enabled: boolean }[] = [
    {
      key: "wompi",
      label: "Tarjeta, PSE o Nequi",
      hint: "Pago seguro en línea con Wompi.",
      icon: CreditCard,
      enabled: Boolean(config?.wompi_enabled),
    },
    {
      key: "whatsapp",
      label: "Enviar pedido por WhatsApp",
      hint: "Abre WhatsApp con tu pedido cargado para confirmar y coordinar el pago.",
      icon: MessageCircle,
      enabled: Boolean(config?.whatsapp_enabled && (config?.whatsapp_number || "").trim()),
    },
    {
      key: "cod",
      label: "Pago contra entrega",
      hint: "Pagas cuando recibas el pedido.",
      icon: Banknote,
      enabled: Boolean(config?.cod_enabled),
    },
  ]
  const availableMethods = methods.filter((m) => m.enabled)

  async function submit() {
    if (!form.customer_name.trim() || !form.customer_phone.trim() || !form.address.trim()) {
      toast({ title: "Datos incompletos", description: "Nombre, teléfono y dirección son obligatorios.", variant: "destructive" })
      return
    }
    if (payMethod === "wompi" && !form.customer_email.trim()) {
      toast({ title: "Falta el correo", description: "Para pagar en línea necesitamos tu correo electrónico.", variant: "destructive" })
      return
    }

    setPlacing(true)
    const res = await placeWebOrder({
      items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      customer_email: form.customer_email || null,
      customer_id_number: form.customer_id_number || null,
      delivery_method: "delivery",
      site_id: null,
      address: form.address,
      city: form.city || null,
      notes: form.notes || null,
      payment_method: payMethod,
    })

    if (!res.success) {
      setPlacing(false)
      toast({ title: "Error", description: res.message, variant: "destructive" })
      return
    }

    // Pago en línea: llevar al checkout de Wompi
    if (payMethod === "wompi") {
      const pay = await createWompiCheckout(res.order_id)
      if (!pay.success || !pay.checkoutUrl) {
        setPlacing(false)
        toast({
          title: "No pudimos abrir el pago",
          description: `${pay.message} Tu pedido ${res.order_number} quedó guardado; puedes pagarlo desde la página del pedido.`,
          variant: "destructive",
        })
        clear()
        router.push(`/catalog/order/${encodeURIComponent(res.order_number)}?phone=${encodeURIComponent(form.customer_phone)}`)
        return
      }
      clear()
      window.location.href = pay.checkoutUrl
      return
    }

    const orderUrlPath = `/catalog/order/${encodeURIComponent(res.order_number)}?phone=${encodeURIComponent(form.customer_phone)}`

    // Pedido por WhatsApp: abrir chat con el mensaje precargado y
    // llevar al comprador a la pantalla de confirmación en paralelo.
    // El pedido ya quedó guardado (placeWebOrder arriba).
    if (payMethod === "whatsapp") {
      const waNumber = (config?.whatsapp_number || "").replace(/\D/g, "")
      if (waNumber) {
        const origin = typeof window !== "undefined" ? window.location.origin : ""
        const lines = [
          "Hola! Acabo de hacer un pedido:",
          "",
          `Pedido: ${res.order_number}`,
          "",
          ...items.map(
            (it) => `• ${it.quantity}× ${it.name} (${it.code}) — ${formatCurrency(it.price * it.quantity)}`,
          ),
          "",
          `Subtotal: ${formatCurrency(subtotal)}`,
          `Envío: ${shippingApplied === 0 ? "Gratis" : formatCurrency(shippingApplied)}`,
          `Total: ${formatCurrency(total)}`,
          "",
          `Datos: ${form.customer_name} — ${form.customer_phone}`,
          `Dirección: ${form.address}${form.city ? `, ${form.city}` : ""}`,
          "",
          `Detalle: ${origin}${orderUrlPath}`,
        ]
        const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(lines.join("\n"))}`
        window.open(waUrl, "_blank", "noopener,noreferrer")
      } else {
        // Guard defensivo: el método no debería aparecer sin número (ver
        // `enabled` en `methods`), pero si llegamos acá el pedido igual
        // quedó persistido — el negocio lo verá en /central/orders.
        toast({
          title: "Pedido guardado",
          description: "No pudimos abrir WhatsApp. El negocio se pondrá en contacto contigo.",
        })
      }
    }

    clear()
    setPlacing(false)
    router.push(orderUrlPath)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Finalizar compra</h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/catalog/cart"><ArrowLeft className="h-4 w-4 mr-1" /> Volver al carrito</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          <Card className="border-gold-soft surface-gold">
            <CardHeader><CardTitle className="text-base font-display">Datos de contacto</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Nombre completo *</Label>
                <Input value={form.customer_name} onChange={(e) => upd("customer_name", e.target.value)} placeholder="María Pérez" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Teléfono *</Label>
                  <Input value={form.customer_phone} onChange={(e) => upd("customer_phone", e.target.value)} placeholder="+57 300 000 0000" />
                </div>
                <div>
                  <Label>Correo {payMethod === "wompi" ? "*" : "(opcional)"}</Label>
                  <Input type="email" value={form.customer_email} onChange={(e) => upd("customer_email", e.target.value)} placeholder="maria@correo.com" />
                </div>
              </div>
              <div>
                <Label>Cédula (opcional)</Label>
                <Input value={form.customer_id_number} onChange={(e) => upd("customer_id_number", e.target.value)} placeholder="1234567890" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gold-soft surface-gold">
            <CardHeader><CardTitle className="text-base font-display">Dirección de envío</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Dirección *</Label>
                <Input value={form.address} onChange={(e) => upd("address", e.target.value)} placeholder="Calle 10 # 20-30 apto 101" />
              </div>
              <div>
                <Label>Ciudad</Label>
                <Input value={form.city} onChange={(e) => upd("city", e.target.value)} placeholder="El Carmen de Viboral" />
              </div>
              <div>
                <Label>Notas de entrega (opcional)</Label>
                <Textarea value={form.notes} onChange={(e) => upd("notes", e.target.value)} rows={3} placeholder="Portería, barrio, hora de entrega, etc." />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gold-soft surface-gold">
            <CardHeader><CardTitle className="text-base font-display">Método de pago</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {availableMethods.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay métodos de pago habilitados. Contacta a la tienda.
                </p>
              )}
              {availableMethods.map((m) => {
                const active = payMethod === m.key
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setPayMethod(m.key)}
                    className={`w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? "border-[hsl(var(--gold-mid))] bg-[hsl(var(--gold-mid)/0.08)] ring-1 ring-[hsl(var(--gold-mid)/0.45)]"
                        : "border-gold-soft hover:border-gold-strong"
                    }`}
                  >
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      active ? "border-[hsl(var(--gold-mid))]" : "border-muted-foreground/40"
                    }`}>
                      {active && <span className="h-2 w-2 rounded-full bg-[hsl(var(--gold-mid))]" />}
                    </span>
                    <m.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{m.label}</span>
                      <span className="block text-xs text-muted-foreground">{m.hint}</span>
                    </span>
                  </button>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-24 border-gold-soft surface-gold">
            <CardContent className="p-5 space-y-3">
              <h2 className="font-display text-lg">Tu pedido</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {items.map((it) => (
                  <div key={it.product_id} className="flex justify-between text-sm">
                    <div className="min-w-0">
                      <div className="font-medium line-clamp-1">{it.name}</div>
                      <div className="text-xs text-muted-foreground">{it.quantity} × {formatCurrency(it.price)}</div>
                    </div>
                    <div className="font-medium ml-2 whitespace-nowrap">{formatCurrency(it.price * it.quantity)}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-gold-soft pt-3 space-y-1">
                <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                <div className="flex justify-between text-sm">
                  <span>Envío</span>
                  <span>{shippingApplied === 0 ? <span className="text-emerald-400 font-medium">Gratis</span> : formatCurrency(shippingApplied)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t border-gold-soft">
                  <span>Total</span>
                  <span className="font-mono text-gold-gradient">{formatCurrency(total)}</span>
                </div>
              </div>
              <Button
                className="w-full glow-gold-sm"
                size="lg"
                onClick={submit}
                disabled={placing || availableMethods.length === 0}
              >
                {placing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Procesando...</>
                ) : payMethod === "wompi" ? (
                  <><CreditCard className="h-4 w-4 mr-2" /> Pagar {formatCurrency(total)}</>
                ) : (
                  "Confirmar pedido"
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center leading-tight">
                {payMethod === "wompi"
                  ? "Serás redirigido a Wompi para completar el pago de forma segura."
                  : payMethod === "cod"
                  ? "Pagarás al recibir el pedido."
                  : "Se abrirá WhatsApp con tu pedido cargado para confirmar y coordinar el pago."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
