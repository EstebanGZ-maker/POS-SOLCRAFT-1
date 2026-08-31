"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import { X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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

// Contrato genérico para acciones masivas. La tabla no conoce las acciones
// concretas: cada página construye su propio array y lo pasa como prop.
// Agregar una acción futura = 1 entrada más en el array, sin tocar la tabla
// ni este componente.
export type BulkAction<T> = {
  id: string
  label: string
  icon: LucideIcon
  variant?: "default" | "destructive" | "outline"
  // Gate de visibilidad. Ej: para "Eliminar" en productos, () => canDelete.
  // Cuando devuelve false, el botón no se renderiza.
  available?: () => boolean
  // Diálogo de confirmación opcional. Sin él, la acción ejecuta directo.
  confirm?: {
    title: (n: number) => string
    description?: (n: number, items: T[]) => string
    actionLabel: string
  }
  // Ejecutor real. Recibe los items seleccionados y devuelve el resumen.
  run: (items: T[]) => Promise<{
    success: boolean
    processed: number
    failed: number
    message?: string
  }>
}

type Props<T> = {
  selected: T[]
  actions: BulkAction<T>[]
  onClear: () => void
  onDone: () => void
  // Etiqueta singular/plural del ítem seleccionado, ej. ["producto", "productos"].
  // Solo se usa en el contador "N producto(s) seleccionado(s)".
  itemLabel?: [string, string]
}

export function BulkActionsBar<T>({
  selected,
  actions,
  onClear,
  onDone,
  itemLabel = ["ítem", "ítems"],
}: Props<T>) {
  const [pendingAction, setPendingAction] = useState<BulkAction<T> | null>(null)
  const [running, setRunning] = useState(false)

  const n = selected.length
  if (n === 0) return null

  const visibleActions = actions.filter((a) => a.available?.() !== false)

  async function execute(action: BulkAction<T>) {
    setRunning(true)
    try {
      const res = await action.run(selected)
      const parts: string[] = []
      if (res.processed > 0) parts.push(`${res.processed} procesado${res.processed === 1 ? "" : "s"}`)
      if (res.failed > 0) parts.push(`${res.failed} fallado${res.failed === 1 ? "" : "s"}`)
      toast({
        title: res.success ? "Listo" : "Con errores",
        description: res.message || parts.join(", ") || "Sin cambios.",
        variant: res.success ? "default" : "destructive",
      })
      onDone()
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "No se pudo ejecutar la acción.",
        variant: "destructive",
      })
    } finally {
      setRunning(false)
      setPendingAction(null)
    }
  }

  async function handleClick(action: BulkAction<T>) {
    if (action.confirm) {
      setPendingAction(action)
    } else {
      await execute(action)
    }
  }

  const [singular, plural] = itemLabel
  const label = n === 1 ? singular : plural

  return (
    <>
      <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-background/95 p-2 shadow-sm backdrop-blur">
        <span className="px-2 text-sm font-medium">
          {n} {label} seleccionado{n === 1 ? "" : "s"}
        </span>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={running} className="gap-1">
          <X className="h-4 w-4" /> Deseleccionar
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {visibleActions.map((a) => {
            const Icon = a.icon
            return (
              <Button
                key={a.id}
                size="sm"
                variant={a.variant ?? "default"}
                onClick={() => handleClick(a)}
                disabled={running}
                className="gap-2"
              >
                {running && pendingAction?.id === a.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                {a.label}
              </Button>
            )
          })}
        </div>
      </div>

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(o) => !o && !running && setPendingAction(null)}
      >
        <AlertDialogContent>
          {pendingAction?.confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{pendingAction.confirm.title(n)}</AlertDialogTitle>
                {pendingAction.confirm.description && (
                  <AlertDialogDescription>
                    {pendingAction.confirm.description(n, selected)}
                  </AlertDialogDescription>
                )}
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={running}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    execute(pendingAction)
                  }}
                  disabled={running}
                >
                  {running ? "Procesando..." : pendingAction.confirm.actionLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
