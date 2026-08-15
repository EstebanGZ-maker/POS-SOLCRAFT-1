"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Plus, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { getAdjustments, voidAdjustment, getProductsWithStock } from "@/lib/inventory-actions"
import { getSitesWithWarehouses } from "@/lib/site-actions"
import { AdjustmentDialog } from "@/components/inventory/adjustment-dialog"

export default function AdjustmentsPage() {
  const [open, setOpen] = useState(false)
  const [toDelete, setToDelete] = useState<any | null>(null)

  const { data: adjustments = [], isLoading, mutate } = useSWR("adjustments", getAdjustments)
  const { data: sites = [] } = useSWR("sites-wh", getSitesWithWarehouses)
  const { data: products = [] } = useSWR(["products-all"], () => getProductsWithStock(null))

  const warehouses = useMemo(
    () =>
      sites.flatMap((s: any) =>
        (s.warehouses || []).map((w: any) => ({ warehouse_id: w.warehouse_id, name: w.name, site_name: s.name })),
      ),
    [sites],
  )

  const confirmDelete = async () => {
    if (!toDelete) return
    const res = await voidAdjustment(toDelete.adjustment_id)
    if (res.success) toast({ title: "Listo", description: res.message })
    else toast({ title: "Error", description: res.message, variant: "destructive" })
    setToDelete(null)
    mutate()
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

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Bodega</TableHead>
              <TableHead>Observaciones</TableHead>
              <TableHead className="text-center">Ítems</TableHead>
              <TableHead className="text-right">Total ajustado</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : adjustments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Aún no hay ajustes registrados.
                </TableCell>
              </TableRow>
            ) : (
              adjustments.map((a: any) => (
                <TableRow key={a.adjustment_id}>
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
                  <TableCell className="text-right font-medium">{formatCurrency(a.total_adjusted)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setToDelete(a)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <AdjustmentDialog
        open={open}
        onOpenChange={setOpen}
        warehouses={warehouses}
        products={products}
        onSaved={() => mutate()}
      />

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
            <AlertDialogAction onClick={confirmDelete}>Anular</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
