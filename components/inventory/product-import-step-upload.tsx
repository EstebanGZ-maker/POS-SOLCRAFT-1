"use client"

import { useRef, useState } from "react"
import { Download, FileSpreadsheet, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  buildTemplateWorkbook,
  parseWorkbook,
  type RawSheet,
} from "@/lib/product-import"
import type { ImportBootstrap } from "@/lib/product-import-actions"

type Props = {
  warehouses: ImportBootstrap["warehouses"]
  warehouseId: string | null
  fileMeta: { name: string; size: number } | null
  onWarehouseChange: (id: string) => void
  onFileParsed: (sheet: RawSheet, meta: { name: string; size: number }) => void
  onClearFile: () => void
  onNext: () => void
  canContinue: boolean
}

export function ProductImportStepUpload({
  warehouses,
  warehouseId,
  fileMeta,
  onWarehouseChange,
  onFileParsed,
  onClearFile,
  onNext,
  canContinue,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Agrupar bodegas por sede para el select.
  const warehousesBySite = warehouses.reduce<
    Record<string, { site_name: string; items: ImportBootstrap["warehouses"] }>
  >((acc, w) => {
    if (!acc[w.site_id]) acc[w.site_id] = { site_name: w.site_name, items: [] }
    acc[w.site_id].items.push(w)
    return acc
  }, {})

  const handleDownloadTemplate = async () => {
    setDownloading(true)
    try {
      const bytes = await buildTemplateWorkbook()
      // Copiar el Uint8Array a un ArrayBuffer nuevo antes de armar el Blob
      // para satisfacer BlobPart en runtimes estrictos con TS.
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const blob = new Blob([ab], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "plantilla-productos.xlsx"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const handleFile = async (file: File) => {
    setParseError(null)
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setParseError("El archivo debe ser .xlsx.")
      return
    }
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setParseError(
        `El archivo pesa ${(file.size / 1024 / 1024).toFixed(2)}MB. Máximo permitido: 2MB.`,
      )
      return
    }
    setParsing(true)
    try {
      const sheet = await parseWorkbook(file)
      if (sheet.rows.length === 0) {
        setParseError("El archivo no tiene filas de datos.")
        return
      }
      if (sheet.rows.length > IMPORT_MAX_ROWS) {
        setParseError(
          `El archivo tiene ${sheet.rows.length} filas. Máximo permitido: ${IMPORT_MAX_ROWS}.`,
        )
        return
      }
      onFileParsed(sheet, { name: file.name, size: file.size })
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "No se pudo leer el archivo.",
      )
    } finally {
      setParsing(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Descargar plantilla</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Descargá la plantilla oficial en Excel, completá tus productos y volvé
            a subir el archivo. Los encabezados de columnas se detectan
            automáticamente.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadTemplate}
            disabled={downloading}
          >
            <Download className="mr-2 h-4 w-4" />
            {downloading ? "Generando..." : "Descargar plantilla .xlsx"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Bodega destino</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="warehouse-select">
            Elegí en qué bodega se cargará el stock inicial de los productos.
          </Label>
          <Select
            value={warehouseId ?? undefined}
            onValueChange={onWarehouseChange}
          >
            <SelectTrigger id="warehouse-select" className="max-w-md">
              <SelectValue placeholder="Seleccioná una bodega..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(warehousesBySite).map(([siteId, group]) => (
                <SelectGroup key={siteId}>
                  <SelectLabel>{group.site_name}</SelectLabel>
                  {group.items.map((w) => (
                    <SelectItem key={w.warehouse_id} value={w.warehouse_id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {warehouses.length === 0 && (
            <p className="text-sm text-destructive">
              No tenés bodegas disponibles para importar.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">3. Subir archivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              Arrastrá el archivo .xlsx o hacé click para seleccionarlo
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Máximo {IMPORT_MAX_ROWS} filas · 2MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
                e.target.value = ""
              }}
            />
          </div>

          {parsing && (
            <p className="text-sm text-muted-foreground">Leyendo archivo...</p>
          )}

          {fileMeta && !parsing && (
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{fileMeta.name}</span>
                <span className="text-muted-foreground">
                  ({(fileMeta.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClearFile}
                aria-label="Quitar archivo"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {parseError && (
            <Alert variant="destructive">
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canContinue}>
          Continuar →
        </Button>
      </div>
    </div>
  )
}
