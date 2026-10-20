"use client"

import { useMemo, useState } from "react"
import { ChevronsUpDown, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { cn } from "@/lib/utils"

type Option = { product_id: string; name: string; code?: string | null }

const BULK_CONFIRM_THRESHOLD = 50

export function MultiProductPicker({
  products,
  alreadyAddedIds,
  onAddMany,
  label = "Agregar producto",
}: {
  products: Option[]
  alreadyAddedIds: Set<string>
  onAddMany: (ps: Option[]) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirmSelectAll, setConfirmSelectAll] = useState<null | Option[]>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q),
    )
  }, [products, search])

  const selectableFiltered = useMemo(
    () => filtered.filter((p) => !alreadyAddedIds.has(p.product_id)),
    [filtered, alreadyAddedIds],
  )
  const allFilteredChecked =
    selectableFiltered.length > 0 && selectableFiltered.every((p) => checked.has(p.product_id))

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyAddMany = (opts: Option[]) => {
    onAddMany(opts)
    setChecked(new Set())
    setSearch("")
    setOpen(false)
  }

  const addSelected = () => {
    const toAdd = products.filter((p) => checked.has(p.product_id) && !alreadyAddedIds.has(p.product_id))
    if (toAdd.length === 0) return
    applyAddMany(toAdd)
  }

  const selectAllResults = () => {
    if (selectableFiltered.length === 0) return
    if (selectableFiltered.length > BULK_CONFIRM_THRESHOLD) {
      setConfirmSelectAll(selectableFiltered)
      return
    }
    // Toggle: si todos ya están marcados, los desmarcamos; si no, marcamos.
    setChecked((prev) => {
      const next = new Set(prev)
      if (allFilteredChecked) {
        for (const p of selectableFiltered) next.delete(p.product_id)
      } else {
        for (const p of selectableFiltered) next.add(p.product_id)
      }
      return next
    })
  }

  const confirmBulkSelect = () => {
    if (!confirmSelectAll) return
    setChecked((prev) => {
      const next = new Set(prev)
      for (const p of confirmSelectAll) next.add(p.product_id)
      return next
    })
    setConfirmSelectAll(null)
  }

  const selectedCountValid = Array.from(checked).filter((id) => !alreadyAddedIds.has(id)).length

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setChecked(new Set())
            setSearch("")
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Plus className="h-4 w-4" /> {label}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[22rem] p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o código"
              className="h-8 border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              {filtered.length} resultado{filtered.length === 1 ? "" : "s"} ·{" "}
              {selectedCountValid} seleccionado{selectedCountValid === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="font-medium text-primary hover:underline disabled:opacity-50"
              onClick={selectAllResults}
              disabled={selectableFiltered.length === 0}
            >
              {allFilteredChecked ? "Quitar selección" : "Seleccionar todos los resultados"}
            </button>
          </div>
          <ScrollArea className="max-h-[18rem]">
            <div className="divide-y">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">Sin resultados.</div>
              ) : (
                filtered.map((p) => {
                  const already = alreadyAddedIds.has(p.product_id)
                  const isChecked = already || checked.has(p.product_id)
                  return (
                    <label
                      key={p.product_id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                        already ? "cursor-not-allowed opacity-60" : "hover:bg-accent",
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        disabled={already}
                        onCheckedChange={() => toggle(p.product_id)}
                      />
                      <span className="flex-1">{p.name}</span>
                      {p.code && (
                        <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      )}
                      {already && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          agregado
                        </span>
                      )}
                    </label>
                  )
                })
              )}
            </div>
          </ScrollArea>
          <div className="border-t p-2">
            <Button
              className="w-full"
              onClick={addSelected}
              disabled={selectedCountValid === 0}
            >
              Agregar {selectedCountValid} seleccionado{selectedCountValid === 1 ? "" : "s"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={!!confirmSelectAll}
        onOpenChange={(o) => !o && setConfirmSelectAll(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Seleccionar todos?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a marcar {confirmSelectAll?.length ?? 0} productos de una vez. Confirma para
              seguir, o cancela para marcarlos manualmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkSelect}>Seleccionar todos</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
