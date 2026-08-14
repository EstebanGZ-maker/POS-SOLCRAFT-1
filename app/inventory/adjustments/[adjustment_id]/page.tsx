"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, ChevronRight, AlertTriangle } from "lucide-react"

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
import { useAuth } from "@/lib/auth-context"
import { formatCurrency } from "@/lib/utils"
import { getAdjustmentById, voidAdjustment } from "@/lib/inventory-actions"

const MOTIVO_LABEL: Record<string, string> = {
  compra: "Compra",
  sobrante: "Sobrante",
  correccion: "Corrección",
}

export default function AdjustmentDetailPage() {
  const params = useParams<{ adjustment_id: string }>()
  const router = useRouter()
  const { role, assignedSiteId } = useAuth()

  const adjustment_id = params.adjustment_id
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const { data: adj, isLoading, mutate } = useSWR(
    ["adjustment", adjustment_id],
    () => getAdjustmentById(adjustment_id),
  )

  // -------------------------------------------------------------------------
  // Visibilidad del botón "Anular" — ESPEJO de la regla del RPC void_adjustment
  // (rol admin, o encargado con sede primaria == sede del ajuste).
  //
  // ⚠ ESTO NO ES AUTORIZACIÓN. Es solo visibilidad. La barrera real está
  // dentro de void_adjustment (SECURITY DEFINER + user_role() + user_site_id()).
  // Si el UI muestra el botón por error, el RPC igual rebota con RAISE y el
  // toast muestra el mensaje. Nunca confundir mostrar con permitir.
  // -------------------------------------------------------------------------
  const canVoid = useMemo(() => {
    if (!adj || (adj as any).status !== "active") return false
    return (
      role === "admin" ||
      (role === "encargado" && assignedSiteId === (adj as any).site_id)
    )
  }, [adj, role, assignedSiteId])

  const items = (adj as any)?.adjustment_items ?? []

  const hadIncrementsWithCost = useMemo(
    () =>
      items.some(
        (it: any) => it.objective === "incrementar" && Number(it.cost) > 0,
      ),
    [items],
  )

  async function handleVoid() {
    setVoiding(true)
    const res = await voidAdjustment(adjustment_id)
    setVoiding(false)
    setVoidOpen(false)
    if (res.success) {
      toast({ title: "Ajuste anulado", description: res.message })
      mutate()
    } else {
      toast({
        title: "No se pudo anular",
        description: res.message,
        variant: "destructive",
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Cargando ajuste...</p>
      </div>
    )
  }

  if (!adj) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-lg font-medium">Ajuste no encontrado.</p>
        <Button
          variant="link"
          className="p-0"
          onClick={() => router.push("/inventory/adjustments")}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver a la lista
        </Button>
      </div>
    )
  }

  const anyAdj = adj as any
  const sedeName = anyAdj.warehouses?.sites?.name ?? "—"
  const bodegaName = anyAdj.warehouses?.name ?? "—"
  const fecha = new Date(anyAdj.adjustment_date).toLocaleString("es-CO")
  const isVoided = anyAdj.status === "voided"
  const numeroLabel =
    anyAdj.numero != null ? `Ajuste #${anyAdj.numero}` : "Ajuste (sin número)"

  // Fuente de verdad del total: `total_adjusted` que persistió el RPC. Criterio
  // definido en scripts/16..17c: SUMA SIN SIGNO de cost*quantity (incrementos
  // y disminuciones ambos suman positivo — "valor movido", no neto). No se
  // recalcula aquí para que detalle y lista siempre coincidan y para que un
  // cambio de criterio en el RPC se herede sin tocar UI.
  const totalGeneral = Number(anyAdj.total_adjusted ?? 0)

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/inventory" className="hover:text-foreground">
          Inventario
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link href="/inventory/adjustments" className="hover:text-foreground">
          Ajustes
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{numeroLabel}</span>
      </nav>

      {/* Encabezado */}
      <Card className="space-y-3 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{numeroLabel}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {sedeName} · {bodegaName} · {fecha}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={isVoided ? "outline" : "secondary"}
              className={
                isVoided
                  ? "border-destructive text-destructive"
                  : "bg-primary/10 text-primary"
              }
            >
              {isVoided ? "Anulado" : "Activo"}
            </Badge>
            {anyAdj.motivo && (
              <Badge variant="secondary">
                Motivo: {MOTIVO_LABEL[anyAdj.motivo] ?? anyAdj.motivo}
              </Badge>
            )}
            {canVoid && (
              <Button variant="destructive" onClick={() => setVoidOpen(true)}>
                Anular
              </Button>
            )}
          </div>
        </div>

        {anyAdj.creator && (
          <p className="text-sm text-muted-foreground">
            Creado por:{" "}
            <span className="text-foreground">
              {anyAdj.creator.full_name || anyAdj.creator.email || "—"}
            </span>
          </p>
        )}
        {anyAdj.notes && (
          <p className="text-sm text-muted-foreground">
            Notas: <span className="text-foreground">{anyAdj.notes}</span>
          </p>
        )}
      </Card>

      {/* Banner anulado — sin fecha (updated_at podría no ser la fecha real
          de anulación si algo tocara la fila después). */}
      {isVoided && (
        <Card className="border-destructive bg-destructive/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium text-destructive">Ajuste anulado</p>
              <p className="text-sm text-muted-foreground">
                El efecto de este ajuste sobre el stock fue revertido.
              </p>
              {hadIncrementsWithCost && (
                <p className="text-sm text-muted-foreground">
                  El costo promedio del producto <strong>no</strong> se
                  revierte automáticamente. Si necesitas restaurar el costo
                  anterior, corrígelo con un ajuste de costo manual.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Líneas */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Costo unit.</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-muted-foreground"
                >
                  Este ajuste no tiene líneas.
                </TableCell>
              </TableRow>
            ) : (
              items.map((it: any) => (
                <TableRow key={it.adjustment_item_id}>
                  <TableCell className="font-mono text-xs">
                    {it.products?.code || "—"}
                  </TableCell>
                  <TableCell>{it.products?.name || "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        it.objective === "incrementar"
                          ? "border-emerald-500 text-emerald-600"
                          : "border-amber-500 text-amber-600"
                      }
                    >
                      {it.objective === "incrementar"
                        ? "Incremento"
                        : "Disminución"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{it.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(Number(it.cost))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(it.cost) * Number(it.quantity))}
                  </TableCell>
                </TableRow>
              ))
            )}
            {items.length > 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-right font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {formatCurrency(totalGeneral)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Confirmación Anular */}
      <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular {numeroLabel}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Se revertirá el efecto de este ajuste sobre el stock de la
                  bodega. El ajuste queda registrado como anulado (no se borra)
                  para trazabilidad.
                </p>
                {hadIncrementsWithCost && (
                  <p>
                    El costo promedio del producto <strong>no</strong> se
                    revierte automáticamente.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voiding}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleVoid} disabled={voiding}>
              {voiding ? "Anulando..." : "Anular"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
