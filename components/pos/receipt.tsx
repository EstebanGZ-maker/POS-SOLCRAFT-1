"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Printer, X, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { getReceiptData, type BusinessSettings } from "@/lib/business-settings-actions"

// -------------------------------------------------------------
// Tipos
// -------------------------------------------------------------

export interface ReceiptItem {
  name: string
  code: string | null
  description?: string | null
  unit?: string | null
  quantity: number
  unit_price: number      // precio final por unidad (con IVA y descuento aplicados)
  discount: number        // %
  tax_rate: number        // %
  subtotal: number        // unit_price * quantity
}

export interface ReceiptSaleInfo {
  sale_id: string
  numero: number | string | null
  date: string
  seller: string | null
  payment_method: string
  amount_received: number | null
  total: number
  subtotal: number | null
  discount_total: number
  tax_total: number
  status: string
}

export interface ReceiptCustomer {
  name: string
  phone: string | null
  id_type: string | null
  id_number: string | null
  address: string | null
}

export interface FullReceipt {
  business: BusinessSettings
  sale: ReceiptSaleInfo
  site_name: string | null
  customer: ReceiptCustomer | null
  items: ReceiptItem[]
}

// -------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  })
}

// Agrupa impuestos por tarifa para el resumen
function summarizeTaxes(items: ReceiptItem[]) {
  const map = new Map<number, { base: number; tax: number }>()
  for (const it of items) {
    if (!it.tax_rate) continue
    // Reversar: unit_price = base * (1+tax) * (1-disc)  →  base = unit_price / ((1+tax)*(1-disc))
    const disc = it.discount / 100
    const rate = it.tax_rate / 100
    const denom = (1 + rate) * (1 - disc)
    const netUnit = denom === 0 ? 0 : it.unit_price / denom
    const lineBase = netUnit * (1 - disc) * it.quantity  // base sin IVA después de descuento
    const lineTax = lineBase * rate
    const prev = map.get(it.tax_rate) || { base: 0, tax: 0 }
    map.set(it.tax_rate, { base: prev.base + lineBase, tax: prev.tax + lineTax })
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, base: v.base, tax: v.tax }))
}

// -------------------------------------------------------------
// Render (compartido entre preview y ventana de impresión)
// -------------------------------------------------------------

function renderReceiptHtml(data: FullReceipt): string {
  const { business, sale, site_name, customer, items } = data
  const align = business.header_alignment
  const totalProducts = items.reduce((s, it) => s + it.quantity, 0)
  const taxSummary = summarizeTaxes(items)
  const ticketId = sale.numero ? sale.numero : sale.sale_id.substring(0, 8)

  const line = () => `<div class="dashed"></div>`

  const business_html = `
    <div class="header" style="text-align:${align}">
      ${business.show_logo && business.logo_url ? `<img src="${business.logo_url}" class="logo" />` : ""}
      <div class="business-name">${escapeHtml(business.business_name)}</div>
      ${business.phone ? `<div><b>Teléfono:</b> ${escapeHtml(business.phone)}</div>` : ""}
      ${business.email ? `<div>${escapeHtml(business.email)}</div>` : ""}
      ${business.regime ? `<div><b>Régimen:</b> ${escapeHtml(business.regime)}</div>` : ""}
      ${business.tax_id ? `<div><b>NIT:</b> ${escapeHtml(business.tax_id)}</div>` : ""}
      ${site_name ? `<div class="muted">Sede: ${escapeHtml(site_name)}</div>` : ""}
    </div>
  `

  const invoice_meta_html = `
    <div class="center bold">Factura de venta de papel</div>
    <div class="center">N° ${ticketId}</div>
    ${sale.status === "voided" ? `<div class="center bold voided">ANULADA</div>` : ""}
    <div class="row"><span>Fecha:</span><b>${formatDate(sale.date)}</b></div>
    <div class="row"><span>Forma de pago:</span><b>${escapeHtml(sale.payment_method || "—")}</b></div>
    ${sale.seller ? `<div class="row"><span>Vendedor:</span><b>${escapeHtml(sale.seller)}</b></div>` : ""}
  `

  const customer_html = customer ? `
    <div class="bold">${escapeHtml(customer.name)}</div>
    ${customer.phone ? `<div><b>Teléfono:</b> ${escapeHtml(customer.phone)}</div>` : ""}
    ${business.show_customer_id && customer.id_number ? `<div>${escapeHtml(customer.id_type || "")} ${escapeHtml(customer.id_number)}</div>` : ""}
    ${customer.address ? `<div class="muted">${escapeHtml(customer.address)}</div>` : ""}
  ` : ""

  const items_html = items.map((it, idx) => {
    const taxLabel = it.tax_rate > 0 ? letterFromRate(it.tax_rate) : ""
    const nameLine = business.group_product_data
      ? `<div>${idx + 1} · ${escapeHtml(it.name)} · ${it.quantity} · ${formatCurrency(it.subtotal)}</div>`
      : `
        <div class="item-row">
          <span class="idx">${idx + 1}</span>
          <span class="name">${escapeHtml(it.name)}${taxLabel ? ` <span class="tax-tag">${taxLabel}</span>` : ""}</span>
          <span class="qty">${it.quantity}</span>
          <span class="subtotal">${formatCurrency(it.subtotal)}</span>
        </div>`
    const codeLine = it.code ? `<div class="muted small">${escapeHtml(it.code)}</div>` : ""
    const descLine = business.show_description && it.description ? `<div class="muted small">${escapeHtml(it.description)}</div>` : ""
    const unitLine = business.show_unit_of_measure && it.unit ? `<div class="muted small">Unidad: ${escapeHtml(it.unit)}</div>` : ""
    const priceLine = business.show_unit_price && !business.group_product_data
      ? `<div class="muted small">P.U.: ${formatCurrency(it.unit_price)}</div>` : ""
    const discLine = it.discount > 0
      ? `<div class="row disc"><span>Descuento ${it.discount}%</span><span>-${formatCurrency(it.subtotal * it.discount / (100 - it.discount) || 0)}</span></div>`
      : ""
    return `<div class="item">${nameLine}${codeLine}${descLine}${unitLine}${priceLine}${discLine}</div>`
  }).join("")

  const totals_html = `
    ${sale.subtotal != null ? `<div class="row"><span>Subtotal:</span><b>${formatCurrency(sale.subtotal)}</b></div>` : ""}
    ${sale.discount_total > 0 ? `<div class="row"><span>Descuento:</span><b>-${formatCurrency(sale.discount_total)}</b></div>` : ""}
    ${taxSummary.map(t => `<div class="row"><span>Total IVA (${t.rate.toFixed(2)}%):</span><b>${formatCurrency(t.tax)}</b></div>`).join("")}
    <div class="row total"><span>Total:</span><b>${formatCurrency(sale.total)}</b></div>
  `

  const tax_summary_html = business.show_tax_summary && taxSummary.length > 0 ? `
    <div class="center bold">Resumen de impuestos</div>
    <table class="tax-table">
      <thead><tr><th>Tarifa</th><th class="right">Base</th><th class="right">Impuesto</th></tr></thead>
      <tbody>
        ${taxSummary.map(t => `<tr><td>IVA ${t.rate.toFixed(0)}%</td><td class="right">${formatCurrency(t.base)}</td><td class="right">${formatCurrency(t.tax)}</td></tr>`).join("")}
        <tr class="bold"><td></td><td class="right">${formatCurrency(taxSummary.reduce((s, t) => s + t.base, 0))}</td><td class="right">${formatCurrency(taxSummary.reduce((s, t) => s + t.tax, 0))}</td></tr>
      </tbody>
    </table>
  ` : ""

  const lines_summary_html = business.show_lines_summary ? `
    <div><b>Total recibido:</b> ${formatCurrency(sale.amount_received ?? sale.total)}</div>
    <div><b>Total de líneas:</b> ${items.length}</div>
    <div><b>Total de productos:</b> ${totalProducts}</div>
  ` : ""

  const change = sale.amount_received != null ? sale.amount_received - sale.total : null
  const payment_html = `
    <div class="row"><span>Método:</span><b>${escapeHtml(sale.payment_method || "—")}</b></div>
    ${sale.amount_received != null ? `<div class="row"><span>Recibido:</span><b>${formatCurrency(sale.amount_received)}</b></div>` : ""}
    ${change != null && change > 0 ? `<div class="row"><span>Cambio:</span><b>${formatCurrency(change)}</b></div>` : ""}
  `

  const footer_html = `
    ${business.legal_footer ? `<div class="center small muted">${escapeHtml(business.legal_footer)}</div>` : ""}
    ${business.custom_phrase ? `<div class="center small">${escapeHtml(business.custom_phrase)}</div>` : ""}
  `

  return `
    <div class="receipt">
      ${business_html}
      ${line()}
      ${invoice_meta_html}
      ${customer ? line() : ""}
      ${customer_html}
      ${line()}
      <div class="items">${items_html}</div>
      ${line()}
      ${totals_html}
      ${line()}
      ${payment_html}
      ${line()}
      ${tax_summary_html}
      ${business.show_tax_summary && taxSummary.length > 0 ? line() : ""}
      ${lines_summary_html}
      ${line()}
      ${footer_html}
    </div>
  `
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function letterFromRate(rate: number) {
  if (rate === 5) return "A"
  if (rate === 7) return "B"
  if (rate === 12) return "C"
  if (rate === 19) return "D"
  return `${rate.toFixed(0)}%`
}

function receiptStyles(width: number, ml: number, mr: number) {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; font-size: 11px; width: ${width}mm; padding: 4mm ${mr}mm 4mm ${ml}mm; color: #000; }
    .receipt { width: 100%; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .small { font-size: 10px; }
    .muted { color: #555; }
    .dashed { border-top: 1px dashed #000; margin: 5px 0; }
    .header .business-name { font-weight: 700; font-size: 14px; margin: 2px 0; }
    .header .logo { max-width: 60mm; max-height: 15mm; margin: 0 auto 4px; display: block; }
    .row { display: flex; justify-content: space-between; }
    .row.total { font-weight: 700; font-size: 13px; margin-top: 4px; border-top: 1px solid #000; padding-top: 4px; }
    .row.disc { color: #555; }
    .item { margin: 4px 0; }
    .item-row { display: grid; grid-template-columns: 14px 1fr 24px 45px; gap: 4px; align-items: baseline; }
    .item-row .qty { text-align: right; }
    .item-row .subtotal { text-align: right; font-variant-numeric: tabular-nums; }
    .item-row .name { word-break: break-word; }
    .tax-tag { display: inline-block; border: 1px solid #000; padding: 0 3px; font-size: 9px; margin-left: 2px; }
    .tax-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 10px; }
    .tax-table th, .tax-table td { padding: 2px 0; border-bottom: 1px dotted #999; }
    .tax-table th { text-align: left; border-bottom: 1px solid #000; }
    .voided { color: #b91c1c; font-size: 14px; margin: 4px 0; }
    @media print { body { padding: 2mm; } }
  `
}

// -------------------------------------------------------------
// Componente principal (dialog + preview + botón imprimir)
// -------------------------------------------------------------

interface ReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  saleId: string | null
}

export function ReceiptDialog({ open, onOpenChange, saleId }: ReceiptDialogProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<FullReceipt | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !saleId) return
    setLoading(true)
    setData(null)
    getReceiptData(saleId)
      .then((d) => setData(d as FullReceipt | null))
      .finally(() => setLoading(false))
  }, [open, saleId])

  const handlePrint = () => {
    if (!data) return
    const html = renderReceiptHtml(data)
    const win = window.open("", "_blank", "width=360,height=640")
    if (!win) return
    win.document.write(`
      <!DOCTYPE html>
      <html><head><title>Factura ${data.sale.numero ?? ""}</title>
        <style>${receiptStyles(data.business.paper_width_mm, data.business.margin_left_mm, data.business.margin_right_mm)}</style>
      </head><body>${html}</body></html>`)
    win.document.close()
    win.focus()
    win.print()
    setTimeout(() => win.close(), 400)
  }

  const previewWidth = data ? Math.min(360, data.business.paper_width_mm * 3.5) : 320

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Factura de venta
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {data && (
          <div className="max-h-[70vh] overflow-y-auto bg-white p-2 rounded border">
            <div
              ref={printRef}
              className="mx-auto bg-white text-black"
              style={{ width: `${previewWidth}px` }}
            >
              <style dangerouslySetInnerHTML={{
                __html: receiptStyles(data.business.paper_width_mm, data.business.margin_left_mm, data.business.margin_right_mm)
                  .replace("body {", ".receipt-preview {")
              }} />
              <div
                className="receipt-preview"
                dangerouslySetInnerHTML={{ __html: renderReceiptHtml(data) }}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-1.5 h-4 w-4" />
            Cerrar
          </Button>
          <Button onClick={handlePrint} disabled={!data}>
            <Printer className="mr-1.5 h-4 w-4" />
            Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
