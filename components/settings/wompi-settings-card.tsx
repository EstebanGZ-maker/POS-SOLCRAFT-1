"use client"

import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { getWompiStatus } from "@/lib/wompi-actions"
import type { BusinessSettings } from "@/lib/business-settings-actions"
import { CreditCard, CheckCircle2, AlertTriangle, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

export function WompiSettingsCard({
  form,
  update,
}: {
  form: BusinessSettings
  update: <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => void
}) {
  const { toast } = useToast()
  const { data: status } = useSWR("wompi-status", getWompiStatus)

  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/wompi/webhook` : "/api/wompi/webhook"

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      toast({ title: "Copiado", description: "URL del webhook copiada." })
    } catch {
      toast({ title: "No se pudo copiar", description: webhookUrl })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Pasarela de pago — Wompi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Habilitar pago en línea</Label>
            <p className="text-xs text-muted-foreground">Tarjeta, PSE y Nequi vía Wompi.</p>
          </div>
          <Switch
            checked={form.wompi_enabled ?? false}
            onCheckedChange={(v) => update("wompi_enabled", v)}
          />
        </div>

        {/* Estado de configuración */}
        {status && (
          <div
            className={`rounded-md border p-3 text-xs ${
              status.configured
                ? "border-green-500/40 bg-green-500/5"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            <div className="flex items-center gap-2 font-medium mb-1">
              {status.configured ? (
                <><CheckCircle2 className="h-4 w-4 text-green-600" /> Credenciales completas</>
              ) : (
                <><AlertTriangle className="h-4 w-4 text-amber-600" /> Faltan credenciales</>
              )}
            </div>
            {!status.configured && (
              <p className="text-muted-foreground">
                Falta configurar: <b>{status.missing.join(", ")}</b>. Los secretos van en{" "}
                <code className="bg-muted px-1 rounded">.env.local</code>, nunca en la base de datos.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <div>
            <Label className="text-sm">Modo de pruebas (sandbox)</Label>
            <p className="text-xs text-muted-foreground">
              Actívalo para probar sin cobrar dinero real.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={form.wompi_sandbox ? "secondary" : "default"}>
              {form.wompi_sandbox ? "Pruebas" : "Producción"}
            </Badge>
            <Switch
              checked={form.wompi_sandbox ?? true}
              onCheckedChange={(v) => update("wompi_sandbox", v)}
            />
          </div>
        </div>

        <div>
          <Label>Llave pública de Wompi</Label>
          <Input
            value={form.wompi_public_key || ""}
            onChange={(e) => update("wompi_public_key", e.target.value)}
            placeholder={form.wompi_sandbox ? "pub_test_..." : "pub_prod_..."}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Esta llave es pública y puede vivir aquí. La llave privada, el secreto de
            integridad y el de eventos van solo en <code className="bg-muted px-1 rounded">.env.local</code>.
          </p>
        </div>

        <div className="border-t pt-3">
          <Label className="text-sm">URL del webhook (eventos)</Label>
          <div className="flex gap-2 mt-1">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={copyWebhook}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Pégala en el panel de Wompi, en “URL de eventos”. Debe ser accesible desde
            internet (no funciona con localhost).
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
