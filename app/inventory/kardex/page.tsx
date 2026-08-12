"use client"

import { useState, useCallback } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import {
  getStockMovements,
  getProductsForFilter,
  getWarehousesForFilter,
  verifyKardexIntegrity,
} from "@/lib/kardex-actions"
import { useAuth } from "@/lib/auth-context"
import { useSite } from "@/lib/site-context"
import { ScrollText, Search, ShieldCheck, ArrowDown, ArrowUp, RefreshCw } from "lucide-react"

const TYPE_LABELS: Record<string, string> = {
  apertura: "Apertura",
  compra: "Compra (histórico)",
  venta: "Venta",
  traslado_salida: "Traslado (salida)",
  traslado_entrada: "Traslado (entrada)",
  transito_entrada: "Tránsito (entrada)",
  transito_salida: "Tránsito (salida)",
  ajuste: "Ajuste",
  devolucion: "Devolución",
}

const TYPE_COLORS: Record<string, string> = {
  apertura: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  compra: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  venta: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  traslado_salida: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  traslado_entrada: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  transito_entrada: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  transito_salida: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  ajuste: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  devolucion: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
}

export default function KardexPage() {
  const { toast } = useToast()
  const { role, assignedSiteId } = useAuth()
  const { currentSite, sites } = useSite()
  const isGlobal = role === "admin" || role === "contador"
  const [siteFilter, setSiteFilter] = useState("current")
  const [productId, setProductId] = useState("all")
  const [warehouseId, setWarehouseId] = useState("all")
  const [movementType, setMovementType] = useState("all")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [verifying, setVerifying] = useState(false)

  // El selector de sede ya solo lista sedes accesibles, así que currentSite
  // es siempre una sede válida para el usuario (incluso con varias asignadas).
  const effectiveSiteId = isGlobal
    ? siteFilter === "all" ? undefined : siteFilter === "current" ? currentSite?.site_id : siteFilter
    : currentSite?.site_id ?? assignedSiteId

  const filters = {
    product_id: productId !== "all" ? productId : undefined,
    warehouse_id: warehouseId !== "all" ? warehouseId : undefined,
    movement_type: movementType !== "all" ? movementType : undefined,
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
    site_id: effectiveSiteId ?? undefined,
  }

  const fetchKey = JSON.stringify(["kardex", filters])
  const fetcher = useCallback(() => getStockMovements(filters), [fetchKey])
  const { data: movements = [], isLoading, mutate } = useSWR(fetchKey, fetcher)
  const { data: products = [] } = useSWR("kardex-products", getProductsForFilter)
  const whKey = JSON.stringify(["kardex-warehouses", effectiveSiteId])
  const { data: warehouses = [] } = useSWR(whKey, () => getWarehousesForFilter(effectiveSiteId))

  async function handleVerify() {
    setVerifying(true)
    const res = await verifyKardexIntegrity()
    toast({
      title: res.success && res.discrepancies.length === 0 ? "Kardex íntegro" : "Resultado",
      description: res.message,
      variant: res.discrepancies.length > 0 ? "destructive" : "default",
    })
    setVerifying(false)
  }

  const totalIn = movements
    .filter((m: any) => m.quantity > 0)
    .reduce((s: number, m: any) => s + m.quantity, 0)
  const totalOut = movements
    .filter((m: any) => m.quantity < 0)
    .reduce((s: number, m: any) => s + m.quantity, 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Kardex de inventario"
        description="Historial de todos los movimientos de stock por producto y bodega."
        icon={ScrollText}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Movimientos</div>
            <div className="text-2xl font-bold">{movements.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-2">
            <ArrowUp className="h-5 w-5 text-green-500" />
            <div>
              <div className="text-sm text-muted-foreground">Entradas</div>
              <div className="text-2xl font-bold text-green-600">+{totalIn}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-2">
            <ArrowDown className="h-5 w-5 text-red-500" />
            <div>
              <div className="text-sm text-muted-foreground">Salidas</div>
              <div className="text-2xl font-bold text-red-600">{totalOut}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Search className="h-4 w-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            {isGlobal && (
              <Select value={siteFilter} onValueChange={(v) => { setSiteFilter(v); setWarehouseId("all") }}>
                <SelectTrigger>
                  <SelectValue placeholder="Sede" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Sede actual</SelectItem>
                  <SelectItem value="all">Todas las sedes</SelectItem>
                  {sites.map((s: any) => (
                    <SelectItem key={s.site_id} value={s.site_id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Producto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los productos</SelectItem>
                {products.map((p: any) => (
                  <SelectItem key={p.product_id} value={p.product_id}>
                    {p.code ? `${p.code} — ${p.name}` : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Bodega" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las bodegas</SelectItem>
                {warehouses.map((w: any) => (
                  <SelectItem key={w.warehouse_id} value={w.warehouse_id}>
                    {w.name} ({(w as any).sites?.name || "—"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={movementType} onValueChange={setMovementType}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="Desde" />
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="Hasta" />
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={() => mutate()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Buscar
            </Button>
            <Button size="sm" variant="outline" onClick={handleVerify} disabled={verifying}>
              <ShieldCheck className="h-4 w-4 mr-1" /> {verifying ? "Verificando..." : "Verificar integridad"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Bodega</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead>Notas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m: any) => (
                <TableRow key={m.movement_id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(m.created_at).toLocaleString("es-CO", {
                      day: "2-digit", month: "2-digit", year: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{m.products?.name || "—"}</div>
                    {m.products?.code && (
                      <div className="text-xs text-muted-foreground">{m.products.code}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{m.warehouses?.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{(m.warehouses as any)?.sites?.name || ""}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={TYPE_COLORS[m.movement_type] || ""}>
                      {TYPE_LABELS[m.movement_type] || m.movement_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    <span className={m.quantity > 0 ? "text-green-600" : "text-red-600"}>
                      {m.quantity > 0 ? "+" : ""}{m.quantity}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.reference_type || "—"}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">
                    {m.notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && movements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    No hay movimientos con los filtros seleccionados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
