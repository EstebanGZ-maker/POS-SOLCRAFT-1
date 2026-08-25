"use client"

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { IMPORT_FIELDS, type ImportFieldKey } from "@/lib/product-import"

const IGNORE_VALUE = "_ignore"
const UNMAPPED_VALUE = "_unmapped"

type Props = {
  headers: string[]
  mapping: Record<number, ImportFieldKey | undefined>
  onMappingChange: (mapping: Record<number, ImportFieldKey | undefined>) => void
  onBack: () => void
  onNext: () => void
}

const REQUIRED_FIELDS: ImportFieldKey[] = [
  "name",
  "price",
  "category",
  "unit",
  "cost",
  "initial_stock",
]

export function ProductImportStepMapping({
  headers,
  mapping,
  onMappingChange,
  onBack,
  onNext,
}: Props) {
  const { missingRequired, duplicates } = useMemo(() => {
    const fieldToIdxs: Partial<Record<ImportFieldKey, number[]>> = {}
    for (const [idxStr, field] of Object.entries(mapping)) {
      if (field && field !== "_ignore") {
        const arr = fieldToIdxs[field] ?? []
        arr.push(Number(idxStr))
        fieldToIdxs[field] = arr
      }
    }
    const missing = REQUIRED_FIELDS.filter((f) => !fieldToIdxs[f]?.length)
    const dupes: Array<{ field: ImportFieldKey; headers: string[] }> = []
    for (const [field, idxs] of Object.entries(fieldToIdxs)) {
      if (idxs && idxs.length > 1) {
        dupes.push({
          field: field as ImportFieldKey,
          headers: idxs.map((i) => headers[i] ?? `Columna ${i + 1}`),
        })
      }
    }
    return { missingRequired: missing, duplicates: dupes }
  }, [mapping, headers])

  const canContinue = missingRequired.length === 0 && duplicates.length === 0

  const handleChange = (idx: number, value: string) => {
    const next = { ...mapping }
    if (value === UNMAPPED_VALUE) {
      next[idx] = undefined
    } else {
      next[idx] = value as ImportFieldKey
    }
    onMappingChange(next)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mapeo de columnas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Asigná cada columna del archivo a un campo del sistema. Los campos
            marcados con <span className="text-destructive">*</span> son
            requeridos.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Columna del archivo</th>
                  <th className="pb-2 font-medium">Campo del sistema</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header, idx) => {
                  const value = mapping[idx] ?? UNMAPPED_VALUE
                  return (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 pr-4 align-middle font-medium">
                        {header || <span className="text-muted-foreground italic">(sin nombre)</span>}
                      </td>
                      <td className="py-2">
                        <Select
                          value={value}
                          onValueChange={(v) => handleChange(idx, v)}
                        >
                          <SelectTrigger className="max-w-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED_VALUE}>
                              (Sin asignar)
                            </SelectItem>
                            <SelectItem value={IGNORE_VALUE}>
                              (Ignorar esta columna)
                            </SelectItem>
                            {(Object.keys(IMPORT_FIELDS) as ImportFieldKey[])
                              .filter((k) => k !== "_ignore")
                              .map((k) => (
                                <SelectItem key={k} value={k}>
                                  {IMPORT_FIELDS[k].label}
                                  {IMPORT_FIELDS[k].required ? " *" : ""}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {missingRequired.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                Faltan asignar columnas para campos requeridos:{" "}
                {missingRequired.map((f) => IMPORT_FIELDS[f].label).join(", ")}.
              </AlertDescription>
            </Alert>
          )}

          {duplicates.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <div className="space-y-1">
                  <p>Hay campos asignados a más de una columna:</p>
                  <ul className="ml-4 list-disc">
                    {duplicates.map((d) => (
                      <li key={d.field}>
                        <strong>{IMPORT_FIELDS[d.field].label}</strong>:{" "}
                        {d.headers.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          ← Volver
        </Button>
        <Button onClick={onNext} disabled={!canContinue}>
          Continuar →
        </Button>
      </div>
    </div>
  )
}
