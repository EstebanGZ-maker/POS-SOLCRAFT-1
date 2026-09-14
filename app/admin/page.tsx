"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useSite } from "@/lib/site-context"
import { formatCurrency } from "@/lib/utils"
import { getSiteInventorySummary } from "@/lib/inventory-actions"
import { getConsolidatedReport } from "@/lib/accounting-actions"
import { setCurrentSite, saveSite } from "@/lib/site-actions"
import { Store, Warehouse, ShoppingCart, Boxes, Calculator, ArrowRight, Building2, Plus, AlertTriangle } from "lucide-react"

export default function AdminPage() {
  const { toast } = useToast()
  const { refresh } = useSite()
  const { data: inv = [], mutate: mutateInv } = useSWR("site-inv-summary", getSiteInventorySummary)
  const { data: report = [], mutate: mutateReport } = useSWR("consolidated", getConsolidatedReport)

  // Estado del formulario "Nueva sede". Dialog inline: no vale la pena
  // extraer un componente reutilizable hasta que aparezca un segundo consumer.
  const [openNew, setOpenNew] = useState(false)
  const [savingSite, setSavingSite] = useState(false)
  const [siteName, setSiteName] = useState("")
  const [siteCode, setSiteCode] = useState("")
  const [siteAddress, setSiteAddress] = useState("")
  const [siteIsCentral, setSiteIsCentral] = useState(false)

  const existingCentral = (inv as any[]).find((s) => s.is_central)
  const centralConflict = siteIsCentral && !!existingCentral

  const openNewDialog = () => {
    setSiteName("")
    setSiteCode("")
    setSiteAddress("")
    setSiteIsCentral(false)
    setOpenNew(true)
  }

  const submitNewSite = async () => {
    if (!siteName.trim() || !siteCode.trim()) {
      toast({ title: "Completa nombre y código", variant: "destructive" })
      return
    }
    if (centralConflict) return  // botón disabled cubre este caso, guard defensivo
    setSavingSite(true)
    const res = await saveSite({
      name: siteName,
      code: siteCode,
      address: siteAddress || null,
      is_central: siteIsCentral,
    })
    setSavingSite(false)
    if (res.success) {
      toast({ title: "Sede creada", description: `${siteName.trim()} lista para operar.` })
      setOpenNew(false)
      mutateInv()
      mutateReport()
    } else {
      toast({ title: "Error", description: res.message, variant: "destructive" })
    }
  }

  const totalIncome = report.reduce((s: number, r: any) => s + r.income, 0)
  const totalExpense = report.reduce((s: number, r: any) => s + r.expense, 0)
  const totalUnits = inv.reduce((s: number, r: any) => s + r.units, 0)

  async function enterSite(site_id: string, name: string) {
    await setCurrentSite(site_id)
    await refresh()
    toast({ title: "Sede activa", description: `Ahora trabajas en ${name}.` })
  }

  const sites = [...inv].sort((a: any, b: any) => Number(b.is_central) - Number(a.is_central))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Administrador principal"
        description="Supervisa todas las sedes y accede al inventario y POS de cada una."
        icon={Building2}
      >
        <Button className="gap-2" onClick={openNewDialog}>
          <Plus className="h-4 w-4" /> Nueva sede
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Ingresos totales</div>
            <div className="text-2xl font-bold text-primary mt-1">{formatCurrency(totalIncome)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Egresos totales</div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(totalExpense)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Unidades en inventario</div>
            <div className="text-2xl font-bold mt-1">{totalUnits.toLocaleString("es-CO")}</div>
          </CardContent>
        </Card>
      </div>

      {/* Site cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sites.map((s: any) => {
          const rep = report.find((r: any) => r.site_id === s.site_id)
          return (
            <Card key={s.site_id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {s.is_central ? (
                      <Warehouse className="h-4 w-4 text-primary" />
                    ) : (
                      <Store className="h-4 w-4 text-primary" />
                    )}
                    {s.name}
                  </CardTitle>
                  {s.is_central && <Badge>Central</Badge>}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Unidades</div>
                    <div className="font-semibold">{s.units.toLocaleString("es-CO")}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Referencias</div>
                    <div className="font-semibold">{s.skus}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Ingresos</div>
                    <div className="font-semibold text-primary">{formatCurrency(rep?.income || 0)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Balance</div>
                    <div className="font-semibold">{formatCurrency(rep?.balance || 0)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-auto pt-2">
                  <Button asChild size="sm" variant="outline" onClick={() => enterSite(s.site_id, s.name)}>
                    <Link href="/inventory/products">
                      <Boxes className="h-4 w-4 mr-1" />
                      Inventario
                    </Link>
                  </Button>
                  {!s.is_central && (
                    <>
                      <Button asChild size="sm" variant="outline" onClick={() => enterSite(s.site_id, s.name)}>
                        <Link href="/pos">
                          <ShoppingCart className="h-4 w-4 mr-1" />
                          POS
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" onClick={() => enterSite(s.site_id, s.name)}>
                        <Link href="/accounting">
                          <Calculator className="h-4 w-4 mr-1" />
                          Contabilidad
                        </Link>
                      </Button>
                    </>
                  )}
                  {s.is_central && (
                    <Button asChild size="sm" onClick={() => enterSite(s.site_id, s.name)}>
                      <Link href="/central">
                        <ArrowRight className="h-4 w-4 mr-1" />
                        Distribuir
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Nueva sede — Dialog inline. Al guardar, saveSite crea la sede + la
          bodega "Principal" asociada + el contador de ventas. NO crea bodega
          de Tránsito (es única y global, ya existe desde el aprovisionamiento
          inicial). is_public de la bodega queda en false por default — activar
          manualmente después si la sede va a vender online. */}
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva sede</DialogTitle>
            <DialogDescription>
              Se creará la sede junto con su bodega "Principal" asociada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="site-name">Nombre</Label>
              <Input
                id="site-name"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="Sede Centro"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="site-code">Código</Label>
              <Input
                id="site-code"
                value={siteCode}
                onChange={(e) => setSiteCode(e.target.value.toUpperCase())}
                placeholder="CENTRO"
                maxLength={12}
              />
              <p className="text-xs text-muted-foreground">
                Identificador corto en mayúsculas (3-8 caracteres).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="site-address">Dirección (opcional)</Label>
              <Input
                id="site-address"
                value={siteAddress}
                onChange={(e) => setSiteAddress(e.target.value)}
                placeholder="Calle 10 # 20-30"
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="site-central"
                checked={siteIsCentral}
                onCheckedChange={(v) => setSiteIsCentral(v === true)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="site-central" className="cursor-pointer">
                  Es sede central
                </Label>
                <p className="text-xs text-muted-foreground">
                  Marca esta casilla solo si la sede recibe la mercancía inicial
                  que se distribuye al resto. Solo puede haber una sede central.
                </p>
              </div>
            </div>

            {centralConflict && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div>
                  Ya existe una sede central:{" "}
                  <span className="font-medium">{existingCentral?.name}</span>.
                  No se puede crear otra hasta desmarcarla.
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenNew(false)} disabled={savingSite}>
              Cancelar
            </Button>
            <Button
              onClick={submitNewSite}
              disabled={savingSite || !siteName.trim() || !siteCode.trim() || centralConflict}
            >
              {savingSite ? "Creando..." : "Crear sede"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
