"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { CheckCircle2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  autoMapColumns,
  validateRows,
  allValid,
  type ImportFieldKey,
  type RawSheet,
  type ValidatedRow,
  type ImportBootstrapData,
} from "@/lib/product-import"
import type { ImportBootstrap } from "@/lib/product-import-actions"
import { getImportBootstrap, runProductImport } from "@/lib/product-import-actions"
import { ProductImportStepUpload } from "./product-import-step-upload"
import { ProductImportStepMapping } from "./product-import-step-mapping"
import { ProductImportStepPreview } from "./product-import-step-preview"

type WizardStep = "upload" | "mapping" | "preview" | "success"

type WizardState = {
  step: WizardStep
  warehouseId: string | null
  fileMeta: { name: string; size: number } | null
  sheet: RawSheet | null
  mapping: Record<number, ImportFieldKey | undefined>
  serverError: string | null
  successCount: number | null
}

const INITIAL_STATE: WizardState = {
  step: "upload",
  warehouseId: null,
  fileMeta: null,
  sheet: null,
  mapping: {},
  serverError: null,
  successCount: null,
}

export function ProductImportWizard({ bootstrap: initialBootstrap }: { bootstrap: ImportBootstrap }) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [bootstrap, setBootstrap] = useState<ImportBootstrap>(initialBootstrap)
  const [isPending, startTransition] = useTransition()
  const [isRefreshing, startRefreshTransition] = useTransition()

  const validationBootstrap: ImportBootstrapData = useMemo(
    () => ({
      existingCodes: bootstrap.existingCodes,
      existingBarcodes: bootstrap.existingBarcodes,
      categories: bootstrap.categories,
    }),
    [bootstrap],
  )

  const handleRefreshBootstrap = () => {
    startRefreshTransition(async () => {
      try {
        const fresh = await getImportBootstrap()
        setBootstrap(fresh)
      } catch {
        // Silencioso: si falla, el user simplemente sigue viendo el snapshot
        // anterior. No queremos bloquear el flujo por un refetch.
      }
    })
  }

  const validation: ValidatedRow[] | null = useMemo(() => {
    if (!state.sheet) return null
    return validateRows(state.sheet.rows, state.mapping, validationBootstrap)
  }, [state.sheet, state.mapping, validationBootstrap])

  const warehouseName = useMemo(() => {
    if (!state.warehouseId) return ""
    const w = bootstrap.warehouses.find((w) => w.warehouse_id === state.warehouseId)
    return w ? `${w.site_name} — ${w.name}` : ""
  }, [state.warehouseId, bootstrap.warehouses])

  const reset = () => setState(INITIAL_STATE)

  const handleFileParsed = (sheet: RawSheet, meta: { name: string; size: number }) => {
    setState((s) => ({
      ...s,
      sheet,
      fileMeta: meta,
      mapping: autoMapColumns(sheet.headers),
    }))
  }

  const handleSubmit = () => {
    if (!validation || !state.warehouseId) return
    const products = validation
      .map((r) => r.product)
      .filter((p): p is NonNullable<typeof p> => p !== null)
    if (products.length === 0) return

    setState((s) => ({ ...s, serverError: null }))
    startTransition(async () => {
      const res = await runProductImport(products, state.warehouseId!)
      if (res.success) {
        setState((s) => ({
          ...s,
          step: "success",
          successCount: res.inserted_count ?? products.length,
        }))
      } else {
        setState((s) => ({ ...s, serverError: res.message }))
      }
    })
  }

  if (state.step === "success") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
          <div>
            <h2 className="text-xl font-semibold">
              Se importaron {state.successCount} producto{state.successCount === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Bodega destino: {warehouseName}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button asChild variant="default">
              <Link href="/inventory/products">Ver productos</Link>
            </Button>
            <Button variant="outline" onClick={reset}>
              <Upload className="mr-2 h-4 w-4" />
              Importar otro archivo
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <StepIndicator step={state.step} />

      {state.step === "upload" && (
        <ProductImportStepUpload
          warehouses={bootstrap.warehouses}
          warehouseId={state.warehouseId}
          fileMeta={state.fileMeta}
          onWarehouseChange={(id) => setState((s) => ({ ...s, warehouseId: id }))}
          onFileParsed={handleFileParsed}
          onClearFile={() =>
            setState((s) => ({ ...s, fileMeta: null, sheet: null, mapping: {} }))
          }
          onNext={() => setState((s) => ({ ...s, step: "mapping" }))}
          canContinue={!!state.warehouseId && !!state.sheet}
        />
      )}

      {state.step === "mapping" && state.sheet && (
        <ProductImportStepMapping
          headers={state.sheet.headers}
          mapping={state.mapping}
          onMappingChange={(mapping) => setState((s) => ({ ...s, mapping }))}
          onBack={() => setState((s) => ({ ...s, step: "upload" }))}
          onNext={() => setState((s) => ({ ...s, step: "preview" }))}
        />
      )}

      {state.step === "preview" && validation && (
        <ProductImportStepPreview
          validation={validation}
          warehouseName={warehouseName}
          submitting={isPending}
          refreshing={isRefreshing}
          serverError={state.serverError}
          canSubmit={allValid(validation)}
          onBack={() => setState((s) => ({ ...s, step: "mapping", serverError: null }))}
          onReset={reset}
          onSubmit={handleSubmit}
          onRefresh={handleRefreshBootstrap}
        />
      )}
    </div>
  )
}

function StepIndicator({ step }: { step: Exclude<WizardStep, "success"> }) {
  const steps: Array<{ key: Exclude<WizardStep, "success">; label: string }> = [
    { key: "upload", label: "1. Archivo" },
    { key: "mapping", label: "2. Mapeo" },
    { key: "preview", label: "3. Vista previa" },
  ]
  const currentIdx = steps.findIndex((s) => s.key === step)
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            className={
              i === currentIdx
                ? "font-semibold text-foreground"
                : i < currentIdx
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60"
            }
          >
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-muted-foreground/40">→</span>}
        </div>
      ))}
    </div>
  )
}
