"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  getBusinessSettings, updateBusinessSettings, type BusinessSettings,
} from "@/lib/business-settings-actions"
import { WompiSettingsCard } from "@/components/settings/wompi-settings-card"
import { Settings, Save, AlignLeft, AlignCenter, AlignRight } from "lucide-react"

// Preview minimalista (una versión reducida del recibo real)
function ReceiptPreview({ s }: { s: BusinessSettings }) {
  const align = s.header_alignment === "left" ? "text-left" : s.header_alignment === "right" ? "text-right" : "text-center"
  return (
    <div
      className="mx-auto bg-white text-black text-[11px] font-mono p-3 rounded shadow-sm border"
      style={{ width: `${s.paper_width_mm * 3.5}px` }}
    >
      <div className={align}>
        {s.show_logo && s.logo_url && (
          <img src={s.logo_url} alt="logo" className="mx-auto max-h-12 mb-1" />
        )}
        <div className="font-bold text-sm">{s.business_name}</div>
        {s.phone && <div><b>Teléfono:</b> {s.phone}</div>}
        {s.email && <div>{s.email}</div>}
        {s.regime && <div><b>Régimen:</b> {s.regime}</div>}
      </div>
      <div className="border-t border-dashed my-2" />
      <div className="text-center font-bold">Factura de venta de papel</div>
      <div className="text-center">N° 832065</div>
      <div className="flex justify-between"><span>Fecha:</span><b>28/07/2026 1:06 pm</b></div>
      <div className="flex justify-between"><span>Forma de pago:</span><b>Crédito</b></div>
      <div className="flex justify-between"><span>Vendedor:</span><b>Fran Du-Plessis</b></div>
      <div className="border-t border-dashed my-2" />
      <div className="font-bold">Shanti Ma</div>
      <div><b>Teléfono:</b> +57 324 857 8574</div>
      {s.show_customer_id && <div>CC 1785261979358</div>}
      <div className="border-t border-dashed my-2" />
      <div className="space-y-1">
        {[
          { n: 1, name: "Awesome Rubber Salad", code: "147415", qty: 4, price: 1914, tax: "A" },
          { n: 2, name: "Practical Wooden Bacon", code: "100147", qty: 7, price: 1681, tax: "C", disc: 4 },
          { n: 3, name: "Rustic Frozen Pizza", code: "147415", qty: 4, price: 403, tax: "B" },
        ].map((it) => (
          <div key={it.n}>
            <div className="grid grid-cols-[14px_1fr_24px_54px] gap-1">
              <span>{it.n}</span>
              <span>{it.name} <span className="border border-black px-1 text-[9px]">{it.tax}</span></span>
              <span className="text-right">{it.qty}</span>
              <span className="text-right">{(it.qty * it.price).toLocaleString("es-CO")}</span>
            </div>
            <div className="text-[10px] text-gray-500">{it.code}</div>
            {s.show_description && <div className="text-[10px] text-gray-500">Descripción del producto</div>}
            {s.show_unit_price && !s.group_product_data && (
              <div className="text-[10px] text-gray-500">P.U.: {it.price.toLocaleString("es-CO")}</div>
            )}
            {"disc" in it && it.disc && (
              <div className="flex justify-between text-gray-500"><span>Descuento {it.disc}%</span><span>-438</span></div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-dashed my-2" />
      <div className="flex justify-between"><span>Subtotal:</span><b>19.287</b></div>
      <div className="flex justify-between"><span>Descuento:</span><b>-438</b></div>
      <div className="flex justify-between"><span>Subtotal:</span><b>18.849</b></div>
      <div className="flex justify-between"><span>Total IVA (5.00%):</span><b>342</b></div>
      <div className="flex justify-between"><span>Total IVA (7.00%):</span><b>584</b></div>
      <div className="flex justify-between"><span>Total IVA (12.00%):</span><b>1.261</b></div>
      <div className="flex justify-between font-bold border-t border-black pt-1 mt-1">
        <span>Total:</span><span>21.035</span>
      </div>
      {s.show_tax_summary && (
        <>
          <div className="border-t border-dashed my-2" />
          <div className="text-center font-bold">Resumen de impuestos</div>
          <table className="w-full text-[10px] mt-1">
            <thead>
              <tr className="border-b border-black text-left">
                <th>Tarifa</th><th className="text-right">Base</th><th className="text-right">Impuesto</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>IVA 5%</td><td className="text-right">6.835</td><td className="text-right">342</td></tr>
              <tr><td>IVA 7%</td><td className="text-right">8.343</td><td className="text-right">584</td></tr>
              <tr><td>IVA 12%</td><td className="text-right">10.506</td><td className="text-right">1.261</td></tr>
              <tr className="font-bold border-t border-black"><td></td><td className="text-right">25.684</td><td className="text-right">2.187</td></tr>
            </tbody>
          </table>
        </>
      )}
      {s.show_lines_summary && (
        <>
          <div className="border-t border-dashed my-2" />
          <div><b>Total recibido:</b> 21.035</div>
          <div><b>Total de líneas:</b> 3</div>
          <div><b>Total de productos:</b> 15</div>
        </>
      )}
      <div className="border-t border-dashed my-2" />
      {s.legal_footer && <div className="text-center text-[10px] text-gray-600">{s.legal_footer}</div>}
      {s.custom_phrase && <div className="text-center text-[10px] mt-1">{s.custom_phrase}</div>}
    </div>
  )
}

export default function ReceiptSettingsPage() {
  const { toast } = useToast()
  const { data, mutate } = useSWR("business-settings", getBusinessSettings)
  const [form, setForm] = useState<BusinessSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data && !form) setForm(data)
  }, [data, form])

  if (!form) {
    return <div className="p-6">Cargando…</div>
  }

  const update = <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => {
    setForm({ ...form, [k]: v })
  }

  async function handleSave() {
    if (!form) return
    setSaving(true)
    const res = await updateBusinessSettings(form)
    toast({
      title: res.success ? "Guardado" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) mutate()
    setSaving(false)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Configuración de facturas"
          description="Personaliza los datos que salen en la tirilla y elige qué información mostrar."
          icon={Settings}
        />
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Columna izquierda: configuración */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Datos del negocio</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Nombre comercial *</Label>
                  <Input value={form.business_name} onChange={(e) => update("business_name", e.target.value)} />
                </div>
                <div>
                  <Label>Razón social</Label>
                  <Input value={form.legal_name || ""} onChange={(e) => update("legal_name", e.target.value)} />
                </div>
                <div>
                  <Label>NIT / Tax ID</Label>
                  <Input value={form.tax_id || ""} onChange={(e) => update("tax_id", e.target.value)} />
                </div>
                <div>
                  <Label>Régimen</Label>
                  <Input value={form.regime || ""} onChange={(e) => update("regime", e.target.value)} placeholder="Responsable de IVA" />
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <Input value={form.phone || ""} onChange={(e) => update("phone", e.target.value)} placeholder="+57 300 000 0000" />
                </div>
                <div>
                  <Label>Correo</Label>
                  <Input type="email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Dirección</Label>
                <Input value={form.address || ""} onChange={(e) => update("address", e.target.value)} />
              </div>
              <div>
                <Label>URL del logo</Label>
                <Input value={form.logo_url || ""} onChange={(e) => update("logo_url", e.target.value)} placeholder="https://..." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Tirilla</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Tipo de tirilla</Label>
                  <Select value={form.template_style} onValueChange={(v) => update("template_style", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clasico">Clásico</SelectItem>
                      <SelectItem value="moderno">Moderno</SelectItem>
                      <SelectItem value="minimal">Minimalista</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tamaño</Label>
                  <Select value={String(form.paper_width_mm)} onValueChange={(v) => update("paper_width_mm", Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="57">57 mm</SelectItem>
                      <SelectItem value="58">58 mm</SelectItem>
                      <SelectItem value="80">80 mm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Márgen izquierdo (mm)</Label>
                  <Input type="number" min={0} max={20} value={form.margin_left_mm} onChange={(e) => update("margin_left_mm", Number(e.target.value))} />
                </div>
                <div>
                  <Label>Márgen derecho (mm)</Label>
                  <Input type="number" min={0} max={20} value={form.margin_right_mm} onChange={(e) => update("margin_right_mm", Number(e.target.value))} />
                </div>
              </div>

              <div>
                <Label>Alineación del encabezado</Label>
                <div className="flex gap-2 mt-2">
                  {([
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                  ] as const).map(([val, Icon]) => (
                    <Button
                      key={val}
                      type="button"
                      variant={form.header_alignment === val ? "default" : "outline"}
                      size="icon"
                      onClick={() => update("header_alignment", val)}
                    >
                      <Icon className="h-4 w-4" />
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contenido a mostrar</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                ["show_logo", "Mostrar logo en el encabezado"],
                ["show_description", "Incluir descripción de los productos"],
                ["show_unit_price", "Mostrar precio unitario"],
                ["show_unit_of_measure", "Incluir la unidad de medida"],
                ["group_product_data", "Agrupar nombre, cantidad y precio en una columna"],
                ["show_customer_id", "Mostrar identificación del cliente"],
                ["show_tax_summary", "Incluir resumen de impuestos"],
                ["show_lines_summary", "Mostrar total de líneas y productos"],
              ].map(([key, label]) => (
                <div key={key as string} className="flex items-center justify-between border-b py-2 last:border-b-0">
                  <Label className="text-sm">{label as string}</Label>
                  <Switch
                    checked={form[key as keyof BusinessSettings] as boolean}
                    onCheckedChange={(v) => update(key as any, v as any)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Tienda web (catálogo público)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Número de WhatsApp para pedidos</Label>
                <Input
                  value={form.whatsapp_number || ""}
                  onChange={(e) => update("whatsapp_number", e.target.value)}
                  placeholder="+57 300 000 0000"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Los clientes te escribirán aquí para coordinar el pago. Si lo dejas vacío se usa el teléfono del negocio.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Costo de envío</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.shipping_cost ?? 0}
                    onChange={(e) => update("shipping_cost", Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label>Envío gratis desde</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.free_shipping_over ?? ""}
                    onChange={(e) => update("free_shipping_over", e.target.value === "" ? null : Number(e.target.value))}
                    placeholder="Sin umbral"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Déjalo vacío para cobrar siempre el envío.</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <Label className="text-sm">Pago contra entrega</Label>
                  <p className="text-xs text-muted-foreground">Permitir que el cliente pague al recibir.</p>
                </div>
                <Switch
                  checked={form.cod_enabled ?? true}
                  onCheckedChange={(v) => update("cod_enabled", v)}
                />
              </div>
            </CardContent>
          </Card>

          <WompiSettingsCard form={form} update={update} />

          <Card>
            <CardHeader><CardTitle className="text-base">Personalización</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Frase personalizada</Label>
                <Textarea
                  value={form.custom_phrase || ""}
                  onChange={(e) => update("custom_phrase", e.target.value)}
                  placeholder="Ej: Gracias por tu compra. Cambios hasta 8 días con factura."
                  rows={3}
                  maxLength={200}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {(form.custom_phrase || "").length} / 200 caracteres
                </p>
              </div>
              <div>
                <Label>Texto legal</Label>
                <Textarea
                  value={form.legal_footer || ""}
                  onChange={(e) => update("legal_footer", e.target.value)}
                  rows={3}
                  placeholder="Este documento se asimila a una letra de cambio…"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Columna derecha: vista previa sticky */}
        <div>
          <div className="lg:sticky lg:top-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Vista previa de la tirilla</CardTitle></CardHeader>
              <CardContent className="bg-gray-100 dark:bg-gray-900/40 p-4 rounded-b-lg">
                <ReceiptPreview s={form} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
