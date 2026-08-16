"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { Search, Plus, MoreVertical, Pencil, Trash2, Star, Package, Wrench, Info } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "@/components/ui/use-toast"
import { formatCurrency } from "@/lib/utils"
import { getProductsWithStock, deleteProductSafe } from "@/lib/inventory-actions"
import { getCategories } from "@/lib/actions"
import { getSitesWithWarehouses } from "@/lib/site-actions"
import { useSite } from "@/lib/site-context"
import { ProductFormDialog } from "@/components/inventory/product-form-dialog"

export default function ProductsPage() {
  const { currentSite } = useSite()
  const [warehouseId, setWarehouseId] = useState<string>("all")
  const [userOverride, setUserOverride] = useState(false)
  const lastSiteRef = useRef<string | undefined>(undefined)
  const [search, setSearch] = useState("")
  const [activeCats, setActiveCats] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [toDelete, setToDelete] = useState<any | null>(null)

  const { data: sites = [] } = useSWR("sites-wh", getSitesWithWarehouses)
  const { data: categories = [] } = useSWR("categories", getCategories)
  const wid = warehouseId === "all" ? null : warehouseId
  const { data: products = [], isLoading, mutate } = useSWR(["products-stock", wid], () =>
    getProductsWithStock(wid),
  )

  const warehouses = useMemo(
    () =>
      sites.flatMap((s: any) =>
        (s.warehouses || []).map((w: any) => ({
          warehouse_id: w.warehouse_id,
          site_id: s.site_id,
          name: w.name,
          site_name: s.name,
          is_primary: !!w.is_primary,
          is_system: !!w.is_system,
        })),
      ),
    [sites],
  )

  // Default por sede activa: primary warehouse de currentSite (excluye Tránsito).
  // Fallback "all" cuando: (a) no hay currentSite (usuario sin sedes),
  // (b) currentSite todavía no resolvió, (c) el primary de esa sede aún no cargó.
  const defaultWarehouseId = useMemo(() => {
    if (!currentSite) return "all"
    const primary = warehouses.find(
      (w: any) => w.site_id === currentSite.site_id && w.is_primary && !w.is_system,
    )
    return primary?.warehouse_id ?? "all"
  }, [currentSite, warehouses])

  // Re-alineación:
  //  - Cambio de currentSite.site_id → SIEMPRE resetear al nuevo default + limpiar
  //    userOverride (cambiar de sede es señal más fuerte que un override previo).
  //  - Misma sede pero cambia defaultWarehouseId (warehouses acaba de cargar en
  //    el mount inicial) → alinear solo si no hay userOverride.
  useEffect(() => {
    const siteId = currentSite?.site_id
    const isNewSite = siteId !== lastSiteRef.current
    if (isNewSite) {
      lastSiteRef.current = siteId
      setUserOverride(false)
      setWarehouseId(defaultWarehouseId)
    } else if (!userOverride) {
      setWarehouseId(defaultWarehouseId)
    }
    // userOverride se omite de deps a propósito: cuando el usuario cambia el
    // Select, ya llamamos setWarehouseId directamente en el handler y no
    // queremos que este effect corra otra vez para sobrescribirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultWarehouseId, currentSite?.site_id])

  const onWarehouseChange = (v: string) => {
    setWarehouseId(v)
    setUserOverride(true)
  }

  const selectedWarehouse = useMemo(
    () => warehouses.find((w: any) => w.warehouse_id === warehouseId),
    [warehouses, warehouseId],
  )

  const filtered = useMemo(() => {
    return products.filter((p: any) => {
      const matchSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.code || "").toLowerCase().includes(search.toLowerCase())
      const matchCat = activeCats.length === 0 || (p.category_id && activeCats.includes(p.category_id))
      return matchSearch && matchCat
    })
  }, [products, search, activeCats])

  const openNew = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (p: any) => {
    setEditing(p)
    setFormOpen(true)
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    const res = await deleteProductSafe(toDelete.product_id)
    if (res.success) toast({ title: "Listo", description: res.message })
    else toast({ title: "Error", description: res.message, variant: "destructive" })
    setToDelete(null)
    mutate()
  }

  const toggleCat = (id: string) =>
    setActiveCats((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))

  return (
    <div>
      <PageHeader
        title="Productos y servicios"
        description="Crea, edita y administra cada detalle de los productos o servicios que vendes."
      >
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Nuevo producto
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:w-64">
          <Select value={warehouseId} onValueChange={onWarehouseChange}>
            <SelectTrigger>
              <SelectValue placeholder="Bodega" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las bodegas</SelectItem>
              {warehouses.map((w) => (
                <SelectItem key={w.warehouse_id} value={w.warehouse_id}>
                  {w.site_name} - {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o referencia"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              Categorías
              {activeCats.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                  {activeCats.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filtrar por categoría</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {categories.map((c: any) => (
              <DropdownMenuCheckboxItem
                key={c.category_id}
                checked={activeCats.includes(c.category_id)}
                onCheckedChange={() => toggleCat(c.category_id)}
                onSelect={(e) => e.preventDefault()}
              >
                {c.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className={
          "mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs " +
          (warehouseId === "all"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "border-border bg-muted/50 text-muted-foreground")
        }
      >
        <Info className="h-3.5 w-3.5 shrink-0" />
        {warehouseId === "all" ? (
          <span>
            Mostrando <strong className="font-semibold">todas las bodegas</strong> — la
            columna Cantidad es la suma agregada de todas las sedes.
          </span>
        ) : (
          <span>
            Mostrando{" "}
            <strong className="font-semibold">
              {selectedWarehouse ? `${selectedWarehouse.site_name} · ${selectedWarehouse.name}` : "una bodega"}
            </strong>
            .
          </span>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">
                {warehouseId === "all" ? (
                  <span className="flex flex-col items-end leading-tight">
                    <span>Cantidad total</span>
                    <span className="text-[10px] font-normal text-muted-foreground">
                      suma de todas las bodegas
                    </span>
                  </span>
                ) : (
                  "Cantidad"
                )}
              </TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Cargando productos...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No hay productos.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p: any) => (
                <TableRow key={p.product_id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2.5">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url || "/placeholder.svg"}
                          alt={p.name}
                          className="h-9 w-9 shrink-0 rounded-md border object-cover"
                        />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted">
                          {p.is_service ? (
                            <Wrench className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground" />
                          )}
                        </span>
                      )}
                      {p.name}
                      {p.is_favorite && <Star className="h-3.5 w-3.5 fill-primary text-primary" />}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.code || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.categories?.name || "-"}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(p.price)}</TableCell>
                  <TableCell className="text-right">
                    {p.is_service ? (
                      <span className="text-muted-foreground">N/A</span>
                    ) : (
                      <span className={(p.warehouseStock ?? p.totalStock) <= 0 ? "text-destructive" : ""}>
                        {p.warehouseStock ?? p.totalStock}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.is_active ? (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        Activo
                      </Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(p)}>
                          <Pencil className="mr-2 h-4 w-4" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(p)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categories}
        warehouses={warehouses}
        onSaved={() => mutate()}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará &quot;{toDelete?.name}&quot;. Si tiene ventas asociadas, se desactivará en su lugar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
