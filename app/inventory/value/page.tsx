"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Search } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { formatCurrency } from "@/lib/utils"
import { getInventoryValue } from "@/lib/inventory-actions"
import { getSitesWithWarehouses } from "@/lib/site-actions"

export default function InventoryValuePage() {
  const [warehouseId, setWarehouseId] = useState<string>("all")
  const [search, setSearch] = useState("")

  const { data: sites = [] } = useSWR("sites-wh", getSitesWithWarehouses)
  const wid = warehouseId === "all" ? null : warehouseId
  const { data, isLoading } = useSWR(["inv-value", wid], () => getInventoryValue(wid))

  const warehouses = useMemo(
    () =>
      sites.flatMap((s: any) =>
        (s.warehouses || []).map((w: any) => ({ warehouse_id: w.warehouse_id, name: w.name, site_name: s.name })),
      ),
    [sites],
  )

  const rows = data?.rows ?? []
  const filtered = rows.filter(
    (r: any) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.code || "").toLowerCase().includes(search.toLowerCase()),
  )
  const total = filtered.reduce((s: number, r: any) => s + r.total, 0)

  return (
    <div>
      <PageHeader
        title="Valor de inventario"
        description="Consulta el valor actual, cantidad y costo promedio de tu inventario."
      >
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="w-56">
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
      </PageHeader>

      <Card className="mb-4">
        <CardContent className="flex flex-col items-center py-6">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-3xl font-bold text-foreground">{formatCurrency(total)}</span>
        </CardContent>
      </Card>

      <div className="mb-4 relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar ítem o referencia"
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ítem</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Costo promedio</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r: any) => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.code || "-"}</TableCell>
                  <TableCell className="text-right">{r.quantity}</TableCell>
                  <TableCell className="text-muted-foreground">{r.unit}</TableCell>
                  <TableCell>
                    {r.is_active ? (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        Activo
                      </Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(r.cost)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(r.total)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
