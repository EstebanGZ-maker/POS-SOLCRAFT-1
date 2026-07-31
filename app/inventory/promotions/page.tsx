"use client"

import { useState } from "react"
import useSWR from "swr"
import { Plus, Trash2, Pencil, Percent } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { getPromotions, savePromotion, deletePromotion } from "@/lib/inventory-actions"
import { getSites } from "@/lib/site-actions"

const empty = {
  promotion_id: null as string | null,
  name: "",
  description: "",
  discount_percent: "0",
  start_date: "",
  end_date: "",
  is_active: true,
  site_id: "all",
}

export default function PromotionsPage() {
  const { data: promos = [], isLoading, mutate } = useSWR("promotions", getPromotions)
  const { data: sites = [] } = useSWR("sites", getSites)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setForm(empty)
    setOpen(true)
  }
  const openEdit = (p: any) => {
    setForm({
      promotion_id: p.promotion_id,
      name: p.name,
      description: p.description ?? "",
      discount_percent: String(p.discount_percent),
      start_date: p.start_date ? p.start_date.slice(0, 10) : "",
      end_date: p.end_date ? p.end_date.slice(0, 10) : "",
      is_active: p.is_active,
      site_id: p.site_id ?? "all",
    })
    setOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) return toast({ title: "Falta el nombre", variant: "destructive" })
    setSaving(true)
    const res = await savePromotion({
      promotion_id: form.promotion_id,
      name: form.name,
      description: form.description,
      discount_percent: Number(form.discount_percent) || 0,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      is_active: form.is_active,
      site_id: form.site_id === "all" ? null : form.site_id,
    })
    setSaving(false)
    if (res.success) {
      toast({ title: "Promoción guardada" })
      setOpen(false)
      mutate()
    } else toast({ title: "Error", description: res.message, variant: "destructive" })
  }

  const remove = async (id: string) => {
    const res = await deletePromotion(id)
    if (res.success) toast({ title: "Listo", description: res.message })
    mutate()
  }

  return (
    <div>
      <PageHeader
        title="Promociones"
        description="Crea descuentos por temporada, aplicables a todas las sedes o a una en particular."
      >
        <Button className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" /> Nueva promoción
        </Button>
      </PageHeader>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="text-right">Descuento</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Sede</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : promos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Sin promociones.
                </TableCell>
              </TableRow>
            ) : (
              promos.map((p: any) => (
                <TableRow key={p.promotion_id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Percent className="h-4 w-4 text-primary" />
                      {p.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium">{p.discount_percent}%</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.start_date ? new Date(p.start_date).toLocaleDateString("es-CO") : "—"} {" a "}
                    {p.end_date ? new Date(p.end_date).toLocaleDateString("es-CO") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.sites?.name ?? "Todas"}</TableCell>
                  <TableCell>
                    {p.is_active ? (
                      <Badge className="bg-primary/10 text-primary" variant="secondary">
                        Activa
                      </Badge>
                    ) : (
                      <Badge variant="outline">Inactiva</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => remove(p.promotion_id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.promotion_id ? "Editar promoción" : "Nueva promoción"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Descuento (%)</Label>
                <Input
                  type="number"
                  value={form.discount_percent}
                  onChange={(e) => setForm({ ...form, discount_percent: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sede</Label>
                <Select value={form.site_id} onValueChange={(v) => setForm({ ...form, site_id: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sedes</SelectItem>
                    {sites.map((s: any) => (
                      <SelectItem key={s.site_id} value={s.site_id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Desde</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hasta</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm">Activa</span>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
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
