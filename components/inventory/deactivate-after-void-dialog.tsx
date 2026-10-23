"use client"

import { useEffect, useMemo, useState } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/components/ui/use-toast"
import { getProductsFromAdjustments, setProductsActive } from "@/lib/inventory-actions"

type ProductRow = Awaited<ReturnType<typeof getProductsFromAdjustments>>[number]

export function DeactivateAfterVoidDialog({
  open,
  onOpenChange,
  adjustmentIds,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  // Ajustes que acaban de anularse en esta operación (bulk o individual).
  // Vacío = no abrir el diálogo.
  adjustmentIds: string[]
  // Callback tras aplicar (éxito o parcial). La página puede revalidar su data.
  onDone?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [products, setProducts] = useState<ProductRow[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open || adjustmentIds.length === 0) return
    let alive = true
    setLoading(true)
    getProductsFromAdjustments(adjustmentIds)
      .then((rows) => {
        if (!alive) return
        // Solo productos activos — los ya inactivos no se ofrecen.
        const activos = rows.filter((r) => r.is_active)
        setProducts(activos)
        setChecked(new Set(activos.filter((r) => r.total_stock === 0).map((r) => r.product_id)))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, adjustmentIds])

  const { zero, withStock } = useMemo(() => {
    const z: ProductRow[] = []
    const w: ProductRow[] = []
    for (const p of products) (p.total_stock === 0 ? z : w).push(p)
    return { zero: z, withStock: w }
  }, [products])

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = async () => {
    const ids = [...checked]
    if (ids.length === 0) {
      onOpenChange(false)
      return
    }
    setRunning(true)
    const res = await setProductsActive(ids, false)
    setRunning(false)
    onOpenChange(false)
    onDone?.()
    const okCount = res.updated.length
    const rejected = res.rejected
    if (rejected.length === 0) {
      toast({ title: `${okCount} producto(s) desactivado(s)` })
      return
    }
    const codes = rejected
      .slice(0, 5)
      .map((r: any) => `${r.code ?? r.product_id.slice(0, 8)}: ${r.reason}`)
      .join("\n")
    const more = rejected.length - 5
    toast({
      title: `${okCount} desactivado(s), ${rejected.length} rechazado(s)`,
      description: codes + (more > 0 ? `\n…y ${more} más.` : ""),
      variant: "destructive",
    })
  }

  const hasAnything = products.length > 0

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desactivar también estos productos?</AlertDialogTitle>
          <AlertDialogDescription>
            Los productos de los ajustes que acabás de anular siguen activos. Marcá los
            que quieras ocultar del POS, catálogo y buscador. Solo se pueden desactivar
            los que quedaron en 0 en todas las bodegas.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Cargando productos…</p>
          ) : !hasAnything ? (
            <p className="text-muted-foreground">
              No hay productos activos que ofrecer para desactivar.
            </p>
          ) : (
            <>
              {zero.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    Quedaron en 0 en todas las bodegas
                  </h4>
                  <ul className="space-y-1.5 rounded-md border p-2">
                    {zero.map((p) => (
                      <li key={p.product_id} className="flex items-start gap-2">
                        <Checkbox
                          id={`chk-${p.product_id}`}
                          checked={checked.has(p.product_id)}
                          onCheckedChange={() => toggle(p.product_id)}
                        />
                        <label
                          htmlFor={`chk-${p.product_id}`}
                          className="flex-1 cursor-pointer leading-tight"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {p.code}
                          </span>{" "}
                          <span>{p.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {withStock.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    Todavía tienen stock
                  </h4>
                  <ul className="space-y-1.5 rounded-md border bg-muted/40 p-2">
                    {withStock.map((p) => (
                      <li key={p.product_id} className="flex items-start gap-2 opacity-70">
                        <Checkbox id={`chk-${p.product_id}`} checked={false} disabled />
                        <label
                          htmlFor={`chk-${p.product_id}`}
                          className="flex-1 leading-tight"
                        >
                          <div>
                            <span className="font-mono text-xs text-muted-foreground">
                              {p.code}
                            </span>{" "}
                            <span>{p.name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {p.stocks
                              .filter((s) => s.quantity > 0)
                              .map(
                                (s) =>
                                  `${s.site_name ? s.site_name + " · " : ""}${s.warehouse_name}: ${s.quantity}`,
                              )
                              .join(" · ")}
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>No, mantener activos</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={running || checked.size === 0}>
            {running ? "Desactivando…" : `Desactivar marcados (${checked.size})`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
