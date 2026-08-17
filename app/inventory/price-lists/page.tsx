"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { Plus, Trash2, Search, Check } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { formatCurrency } from "@/lib/utils"
import {
  getPriceLists,
  getPriceListWithProducts,
  savePriceList,
  setProductPrice,
  deletePriceList,
} from "@/lib/inventory-actions"

export default function PriceListsPage() {
  const { data: lists = [], mutate: mutateLists } = useSWR("price-lists", getPriceLists)
  const [selectedId, setSelectedId] = useState<string>("")
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")

  useEffect(() => {
    if (!selectedId && lists.length) setSelectedId(lists[0].price_list_id)
  }, [lists, selectedId])

  const { data: products = [], mutate: mutateProducts } = useSWR(
    selectedId ? ["price-list-products", selectedId] : null,
    () => getPriceListWithProducts(selectedId),
  )

  const createList = async () => {
    if (!name.trim()) return
    const res = await savePriceList(name)
    if (res.success) {
      toast({ title: "Lista creada" })
      setName("")
      setOpen(false)
      mutateLists()
    } else toast({ title: "Error", description: res.message, variant: "destructive" })
  }

  const savePrice = async (product_id: string, value: number | null) => {
    const price = value ?? 0
    const res = await setProductPrice(product_id, selectedId, price)
    if (res.success) {
      toast({ title: "Precio actualizado" })
      mutateProducts()
    } else toast({ title: "Error", description: res.message, variant: "destructive" })
  }

  const removeList = async (id: string) => {
    const res = await deletePriceList(id)
    if (res.success) {
      toast({ title: "Listo", description: res.message })
      if (selectedId === id) setSelectedId("")
      mutateLists()
    } else toast({ title: "Error", description: res.message, variant: "destructive" })
  }

  const filtered = products.filter(
    (p: any) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <PageHeader
        title="Listas de precios"
        description="Define distintos precios de venta para diferentes clientes o canales."
      >
        <Button className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Nueva lista
        </Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardContent className="space-y-1 p-3">
            {lists.map((l: any) => (
              <button
                key={l.price_list_id}
                onClick={() => setSelectedId(l.price_list_id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                  selectedId === l.price_list_id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  {l.name}
                  {l.is_default && (
                    <Badge variant="secondary" className="text-[10px]">
                      Por defecto
                    </Badge>
                  )}
                </span>
                {!l.is_default && (
                  <Trash2
                    className="h-3.5 w-3.5 opacity-70 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeList(l.price_list_id)
                    }}
                  />
                )}
              </button>
            ))}
            {lists.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Sin listas.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="relative mb-3 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar producto"
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Precio base</TableHead>
                  <TableHead className="w-48 text-right">Precio en esta lista</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p: any) => (
                  <PriceRow key={p.product_id} product={p} onSave={savePrice} />
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      Sin productos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva lista de precios</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Mayorista" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createList}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PriceRow({ product, onSave }: { product: any; onSave: (id: string, v: number | null) => void }) {
  const [value, setValue] = useState<number | null>(Number(product.listPrice ?? product.price) || 0)

  useEffect(() => {
    setValue(Number(product.listPrice ?? product.price) || 0)
  }, [product.listPrice, product.price])

  return (
    <TableRow>
      <TableCell className="font-medium">{product.name}</TableCell>
      <TableCell className="text-right text-muted-foreground">{formatCurrency(product.price)}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <MoneyInput
            className="h-9 w-32 text-right"
            value={value}
            onChange={setValue}
            emptyAsNull
          />
          <Button size="icon" variant="secondary" className="h-9 w-9" onClick={() => onSave(product.product_id, value)}>
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
