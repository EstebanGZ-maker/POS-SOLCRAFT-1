"use client"

import { useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { Search, Printer, Barcode as BarcodeIcon, Plus, Minus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Barcode } from "@/components/inventory/barcode"
import { formatCurrency } from "@/lib/utils"
import { getProductsForBarcodes } from "@/lib/inventory-actions"

type ProductRow = {
  product_id: string
  name: string
  code: string
  barcode: string
  size: string | null
  price: number
  category: string | null
}

export default function BarcodesPage() {
  const { data: products = [], isLoading } = useSWR("barcode-products", getProductsForBarcodes)
  const [search, setSearch] = useState("")
  const [copies, setCopies] = useState<Record<string, number>>({})
  const printRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products as ProductRow[]
    return (products as ProductRow[]).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q),
    )
  }, [products, search])

  const getCopies = (id: string) => copies[id] ?? 1
  const setCount = (id: string, n: number) => setCopies((prev) => ({ ...prev, [id]: Math.max(1, Math.min(100, n)) }))

  // Build the flat list of labels to print
  const labels = useMemo(() => {
    const out: ProductRow[] = []
    for (const p of filtered) {
      const n = getCopies(p.product_id)
      for (let i = 0; i < n; i++) out.push(p)
    }
    return out
  }, [filtered, copies])

  const totalLabels = labels.length

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Códigos de barra"
        description="Genera e imprime etiquetas con el código de identificación de cada producto."
        icon={BarcodeIcon}
      />

      {/* Controls — hidden when printing */}
      <div className="no-print space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, código o categoría"
              className="pl-9"
            />
          </div>
          <Button onClick={handlePrint} disabled={totalLabels === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir etiquetas ({totalLabels})
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-14 text-center text-sm text-muted-foreground">Cargando productos…</CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="rounded-full bg-muted p-4">
                <BarcodeIcon className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No hay productos con código. Ingresa mercancía para generar sus códigos de barra.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <Card key={p.product_id} className="overflow-hidden">
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.category ?? "Sin categoría"} {p.size ? `· Talla ${p.size}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{formatCurrency(p.price)}</Badge>
                  </div>

                  <div className="flex items-center justify-center rounded-md border bg-white p-2">
                    <Barcode value={p.barcode || p.code} height={45} />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Etiquetas a imprimir</span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setCount(p.product_id, getCopies(p.product_id) - 1)}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <Input
                        type="number"
                        value={getCopies(p.product_id)}
                        onChange={(e) => setCount(p.product_id, Number(e.target.value))}
                        className="h-7 w-14 text-center"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setCount(p.product_id, getCopies(p.product_id) + 1)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Print area — only visible when printing */}
      <div ref={printRef} className="print-area hidden">
        {labels.map((p, i) => (
          <div key={`${p.product_id}-${i}`} className="label">
            <span className="label-name">{p.name}</span>
            <Barcode value={p.barcode || p.code} height={40} width={1.4} fontSize={12} />
            <span className="label-price">{formatCurrency(p.price)}{p.size ? ` · ${p.size}` : ""}</span>
          </div>
        ))}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-area,
          .print-area * {
            visibility: visible;
          }
          .print-area {
            display: flex !important;
            flex-wrap: wrap;
            gap: 4mm;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 6mm;
          }
          .no-print {
            display: none !important;
          }
          .label {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 45mm;
            border: 1px dashed #cbd5e1;
            padding: 2mm;
            break-inside: avoid;
          }
          .label-name {
            font-size: 9px;
            font-weight: 600;
            text-align: center;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .label-price {
            font-size: 9px;
            color: #111;
          }
        }
      `}</style>
    </div>
  )
}
