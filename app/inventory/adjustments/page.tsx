"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import useSWR from "swr"
import Link from "next/link"
import { Filter, Plus, Trash2, X, ChevronLeft, ChevronRight, Search, Loader2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { MoneyInput } from "@/components/ui/money-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { useAuth } from "@/lib/auth-context"
import {
  getAdjustmentsPaginated,
  getAdjustmentIdsForFilter,
  voidAdjustmentsBulk,
  getProductsWithStock,
  type AdjustmentsFilter,
  type AdjustmentsEstado,
  type AdjustmentsMotivo,
  type AdjustmentsTipo,
} from "@/lib/inventory-actions"
import { getSitesWithWarehouses } from "@/lib/site-actions"
import { AdjustmentDialog } from "@/components/inventory/adjustment-dialog"
import { DeactivateAfterVoidDialog } from "@/components/inventory/deactivate-after-void-dialog"

const PAGE_SIZE = 50
const BULK_SELECT_MAX = 200

export default function AdjustmentsPage() {
  const { role } = useAuth()
  const canVoid = role === "admin" || role === "encargado"
  const searchParams = useSearchParams()
  const initialSearch = searchParams?.get("search") ?? ""

  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)

  // Filtros (controlados). `applied` es la copia que efectivamente se
  // manda al servidor y resetea la página a 1.
  const [search, setSearch] = useState(initialSearch)
  const [motivo, setMotivo] = useState<AdjustmentsMotivo | "all">("all")
  const [tipo, setTipo] = useState<AdjustmentsTipo | "all">("all")
  const [estado, setEstado] = useState<AdjustmentsEstado>("active")
  const [warehouseId, setWarehouseId] = useState<string>("all")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  const [totalMin, setTotalMin] = useState<number>(0)
  const [totalMax, setTotalMax] = useState<number>(0)
  const [numero, setNumero] = useState<string>("")

  const buildFilter = (): AdjustmentsFilter => ({
    page,
    pageSize: PAGE_SIZE,
    search: search.trim() || undefined,
    motivo: motivo === "all" ? null : motivo,
    tipo: tipo === "all" ? null : tipo,
    estado,
    warehouseId: warehouseId === "all" ? null : warehouseId,
    dateFrom: dateFrom || null,
    // Si el filtro Hasta viene sin hora, incluimos todo el día.
    dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : null,
    totalMin: totalMin > 0 ? totalMin : null,
    totalMax: totalMax > 0 ? totalMax : null,
    numero: numero.trim() ? Number(numero) : null,
  })

  const filterKey = useMemo(
    () => JSON.stringify(buildFilter()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, search, motivo, tipo, estado, warehouseId, dateFrom, dateTo, totalMin, totalMax, numero],
  )

  const { data, isLoading, mutate } = useSWR(
    ["adjustments-paginated", filterKey],
    () => getAdjustmentsPaginated(buildFilter()),
  )
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const { data: sites = [] } = useSWR("sites-wh", getSitesWithWarehouses)
  const { data: products = [] } = useSWR(["products-all"], () => getProductsWithStock(null))
  const warehouses = useMemo(
    () =>
      (sites as any[]).flatMap((s: any) =>
        (s.warehouses || []).map((w: any) => ({
          warehouse_id: w.warehouse_id,
          name: w.name,
          site_name: s.name,
        })),
      ),
    [sites],
  )

  // ---- Selección masiva --------------------------------------------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const activeIdsOnPage = useMemo(
    () => rows.filter((r: any) => r.status === "active").map((r: any) => r.adjustment_id as string),
    [rows],
  )
  const allPageSelected =
    activeIdsOnPage.length > 0 && activeIdsOnPage.every((id: string) => selectedIds.has(id))
  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const id of activeIdsOnPage) next.delete(id)
      } else {
        for (const id of activeIdsOnPage) next.add(id)
      }
      return next
    })
  }
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectAllForFilter = async () => {
    const { ids, capped, total: tot } = await getAdjustmentIdsForFilter(
      { ...buildFilter(), estado: "active" },
      BULK_SELECT_MAX,
    )
    setSelectedIds(new Set(ids))
    if (capped) {
      toast({
        title: `Seleccionados los primeros ${ids.length} de ${tot}`,
        description:
          `El selector masivo limita a ${BULK_SELECT_MAX} para evitar bloquear la UI. Refina los filtros para abarcar el resto.`,
      })
    } else {
      toast({
        title: `${ids.length} ajuste(s) activos seleccionados`,
      })
    }
  }

  const selectedCount = selectedIds.size
  const selectedTotal = useMemo(() => {
    // Suma solo lo que vemos en esta página; para montos exactos usamos
    // esto como aproximación visual. Si hay selección fuera de página,
    // el valor es "mínimo visible" — se avisa en el diálogo.
    let s = 0
    for (const r of rows as any[]) {
      if (selectedIds.has(r.adjustment_id)) s += Number(r.total_adjusted || 0)
    }
    return s
  }, [rows, selectedIds])
  const selectedOutsidePage = Math.max(
    0,
    selectedCount - (rows as any[]).filter((r: any) => selectedIds.has(r.adjustment_id)).length,
  )

  // ---- Anulación masiva --------------------------------------------
  const [bulkVoidOpen, setBulkVoidOpen] = useState(false)
  const [bulkVoidRunning, setBulkVoidRunning] = useState(false)
  const [toDelete, setToDelete] = useState<any | null>(null)
  // Tras anular, ofrecer "¿Desactivar también estos productos?" solo a admin
  // (setProductsActive exige admin; para encargado no se abre).
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [voidedIds, setVoidedIds] = useState<string[]>([])
  const isAdmin = role === "admin"

  const offerDeactivate = (ids: string[]) => {
    if (!isAdmin || ids.length === 0) return
    setVoidedIds(ids)
    setDeactivateOpen(true)
  }

  const runBulkVoid = async () => {
    setBulkVoidRunning(true)
    const ids = [...selectedIds]
    const res = await voidAdjustmentsBulk(ids)
    setBulkVoidRunning(false)
    setBulkVoidOpen(false)
    setSelectedIds(new Set())
    mutate()
    const okIds = res.results.filter((r: any) => r.ok).map((r: any) => r.adjustment_id as string)
    if (res.failCount === 0) {
      toast({ title: `${res.okCount} ajuste(s) anulado(s)` })
      offerDeactivate(okIds)
      return
    }
    const failures = res.results
      .filter((r: any) => !r.ok)
      .slice(0, 5)
      .map((r: any) => `#${r.numero ?? r.adjustment_id.slice(0, 8)}: ${r.message}`)
      .join("\n")
    const more = res.results.filter((r: any) => !r.ok).length - 5
    toast({
      title: `${res.okCount} anulado(s), ${res.failCount} con error`,
      description:
        failures + (more > 0 ? `\n…y ${more} más (revisa cada ajuste para el detalle).` : ""),
      variant: "destructive",
    })
    offerDeactivate(okIds)
  }

  const confirmSingleDelete = async () => {
    if (!toDelete) return
    const id = toDelete.adjustment_id as string
    const res = await voidAdjustmentsBulk([id])
    if (res.okCount === 1) {
      toast({ title: "Ajuste anulado" })
      setToDelete(null)
      mutate()
      offerDeactivate([id])
      return
    }
    const err = res.results[0]
    toast({ title: "Error", description: err?.message || "No se pudo anular.", variant: "destructive" })
    setToDelete(null)
    mutate()
  }

  const clearFilters = () => {
    setSearch("")
    setMotivo("all")
    setTipo("all")
    setEstado("active")
    setWarehouseId("all")
    setDateFrom("")
    setDateTo("")
    setTotalMin(0)
    setTotalMax(0)
    setNumero("")
    setPage(1)
  }

  // Reset de página al cambiar cualquier filtro (menos la propia `page`).
  const resetPageOnFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        title="Ajustes de inventario"
        description="Registra entradas o salidas de mercancía para mantener tu inventario al día."
      >
        <Button className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Nuevo ajuste
        </Button>
      </PageHeader>

      {/* Filtros */}
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Código o nombre de producto, u observaciones"
                value={search}
                onChange={(e) => resetPageOnFilter(setSearch)(e.target.value)}
              />
            </div>
          </div>
          <div className="min-w-[9rem]">
            <Label className="text-xs">Motivo</Label>
            <Select value={motivo} onValueChange={(v) => resetPageOnFilter(setMotivo)(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="compra">Compra</SelectItem>
                <SelectItem value="sobrante">Sobrante</SelectItem>
                <SelectItem value="correccion">Corrección</SelectItem>
                <SelectItem value="merma">Merma</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[10rem]">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => resetPageOnFilter(setTipo)(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ia">Ingreso IA</SelectItem>
                <SelectItem value="entrada">Entrada de mercancía</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[8rem]">
            <Label className="text-xs">Estado</Label>
            <Select value={estado} onValueChange={(v) => resetPageOnFilter(setEstado)(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="voided">Anulados</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[14rem]">
            <Label className="text-xs">Bodega</Label>
            <Select value={warehouseId} onValueChange={(v) => resetPageOnFilter(setWarehouseId)(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {warehouses.map((w: any) => (
                  <SelectItem key={w.warehouse_id} value={w.warehouse_id}>
                    {w.site_name} - {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[8rem]">
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={dateFrom} onChange={(e) => resetPageOnFilter(setDateFrom)(e.target.value)} />
          </div>
          <div className="min-w-[8rem]">
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={dateTo} onChange={(e) => resetPageOnFilter(setDateTo)(e.target.value)} />
          </div>
          <div className="min-w-[9rem]">
            <Label className="text-xs">Total mínimo</Label>
            <MoneyInput value={totalMin} onChange={(n) => resetPageOnFilter(setTotalMin)(n ?? 0)} />
          </div>
          <div className="min-w-[9rem]">
            <Label className="text-xs">Total máximo</Label>
            <MoneyInput value={totalMax} onChange={(n) => resetPageOnFilter(setTotalMax)(n ?? 0)} />
          </div>
          <div className="min-w-[7rem]">
            <Label className="text-xs">N° ajuste</Label>
            <Input
              type="number"
              value={numero}
              onChange={(e) => resetPageOnFilter(setNumero)(e.target.value)}
              placeholder="Ej: 125"
            />
          </div>
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3.5 w-3.5" /> Limpiar
          </Button>
        </div>
      </Card>

      {/* Barra de selección masiva */}
      {canVoid && selectedCount > 0 && (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-2 border-primary/40 bg-primary/5 p-3 text-sm">
          <div>
            <strong>{selectedCount}</strong> ajuste(s) seleccionado(s) · suma visible{" "}
            <strong>{formatCurrency(selectedTotal)}</strong>
            {selectedOutsidePage > 0 && (
              <span className="text-muted-foreground">
                {" "}
                ({selectedOutsidePage} fuera de esta página)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
              Limpiar selección
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setBulkVoidOpen(true)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Anular seleccionados
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {canVoid && (
                  <Checkbox
                    aria-label="Seleccionar esta página"
                    checked={allPageSelected}
                    onCheckedChange={togglePage}
                    disabled={activeIdsOnPage.length === 0}
                  />
                )}
              </TableHead>
              <TableHead className="w-16">N°</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Bodega</TableHead>
              <TableHead>Observaciones</TableHead>
              <TableHead className="text-center">Ítems</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Total ajustado</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  {total === 0 ? "No hay ajustes con estos filtros." : "Sin resultados en esta página."}
                </TableCell>
              </TableRow>
            ) : (
              (rows as any[]).map((a: any) => {
                const isVoided = a.status === "voided"
                const isChecked = selectedIds.has(a.adjustment_id)
                return (
                  <TableRow key={a.adjustment_id} className={isVoided ? "opacity-60" : ""}>
                    <TableCell>
                      {canVoid && (
                        <Checkbox
                          aria-label="Seleccionar ajuste"
                          checked={isChecked}
                          disabled={isVoided}
                          onCheckedChange={() => toggleOne(a.adjustment_id)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.numero != null ? `#${a.numero}` : "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/inventory/adjustments/${a.adjustment_id}`}
                        className="text-primary hover:underline"
                      >
                        {new Date(a.adjustment_date).toLocaleString("es-CO")}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {a.warehouses?.sites?.name} - {a.warehouses?.name}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{a.notes || "-"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{a.adjustment_items?.length ?? 0}</Badge>
                    </TableCell>
                    <TableCell>
                      {isVoided ? (
                        <Badge variant="outline">Anulado</Badge>
                      ) : (
                        <Badge variant="secondary">Activo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(a.total_adjusted)}</TableCell>
                    <TableCell>
                      {canVoid && !isVoided && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setToDelete(a)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        {/* Paginador */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
          <div className="text-muted-foreground">
            {total > 0 ? (
              <>
                Página <strong>{page}</strong> de <strong>{totalPages}</strong> ·{" "}
                <strong>{total}</strong> resultado{total === 1 ? "" : "s"}
              </>
            ) : (
              <>Sin resultados</>
            )}
          </div>
          <div className="flex gap-2">
            {canVoid && total > activeIdsOnPage.length && estado === "active" && (
              <Button variant="outline" size="sm" onClick={selectAllForFilter}>
                <Filter className="mr-1.5 h-3.5 w-3.5" />
                Seleccionar todos los resultados del filtro
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Siguiente <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      <AdjustmentDialog
        open={open}
        onOpenChange={setOpen}
        warehouses={warehouses}
        products={products}
        onSaved={() => mutate()}
      />

      {/* Confirmación masiva */}
      <AlertDialog open={bulkVoidOpen} onOpenChange={setBulkVoidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular {selectedCount} ajuste(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Se revertirá el stock de cada ajuste seleccionado. Suma visible en esta página:{" "}
              <strong>{formatCurrency(selectedTotal)}</strong>
              {selectedOutsidePage > 0 && (
                <> ({selectedOutsidePage} seleccionados fuera de esta página — su total no se muestra acá)</>
              )}
              . Cada anulación corre en su propia transacción; si alguna falla (p. ej. porque el stock ya
              se movió), seguirá con las demás y verás el detalle al terminar. Los ajustes anulados no se
              borran — quedan registrados como anulados para trazabilidad.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkVoidRunning}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runBulkVoid} disabled={bulkVoidRunning}>
              {bulkVoidRunning ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Anulando...
                </>
              ) : (
                `Anular ${selectedCount}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación individual */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular ajuste?</AlertDialogTitle>
            <AlertDialogDescription>
              Se revertirá el efecto de este ajuste sobre el stock de la bodega. El
              ajuste queda registrado como anulado (no se borra) para trazabilidad.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSingleDelete}>Anular</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeactivateAfterVoidDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        adjustmentIds={voidedIds}
        onDone={mutate}
      />
    </div>
  )
}
