"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { createWompiCheckout } from "@/lib/wompi-actions"
import { CreditCard, Loader2 } from "lucide-react"

export function PayNowButton({
  orderId,
  amountLabel,
}: {
  orderId: string
  amountLabel: string
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handlePay() {
    setLoading(true)
    const res = await createWompiCheckout(orderId)
    if (!res.success || !res.checkoutUrl) {
      setLoading(false)
      toast({ title: "No pudimos abrir el pago", description: res.message, variant: "destructive" })
      return
    }
    window.location.href = res.checkoutUrl
  }

  return (
    <Button size="lg" className="gap-2" onClick={handlePay} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
      Pagar {amountLabel} en línea
    </Button>
  )
}
