"use client"

import { useState } from "react"
import useSWR from "swr"
import { Plus, Trash2, Pencil, FolderTree } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { toast } from "@/components/ui/use-toast"
import { getCategories } from "@/lib/actions"
import { saveCategory, deleteCategory } from "@/lib/inventory-actions"

export default function ManagementPage() {
  const { data: categories = [], isLoading, mutate } = useSWR("categories", getCategories)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [editId, setEditId] = useState<string | null>(null)

  const openNew = () => {
    setName("")
    setEditId(null)
    setOpen(true)
  }
  const openEdit = (c: any) => {
    setName(c.name)
    setEditId(c.category_id)
    setOpen(true)
  }

  const submit = async () => {
    if (!name.trim()) return
    const res = await saveCategory(name, editId)
    if (res.success) {
      toast({ title: "Categoría guardada" })
      setOpen(false)
      mutate()
    } else toast({ title: "Error", description: res.message, variant: "destructive" })
  }

  const remove = async (id: string) => {
    const res = await deleteCategory(id)
    if (res.success) toast({ title: "Listo", description: res.message })
    else toast({ title: "Error", description: res.message, variant: "destructive" })
    mutate()
  }

  return (
    <div>
      <PageHeader
        title="Gestión de inventario"
        description="Configura las categorías con las que organizas tus productos y servicios."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderTree className="h-5 w-5 text-primary" /> Categorías
            </CardTitle>
            <CardDescription>Agrupa tus productos para filtrarlos fácilmente en el POS.</CardDescription>
          </div>
          <Button className="gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" /> Nueva categoría
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-muted-foreground">Cargando...</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin categorías.</p>
          ) : (
            categories.map((c: any) => (
              <div key={c.category_id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm font-medium">{c.name}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => remove(c.category_id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Editar categoría" : "Nueva categoría"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Camisas" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
