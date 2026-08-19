"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, HandCoins, Printer } from "lucide-react"
import { getReceivableSaleDetail, type ReceivableSaleDetail } from "@/lib/actions"
import { getCurrentShift } from "@/lib/shift-actions"
import { formatCurrency } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { RegisterPaymentDialog } from "@/components/credit/register-payment-dialog"
import { ReceiptDialog } from "@/components/pos/receipt"

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

interface Props {
  initialDetail: ReceivableSaleDetail
}

export function ReceivableSaleDetailClient({ initialDetail }: Props) {
  const router = useRouter()
  const { role } = useAuth()
  const [detail, setDetail] = useState<ReceivableSaleDetail>(initialDetail)
  const [payOpen, setPayOpen] = useState(false)
  const [payShiftId, setPayShiftId] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [, startTransition] = useTransition()

  const canMutate = role !== "contador"
  const { sale, customer, site_name, items, payments, accounting_entries } = detail

  async function refreshDetail() {
    const fresh = await getReceivableSaleDetail(sale.sale_id)
    if (fresh) setDetail(fresh)
    startTransition(() => router.refresh())
  }

  async function openPayment() {
    let shiftId: string | null = null
    if (sale.site_id) {
      const shift = await getCurrentShift(sale.site_id)
      shiftId = shift?.shift_id ?? null
    }
    setPayShiftId(shiftId)
    setPayOpen(true)
  }

  const ticket = sale.numero != null ? `#${sale.numero}` : sale.sale_id.slice(0, 8)
  const isVoided = sale.status === "voided"

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title={`Venta ${ticket}`}
        description={
          isVoided
            ? "Venta anulada."
            : sale.is_on_account
              ? "Venta a crédito."
              : "Venta de contado."
        }
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/receivables">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Volver
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => setReceiptOpen(true)}>
          <Printer className="mr-1.5 h-4 w-4" />
          Imprimir recibo
        </Button>
        {canMutate && sale.balance_due > 0 && !isVoided && (
          <Button size="sm" onClick={openPayment}>
            <HandCoins className="mr-1.5 h-4 w-4" />
            Registrar pago
          </Button>
        )}
      </PageHeader>

      {/* Resumen */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-2xl font-bold">{formatCurrency(sale.total_amount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Cobrado</div>
            <div className="text-2xl font-bold">{formatCurrency(sale.amount_paid)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Por cobrar</div>
            <div className="text-2xl font-bold text-primary">
              {formatCurrency(sale.balance_due)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Meta de la venta + cliente */}
      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Cliente</div>
            <div className="font-medium">
              {customer ? (
                <Link
                  href={`/customers?highlight=${customer.customer_id}`}
                  className="hover:underline"
                >
                  {customer.name}
                </Link>
              ) : (
                "—"
              )}
            </div>
            {customer?.phone && (
              <div className="text-xs text-muted-foreground">{customer.phone}</div>
            )}
            {customer?.id_number && (
              <div className="text-xs text-muted-foreground">
                {customer.id_type ?? ""} {customer.id_number}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-muted-foreground">Fecha</div>
              <div>{formatDateTime(sale.sale_date)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Sede</div>
              <div>{site_name ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Vendedor</div>
              <div>{sale.seller ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Estado</div>
              <div>
                {isVoided ? (
                  <Badge variant="destructive">Anulada</Badge>
                ) : sale.balance_due > 0 ? (
                  <Badge variant="secondary">Con saldo pendiente</Badge>
                ) : (
                  <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    Pagada
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="items" className="w-full">
        <TabsList>
          <TabsTrigger value="items">Detalle</TabsTrigger>
          <TabsTrigger value="payments">Pagos recibidos ({payments.filter((p) => p.status === "active").length})</TabsTrigger>
          <TabsTrigger value="accounting">Contabilidad ({accounting_entries.length})</TabsTrigger>
        </TabsList>

        {/* Tab: items */}
        <TabsContent value="items">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Desc.</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                        Sin ítems en esta venta.
                      </TableCell>
                    </TableRow>
                  )}
                  {items.map((it) => (
                    <TableRow key={it.sale_item_id}>
                      <TableCell>
                        <div className="font-medium">{it.name}</div>
                        {it.description && (
                          <div className="text-xs text-muted-foreground">{it.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{it.code ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(it.unit_price)}</TableCell>
                      <TableCell className="text-right">{it.quantity}</TableCell>
                      <TableCell className="text-right">
                        {it.discount > 0 ? `${it.discount}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(it.subtotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t p-3 text-sm">
                <div className="ml-auto max-w-xs space-y-1">
                  {sale.subtotal != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(sale.subtotal)}</span>
                    </div>
                  )}
                  {sale.discount_total > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Descuento</span>
                      <span>-{formatCurrency(sale.discount_total)}</span>
                    </div>
                  )}
                  {sale.tax_total > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Impuestos</span>
                      <span>{formatCurrency(sale.tax_total)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(sale.total_amount)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: payments */}
        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Sin pagos registrados. Los abonos que se registren aparecerán aquí.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Recibido por</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.payment_id} className={p.status === "voided" ? "opacity-60" : ""}>
                        <TableCell className="text-xs">{formatDateTime(p.created_at)}</TableCell>
                        <TableCell>{p.payment_method}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.received_by ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(p.amount)}
                        </TableCell>
                        <TableCell>
                          {p.status === "voided" ? (
                            <Badge variant="destructive">Anulado</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                              Activo
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: accounting */}
        <TabsContent value="accounting">
          <Card>
            <CardContent className="p-0">
              {accounting_entries.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Esta venta aún no tiene asientos contables asociados. En crédito el income
                  se reconoce cuando llegan los abonos; los asientos aparecerán conforme se
                  registren pagos.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Categoría</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounting_entries.map((e) => (
                      <TableRow key={e.entry_id}>
                        <TableCell className="text-xs">{formatDate(e.entry_date)}</TableCell>
                        <TableCell>
                          {e.entry_type === "income" ? (
                            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                              Ingreso
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                              Gasto
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{e.category ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(e.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RegisterPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        sale={
          payOpen
            ? {
                sale_id: sale.sale_id,
                numero: sale.numero,
                customer_id: sale.customer_id,
                customer_name: customer?.name ?? null,
                total_amount: sale.total_amount,
                amount_paid: sale.amount_paid,
                balance_due: sale.balance_due,
              }
            : null
        }
        shiftId={payShiftId}
        onDone={() => {
          setPayOpen(false)
          refreshDetail()
        }}
      />

      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        saleId={sale.sale_id}
      />
    </div>
  )
}
