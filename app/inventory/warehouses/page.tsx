"use client"

import { useState } from "react"
import useSWR from "swr"
import { Plus, Warehouse as WarehouseIcon, Store, Trash2, Star } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { getSitesWithWarehouses, saveWarehouse, deleteWarehouse } from "@/lib/site-actions"

export default function WarehousesPage() {
  const { data: sites = [], isLoading, mutate } = useSWR("sites-wh", getSitesWithWarehouses)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [siteId, setSiteId] = useState("")
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setName("")
    setSiteId(sites[0]?.site_id ?? "")
    setOpen(true)
  }

  const submit = async () => {
    if (!name.trim() || !siteId) return toast({ title: "Completa los datos", variant: "destructive" })
    setSaving(true)
    const res = await saveWarehouse({ site_id: siteId, name })
    setSaving(false)
    if (res.success) {
      toast({ title: "Bodega creada" })
      setOpen(false)
      mutate()
    } else toast({ title: "Error", description: res.message, variant: "destructive" })
  }

  const remove = async (id: string) => {
    const res = await deleteWarehouse(id)
    if (res.success) toast({ title: "Listo", description: res.message })
    else toast({ title: "Error", description: res.message, variant: "destructive" })
    mutate()
  }

  return (
    <div>
      <PageHeader
        title="Bodegas"
        description="Administra las bodegas de cada sede donde se almacena tu inventario."
      >
        <Button className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" /> Nueva bodega
        </Button>
      </PageHeader>

      {isLoading ? (
        <p className="text-muted-foreground">Cargando...</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s: any) => (
            <Card key={s.site_id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {s.is_central ? (
                    <WarehouseIcon className="h-5 w-5 text-primary" />
                  ) : (
                    <Store className="h-5 w-5 text-muted-foreground" />
                  )}
                  {s.name}
                  {s.is_central && <Badge className="ml-auto">Central</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(s.warehouses || []).map((w: any) => (
                  <div
                    key={w.warehouse_id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      {w.is_primary && <Star className="h-3.5 w-3.5 fill-primary text-primary" />}
                      {w.name}
                    </span>
                    {!w.is_primary && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(w.warehouse_id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
                {(s.warehouses || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Sin bodegas.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva bodega</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Sede</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s: any) => (
                    <SelectItem key={s.site_id} value={s.site_id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre de la bodega</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Vitrina, Almacén 2" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
