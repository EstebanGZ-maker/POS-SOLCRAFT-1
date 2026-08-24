"use client"

import { useMemo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { ValidatedRow } from "@/lib/product-import"

type Props = {
  validation: ValidatedRow[]
  warehouseName: string
  submitting: boolean
  serverError: string | null
  canSubmit: boolean
  onBack: () => void
  onReset: () => void
  onSubmit: () => void
}

const ROW_HEIGHT = 56

export function ProductImportStepPreview({
  validation,
  warehouseName,
  submitting,
  serverError,
  canSubmit,
  onBack,
  onReset,
  onSubmit,
}: Props) {
  const total = validation.length
  const validCount = useMemo(
    () => validation.filter((r) => r.errors.length === 0 && r.product).length,
    [validation],
  )
  const errorCount = total - validCount

  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: validation.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total:</span>{" "}
              <strong>{total}</strong> fila{total === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Válidas: {validCount}</span>
            </div>
            <div
              className={
                errorCount > 0
                  ? "flex items-center gap-1 text-destructive"
                  : "flex items-center gap-1 text-muted-foreground"
              }
            >
              <AlertCircle className="h-4 w-4" />
              <span>Con errores: {errorCount}</span>
            </div>
            <div className="ml-auto text-muted-foreground">
              Bodega destino: <strong>{warehouseName}</strong>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {/* Header sticky */}
        <div className="grid grid-cols-[60px_80px_1fr_120px_140px_2fr] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <div>#</div>
          <div>Estado</div>
          <div>Nombre</div>
          <div className="text-right">Precio</div>
          <div>Categoría</div>
          <div>Errores</div>
        </div>

        <div ref={parentRef} className="h-[500px] overflow-auto">
          <div
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
          >
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const row = validation[vItem.index]
              const hasErrors = row.errors.length > 0
              return (
                <div
                  key={vItem.key}
                  data-row-status={hasErrors ? "error" : "ok"}
                  className={`grid grid-cols-[60px_80px_1fr_120px_140px_2fr] gap-2 border-b px-3 text-sm items-center ${
                    hasErrors
                      ? "bg-red-50 dark:bg-red-950/30 border-l-4 border-l-destructive"
                      : "bg-green-50/50 dark:bg-green-950/10 border-l-4 border-l-green-500/70"
                  }`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vItem.size}px`,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <div className="text-muted-foreground">{row.row_index}</div>
                  <div>
                    {hasErrors ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span className="text-xs">Error</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span className="text-xs">OK</span>
                      </span>
                    )}
                  </div>
                  <div className="truncate">
                    {row.product?.name ?? renderRawCell(row.raw[0])}
                  </div>
                  <div className="text-right tabular-nums">
                    {row.product?.price != null
                      ? formatCOP(row.product.price)
                      : renderRawCell(row.raw[1]) || "—"}
                  </div>
                  <div className="truncate text-muted-foreground">
                    {renderRawCell(row.raw[2]) || "—"}
                  </div>
                  <div className="truncate text-xs text-destructive" title={row.errors.join(" • ")}>
                    {row.errors.length > 0 ? row.errors.join(" • ") : ""}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      {errorCount > 0 && !serverError && (
        <Alert variant="destructive">
          <AlertDescription>
            La importación es todo-o-nada: no se puede continuar mientras haya
            filas con errores. Corregí el archivo y volvé a subirlo.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={submitting}>
            ← Volver
          </Button>
          <Button variant="ghost" onClick={onReset} disabled={submitting}>
            Empezar de nuevo
          </Button>
        </div>
        <Button onClick={onSubmit} disabled={!canSubmit || submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting
            ? "Importando..."
            : `Importar ${validCount} producto${validCount === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  )
}

function renderRawCell(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "object") return ""
  return String(v)
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}
