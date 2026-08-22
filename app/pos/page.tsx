"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Search,
  Plus,
  Minus,
  Filter,
  Tag,
  Star,
  UserPlus,
  Pencil,
  ScanLine,
  Receipt,
} from "lucide-react"
import { getCustomers, getCategories, createSale } from "@/lib/actions"
import { getProductsWithStock, getPriceListsForPOS, getActivePromotionsForPOS } from "@/lib/inventory-actions"
import { getWarehouseForSite } from "@/lib/site-actions"
import { getPOSBootstrap } from "@/lib/pos-bootstrap"
import { useSite } from "@/lib/site-context"
import { toast } from "@/components/ui/use-toast"
import { cn, formatCurrency } from "@/lib/utils"
import { NewContactDialog } from "@/components/pos/new-contact-dialog"
import { EditLineDialog, type CartLine } from "@/components/pos/edit-line-dialog"
import { PaymentDialog, type PaymentResult } from "@/components/pos/payment-dialog"
import { OpenShiftDialog } from "@/components/pos/open-shift-dialog"
import { CloseShiftDialog } from "@/components/pos/close-shift-dialog"
import { CashMovementDialog } from "@/components/pos/cash-movement-dialog"
import { TabBar } from "@/components/pos/tab-bar"
import { SuspendedPanel } from "@/components/pos/suspended-panel"
import { ReceiptDialog } from "@/components/pos/receipt"
import { suspendSale } from "@/lib/suspended-actions"
import { getCurrentShift, type ShiftBalance } from "@/lib/shift-actions"
import { useAuth } from "@/lib/auth-context"
import { Store, LockKeyhole, Wallet, Pause, HandCoins } from "lucide-react"
import { ShiftReceivablesSheet } from "@/components/credit/shift-receivables-sheet"
import { getShiftReceivables } from "@/lib/actions"
import { Badge } from "@/components/ui/badge"

interface Product {
  product_id: string
  name: string
  code: string | null
  price: number
  wholesale_price: number | null
  stock_quantity: number
  tax_rate: number
  is_favorite: boolean
  description: string | null
  categories: { category_id: string; name: string } | null
}

interface PriceListOption {
  price_list_id: string
  name: string
  is_default: boolean
}

interface Customer {
  customer_id: string
  name: string
  id_number?: string | null
  allows_credit?: boolean
  is_walk_in?: boolean
}

interface TabState {
  id: string
  label: string
  cart: CartLine[]
  selectedCustomerId: string
  selectedPriceList: string
}

let tabCounter = 0
function makeTab(defaultCustomerId: string): TabState {
  tabCounter++
  return {
    id: `tab-${tabCounter}`,
    label: `Venta ${tabCounter}`,
    cart: [],
    selectedCustomerId: defaultCustomerId,
    selectedPriceList: "general",
  }
}

export default function POSPage() {
  const { currentSite } = useSite()
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [categories, setCategories] = useState<{ category_id: string; name: string }[]>([])
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [activeCategories, setActiveCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [warehouseError, setWarehouseError] = useState<string | null>(null)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [bootstrapReloadKey, setBootstrapReloadKey] = useState(0)
  const [processingSale, setProcessingSale] = useState(false)
  const [priceLists, setPriceLists] = useState<PriceListOption[]>([])
  const [priceMap, setPriceMap] = useState<Record<string, Record<string, number>>>({})
  const [promoMap, setPromoMap] = useState<Record<string, { name: string; discount: number }>>({})

  const [contactOpen, setContactOpen] = useState(false)
  const [editLine, setEditLine] = useState<CartLine | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  // Turnos de caja
  const [shift, setShift] = useState<ShiftBalance | null>(null)
  const [openShiftOpen, setOpenShiftOpen] = useState(false)
  const [closeShiftOpen, setCloseShiftOpen] = useState(false)
  const [movementOpen, setMovementOpen] = useState(false)
  const [receivablesOpen, setReceivablesOpen] = useState(false)
  const [shiftReceivablesCount, setShiftReceivablesCount] = useState(0)
  const [receivablesRefreshKey, setReceivablesRefreshKey] = useState(0)

  const [suspendedOpen, setSuspendedOpen] = useState(false)
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)

  // Multi-tab state
  const defaultCustomerRef = useRef("")
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeTabId, setActiveTabId] = useState("")
  const [closeConfirm, setCloseConfirm] = useState<string | null>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const cart = activeTab?.cart ?? []
  const selectedCustomerId = activeTab?.selectedCustomerId ?? ""
  const selectedPriceList = activeTab?.selectedPriceList ?? "general"

  const updateTab = useCallback((updater: (tab: TabState) => TabState) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? updater(t) : t)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  const setCart = useCallback(
    (fn: CartLine[] | ((prev: CartLine[]) => CartLine[])) => {
      updateTab((t) => ({
        ...t,
        cart: typeof fn === "function" ? fn(t.cart) : fn,
      }))
    },
    [updateTab],
  )

  const setSelectedCustomerId = useCallback(
    (id: string) => updateTab((t) => ({ ...t, selectedCustomerId: id })),
    [updateTab],
  )

  const setSelectedPriceList = useCallback(
    (val: string) => updateTab((t) => ({ ...t, selectedPriceList: val })),
    [updateTab],
  )

  const siteId = currentSite?.site_id ?? null

  async function refreshShift(sid: string | null) {
    if (!sid) {
      setShift(null)
      setShiftReceivablesCount(0)
      return null
    }
    const current = await getCurrentShift(sid)
    setShift(current)
    // Piggyback: recuenta fiados abiertos del turno.
    if (current?.shift_id) {
      getShiftReceivables(current.shift_id)
        .then((r) => setShiftReceivablesCount(r.success ? r.sales.length : 0))
        .catch(() => setShiftReceivablesCount(0))
    } else {
      setShiftReceivablesCount(0)
    }
    return current
  }

  async function refreshData(whId: string | null) {
    const [productsData, customersData, categoriesData] = await Promise.all([
      getProductsWithStock(whId, { onlyRelevant: true }),
      getCustomers(),
      getCategories(),
    ])
    const mapped = (productsData as any[]).map((p) => ({
      ...p,
      stock_quantity: p.is_service ? 9999 : (p.warehouseStock ?? 0),
    }))
    setProducts(mapped as Product[])
    setCustomers(customersData)
    setCategories(categoriesData)
    return customersData
  }

  useEffect(() => {
    // No dispares carga sin sede resuelta. useSite() aún bootstrapeando →
    // loading queda en true (estado inicial) y se muestra "Cargando…".
    if (!siteId) return
    const sid = siteId // narrow para el closure de init()

    let cancelled = false
    async function init() {
      setLoading(true)
      setWarehouseError(null)
      setProductsError(null)
      setShiftError(null)

      // 1 sola llamada HTTP consolidada: elimina el waterfall de 7 Server
      // Actions secuenciales que Next.js serializa cuando usan cookies.
      // Ver lib/pos-bootstrap.ts + lib/pos-bootstrap-queries.ts.
      const boot = await getPOSBootstrap(sid)
      if (cancelled) return

      // Bloqueante duro #1: sin bodega no se puede vender.
      if (!boot.warehouse_id) {
        setWarehouseError(
          boot.errors.warehouse ||
            "Esta sede no tiene bodega asignada. Contacta al administrador para asignar una bodega principal antes de vender.",
        )
        setWarehouseId(null)
        setLoading(false)
        return
      }
      setWarehouseId(boot.warehouse_id)

      // Bloqueante duro #2: sin catálogo de productos no se puede vender.
      // Estado de error explícito con botón de reintentar en el render.
      if (boot.errors.products) {
        setProductsError(boot.errors.products)
        setLoading(false)
        return
      }

      // Shift: distinguir null-por-ausencia (turno cerrado) vs null-por-error
      // (no pudimos verificar). El segundo caso es riesgoso porque el vendedor
      // podría abrir un turno duplicado creyendo que no hay ninguno.
      setShift(boot.shift)
      if (boot.errors.shift) {
        setShiftError(boot.errors.shift)
      }

      const productsData = boot.products
      const customersData = boot.customers

      const mapped = (productsData as any[]).map((p) => ({
        ...p,
        stock_quantity: p.is_service ? 9999 : (p.warehouseStock ?? 0),
      }))
      setProducts(mapped as Product[])
      setCustomers(customersData)
      setCategories(boot.categories)
      setPriceLists(boot.priceLists.lists)
      setPriceMap(boot.priceLists.priceMap)
      setPromoMap(boot.promotions.promoMap)

      // Customers puede haber degradado a []: fallback "Consumidor final".
      // Si no está en la lista (por error), tab arranca sin cliente por
      // default y el vendedor tiene que elegir uno explícito.
      const defaultCustomer =
        customersData.find((c: any) => c.name === "Consumidor final") ||
        customersData.find((c: any) => c.name === "Walk-in Customer")
      const dcId = defaultCustomer?.customer_id ?? ""
      defaultCustomerRef.current = dcId
      const firstTab = makeTab(dcId)
      setTabs([firstTab])
      setActiveTabId(firstTab.id)
      setLoading(false)

      // Toast informativo por piezas secundarias que degradaron.
      const softErrors: string[] = []
      if (boot.errors.customers) softErrors.push(`clientes (${boot.errors.customers})`)
      if (boot.errors.categories) softErrors.push(`categorías (${boot.errors.categories})`)
      if (boot.errors.priceLists) softErrors.push(`listas de precios (${boot.errors.priceLists})`)
      if (boot.errors.promotions) softErrors.push(`promociones (${boot.errors.promotions})`)
      if (softErrors.length > 0) {
        toast({
          variant: "destructive",
          title: "Algunos datos no cargaron",
          description: softErrors.join("; ") + ". El POS funciona pero refrescá si algo falla.",
        })
      }

      // Piggyback fiados abiertos del turno (no bloquea render del POS).
      if (boot.shift?.shift_id) {
        getShiftReceivables(boot.shift.shift_id)
          .then((r) => {
            if (!cancelled) setShiftReceivablesCount(r.success ? r.sales.length : 0)
          })
          .catch(() => {
            if (!cancelled) setShiftReceivablesCount(0)
          })
      } else {
        setShiftReceivablesCount(0)
      }
    }
    init()
    return () => {
      // Guarda anti stale-closure: si el effect se re-ejecuta (cambio de sede)
      // antes de que el run anterior termine sus awaits, marcamos cancelled
      // para que ese run no sobreescriba estado con datos de la sede vieja.
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, bootstrapReloadKey])

  // --- Tab management ---
  const addTab = () => {
    const newTab = makeTab(defaultCustomerRef.current)
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const requestCloseTab = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab && tab.cart.length > 0) {
      setCloseConfirm(tabId)
    } else {
      doCloseTab(tabId)
    }
  }

  const doCloseTab = (tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId)
      if (next.length === 0) {
        const fresh = makeTab(defaultCustomerRef.current)
        setActiveTabId(fresh.id)
        return [fresh]
      }
      if (activeTabId === tabId) {
        const closedIdx = prev.findIndex((t) => t.id === tabId)
        const newIdx = Math.min(closedIdx, next.length - 1)
        setActiveTabId(next[newIdx].id)
      }
      return next
    })
    setCloseConfirm(null)
  }

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        !searchTerm ||
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.code || "").toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCategory =
        activeCategories.length === 0 ||
        (p.categories && activeCategories.includes(p.categories.category_id))
      return matchesSearch && matchesCategory
    })
  }, [products, searchTerm, activeCategories])

  const resolvePrice = (product: Product): number => {
    if (selectedPriceList === "mayorista") {
      return Number(product.wholesale_price ?? product.price)
    }
    if (selectedPriceList !== "general") {
      const listPrices = priceMap[selectedPriceList]
      if (listPrices && listPrices[product.product_id] != null) {
        return listPrices[product.product_id]
      }
    }
    return Number(product.price)
  }

  const addToCart = (product: Product) => {
    if (product.stock_quantity <= 0) return
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.product_id)
      if (existing) {
        if (existing.quantity >= product.stock_quantity) {
          toast({
            title: "Sin stock",
            description: `No hay más unidades de ${product.name}.`,
            variant: "destructive",
          })
          return prev
        }
        return prev.map((i) =>
          i.product_id === product.product_id ? { ...i, quantity: i.quantity + 1 } : i,
        )
      }
      const base = resolvePrice(product)
      const tax = Number(product.tax_rate) || 0
      const promo = promoMap[product.product_id]
      return [
        ...prev,
        {
          product_id: product.product_id,
          name: product.name,
          code: product.code,
          base_price: base,
          tax_rate: tax,
          price: base * (1 + tax / 100),
          discount: promo?.discount ?? 0,
          quantity: 1,
          stock_quantity: product.stock_quantity,
          description: product.description || product.name,
        },
      ]
    })
  }

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product_id !== productId) return i
          const next = i.quantity + delta
          if (next <= 0) return null
          if (next > i.stock_quantity) {
            toast({ title: "Sin stock", description: `Máximo alcanzado para ${i.name}.`, variant: "destructive" })
            return i
          }
          return { ...i, quantity: next }
        })
        .filter(Boolean) as CartLine[],
    )
  }

  const removeLine = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId))
  }

  const lineTotal = (i: CartLine) => i.price * i.quantity * (1 - i.discount / 100)

  const total = useMemo(() => cart.reduce((s, i) => s + lineTotal(i), 0), [cart])
  const itemCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart])

  const openEdit = (line: CartLine) => {
    setEditLine(line)
    setEditOpen(true)
  }

  const saveLine = (updated: CartLine) => {
    setCart((prev) => prev.map((i) => (i.product_id === updated.product_id ? updated : i)))
  }

  const handleContactCreated = (customer: any) => {
    setCustomers((prev) => [...prev, customer])
    setSelectedCustomerId(customer.customer_id)
  }

  const toggleCategory = (id: string) => {
    setActiveCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  const handleSuspend = async () => {
    if (cart.length === 0) return
    if (!siteId) return
    const items = cart.map((i) => ({
      product_id: i.product_id,
      name: i.name,
      code: i.code,
      quantity: i.quantity,
      base_price: i.base_price,
      tax_rate: i.tax_rate,
      price: i.price,
      discount: i.discount,
    }))
    const result = await suspendSale({
      site_id: siteId,
      customer_id: selectedCustomerId || null,
      price_list: selectedPriceList,
      items,
    })
    if (result.success) {
      toast({ title: "Venta suspendida", description: result.message })
      setCart([])
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  const handleResumeSale = (sale: { customer_id: string | null; price_list: string; items: any[] }) => {
    const newTab = makeTab(sale.customer_id || defaultCustomerRef.current)
    newTab.selectedPriceList = sale.price_list || "general"
    newTab.cart = sale.items.map((i: any) => ({
      product_id: i.product_id,
      name: i.name,
      code: i.code,
      base_price: i.base_price,
      tax_rate: i.tax_rate,
      price: i.price,
      discount: i.discount || 0,
      quantity: i.quantity,
      stock_quantity: 9999,
      description: i.name,
    }))
    if (sale.customer_id) {
      newTab.selectedCustomerId = sale.customer_id
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const startSale = () => {
    if (cart.length === 0) {
      toast({ title: "Factura vacía", description: "Agrega productos para vender.", variant: "destructive" })
      return
    }
    if (!selectedCustomerId) {
      toast({ title: "Sin cliente", description: "Selecciona un cliente.", variant: "destructive" })
      return
    }
    if (!shift) {
      toast({
        title: "Turno cerrado",
        description: "Debes abrir un turno de caja antes de vender.",
        variant: "destructive",
      })
      setOpenShiftOpen(true)
      return
    }
    setPaymentOpen(true)
  }

  const confirmPayment = async (payment: PaymentResult) => {
    setProcessingSale(true)
    const items = cart.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: lineTotal(i) / i.quantity,
      discount: i.discount,
    }))
    const result = await createSale(
      selectedCustomerId,
      total,
      items,
      {
        payment_method: payment.payment_method,
        amount_received: payment.amount_received,
        seller: payment.seller,
        notes: payment.notes,
        is_on_account: payment.is_on_account,
        initial_payment: payment.initial_payment,
      },
      { site_id: siteId, warehouse_id: warehouseId, shift_id: shift?.shift_id ?? null },
      selectedPriceList,
    )
    setProcessingSale(false)

    if (result.success) {
      const saleId = (result as any).sale_id as string | undefined
      toast({
        title: payment.is_on_account ? "Venta a crédito registrada" : "Venta realizada",
        description: payment.is_on_account
          ? payment.initial_payment && payment.initial_payment > 0
            ? `Abono inicial de ${payment.initial_payment.toLocaleString("es-CO")} recibido; saldo por cobrar registrado.`
            : "Saldo por cobrar registrado."
          : `Pago con ${payment.payment_method} registrado.`,
      })
      setCart([])
      setPaymentOpen(false)
      if (saleId) {
        setReceiptSaleId(saleId)
        setReceiptOpen(true)
      }
      await refreshData(warehouseId)
      await refreshShift(siteId)
    } else {
      toast({ title: "Error en la venta", description: result.message, variant: "destructive" })
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Cargando punto de venta...</p>
      </div>
    )
  }

  if (warehouseError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold text-destructive">
          No se puede iniciar el punto de venta
        </p>
        <p className="max-w-md text-sm text-muted-foreground">{warehouseError}</p>
      </div>
    )
  }

  if (productsError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-semibold text-destructive">
          No se pudo cargar el catálogo
        </p>
        <p className="max-w-md text-sm text-muted-foreground">{productsError}</p>
        <Button onClick={() => setBootstrapReloadKey((k) => k + 1)}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {shiftError && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-sm">
          <span className="text-amber-800 dark:text-amber-200">
            <b>No pudimos verificar tu turno.</b> {shiftError}. Refrescá antes
            de abrir un turno nuevo (podría haber uno abierto que no vimos).
          </span>
        </div>
      )}

      {/* Barra de turno de caja */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">Sede:</span>
          <span className="text-sm font-semibold text-foreground">{currentSite?.name ?? "Sin sede"}</span>
        </div>

        <div className="h-5 w-px bg-border" aria-hidden />

        {shift ? (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Turno abierto
              </span>
              <span className="text-xs text-muted-foreground">
                Recibido hoy: <span className="font-semibold text-foreground">{formatCurrency(shift.total_sales)}</span>
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Efectivo: <span className="font-medium text-foreground">{formatCurrency(shift.cash_sales)}</span>
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Transferencia:{" "}
                <span className="font-medium text-foreground">{formatCurrency(shift.transfer_sales)}</span>
              </span>
            </div>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReceivablesOpen(true)}
                disabled={!shift}
              >
                <HandCoins className="mr-1.5 h-4 w-4" />
                Fiados del turno
                {shiftReceivablesCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                    {shiftReceivablesCount}
                  </Badge>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setMovementOpen(true)}>
                <Wallet className="mr-1.5 h-4 w-4" />
                Movimiento
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setCloseShiftOpen(true)}>
                Cerrar turno
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="h-3 w-3" />
              Turno cerrado
            </span>
            <span className="text-xs text-muted-foreground">Abre un turno para comenzar a vender</span>
            <div className="ml-auto">
              <Button size="sm" onClick={() => setOpenShiftOpen(true)}>
                Abrir turno
              </Button>
            </div>
          </>
        )}
      </div>

    <div className="flex flex-col gap-4 lg:h-[calc(100vh-14rem)] lg:flex-row">
      {/* Left: product catalog */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar productos"
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                Categorías
                {activeCategories.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                    {activeCategories.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Filtrar por categoría</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {categories.map((cat) => (
                <DropdownMenuCheckboxItem
                  key={cat.category_id}
                  checked={activeCategories.includes(cat.category_id)}
                  onCheckedChange={() => toggleCategory(cat.category_id)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {cat.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="icon" aria-label="Escanear código">
            <ScanLine className="h-4 w-4" />
          </Button>
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto pr-1">
          {filteredProducts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No se encontraron productos.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map((product) => {
                const inCart = cart.find((i) => i.product_id === product.product_id)
                const outOfStock = product.stock_quantity <= 0
                return (
                  <button
                    key={product.product_id}
                    type="button"
                    onClick={() => addToCart(product)}
                    disabled={outOfStock}
                    className={cn(
                      "group relative flex flex-col rounded-xl border bg-card p-3 text-left transition-all",
                      outOfStock
                        ? "cursor-not-allowed opacity-60"
                        : "hover:border-primary hover:shadow-sm",
                      inCart && "border-primary ring-1 ring-primary",
                    )}
                  >
                    {/* Top row: code + favorite */}
                    <div className="flex items-start justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{product.code}</span>
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-md",
                          product.is_favorite ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                        )}
                      >
                        <Star className="h-4 w-4" fill={product.is_favorite ? "currentColor" : "none"} />
                      </span>
                    </div>

                    {/* Quantity badge */}
                    {inCart && (
                      <span className="absolute right-2 top-9 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                        {inCart.quantity}
                      </span>
                    )}

                    {/* Foto del producto — misma imagen del catálogo web */}
                    <div className="relative my-2 aspect-square w-full overflow-hidden rounded-lg bg-muted">
                      {product.image_url ? (
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          fill
                          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Tag className="h-10 w-10 text-muted-foreground/40" strokeWidth={1.5} />
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="text-center">
                      {outOfStock ? (
                        <p className="text-xs font-medium text-destructive">Agotado</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Inv. {product.stock_quantity}</p>
                      )}
                      <p className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight text-foreground">
                        {product.name}
                      </p>
                      <p className="mt-1 font-semibold text-foreground">{formatCurrency(resolvePrice(product))}</p>
                      {promoMap[product.product_id] && (
                        <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                          -{promoMap[product.product_id].discount}% {promoMap[product.product_id].name}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: invoice panel */}
      <div className="flex w-full flex-col rounded-xl border bg-card lg:w-96">
        {/* Tab bar */}
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id,
            label: t.label,
            itemCount: t.cart.reduce((s, i) => s + i.quantity, 0),
          }))}
          activeId={activeTabId}
          onSelect={setActiveTabId}
          onAdd={addTab}
          onClose={requestCloseTab}
        />

        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Receipt className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Factura de venta</h2>
        </div>

        <div className="space-y-4 border-b px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">Lista de precio</label>
              <Select
                value={selectedPriceList}
                onValueChange={(val) => {
                  setSelectedPriceList(val)
                  setCart((prev) =>
                    prev.map((item) => {
                      const product = products.find((p) => p.product_id === item.product_id)
                      if (!product) return item
                      let base: number
                      if (val === "mayorista") {
                        base = Number(product.wholesale_price ?? product.price)
                      } else if (val !== "general" && priceMap[val]?.[product.product_id] != null) {
                        base = priceMap[val][product.product_id]
                      } else {
                        base = Number(product.price)
                      }
                      const tax = Number(product.tax_rate) || 0
                      return { ...item, base_price: base, price: base * (1 + tax / 100) }
                    }),
                  )
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="mayorista">Mayorista</SelectItem>
                  {priceLists.map((pl) => (
                    <SelectItem key={pl.price_list_id} value={pl.price_list_id}>
                      {pl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">Numeración</label>
              <Select defaultValue="principal">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="principal">Principal</SelectItem>
                  <SelectItem value="secundaria">Secundaria</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Cliente</label>
            <div className="flex gap-2">
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.customer_id} value={c.customer_id}>
                      {c.name}
                      {c.id_number ? ` (${c.id_number})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setContactOpen(true)}
                aria-label="Crear cliente"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {cart.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Selecciona productos para agregarlos a la factura.
            </div>
          ) : (
            <ul className="space-y-1">
              {cart.map((item) => (
                <li
                  key={item.product_id}
                  className="group flex items-center gap-2 rounded-lg px-1 py-2 hover:bg-muted/60"
                >
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.price)} | {item.code}
                      {item.discount > 0 && (
                        <span className={promoMap[item.product_id] ? "text-amber-600 dark:text-amber-400" : ""}>
                          {" "}| -{item.discount}%{promoMap[item.product_id] ? ` ${promoMap[item.product_id].name}` : ""}
                        </span>
                      )}
                    </p>
                  </button>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => changeQty(item.product_id, -1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center text-sm">{item.quantity}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => changeQty(item.product_id, 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="w-20 text-right text-sm font-semibold text-foreground">
                      {formatCurrency(lineTotal(item))}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => openEdit(item)}
                      aria-label="Editar línea"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer: sell */}
        <div className="border-t p-4">
          <Button
            className="h-14 w-full justify-between px-5 text-base font-semibold"
            onClick={startSale}
            disabled={cart.length === 0}
          >
            <span>Vender</span>
            <span>{formatCurrency(total)}</span>
          </Button>
          <div className="mt-2 flex items-center justify-between px-1 text-sm">
            <span className="text-muted-foreground">
              {itemCount} {itemCount === 1 ? "Producto" : "Productos"}
            </span>
            <div className="flex items-center gap-3">
              {cart.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleSuspend}
                    className="flex items-center gap-1 font-medium text-amber-600 hover:underline dark:text-amber-400"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Suspender
                  </button>
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="font-medium text-primary hover:underline"
                  >
                    Cancelar
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSuspendedOpen(true)}
                className="font-medium text-muted-foreground hover:text-foreground hover:underline"
              >
                Suspendidas
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <NewContactDialog open={contactOpen} onOpenChange={setContactOpen} onCreated={handleContactCreated} />
      <EditLineDialog
        line={editLine}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={saveLine}
        onDelete={removeLine}
      />
      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={total}
        processing={processingSale}
        onConfirm={confirmPayment}
        customer={(() => {
          const c = customers.find((x: Customer) => x.customer_id === selectedCustomerId)
          if (!c) return null
          return {
            customer_id: c.customer_id,
            name: c.name,
            allows_credit: c.allows_credit ?? true,
            is_walk_in: c.is_walk_in ?? false,
          }
        })()}
        hasOpenShift={!!shift}
      />

      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        saleId={receiptSaleId}
      />

      <SuspendedPanel
        open={suspendedOpen}
        onOpenChange={setSuspendedOpen}
        siteId={siteId}
        onResume={handleResumeSale}
      />

      {/* Close tab confirmation */}
      <Dialog open={!!closeConfirm} onOpenChange={(open) => !open && setCloseConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar pestaña</DialogTitle>
            <DialogDescription>
              Esta pestaña tiene productos en la factura. Si la cierras, se perderán los productos agregados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseConfirm(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => closeConfirm && doCloseTab(closeConfirm)}>
              Cerrar pestaña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {siteId && (
        <OpenShiftDialog
          open={openShiftOpen}
          onOpenChange={setOpenShiftOpen}
          siteId={siteId}
          siteName={currentSite?.name ?? ""}
          warehouseId={warehouseId}
          openedBy={user?.email ?? null}
          onOpened={() => refreshShift(siteId)}
        />
      )}

      {shift && (
        <>
          <CloseShiftDialog
            open={closeShiftOpen}
            onOpenChange={setCloseShiftOpen}
            balance={shift}
            closedBy={user?.email ?? null}
            onClosed={() => refreshShift(siteId)}
            onNewMovement={() => {
              setCloseShiftOpen(false)
              setMovementOpen(true)
            }}
          />
          <CashMovementDialog
            open={movementOpen}
            onOpenChange={setMovementOpen}
            shiftId={shift.shift_id}
            onSaved={() => refreshShift(siteId)}
          />
          <ShiftReceivablesSheet
            open={receivablesOpen}
            onOpenChange={setReceivablesOpen}
            shiftId={shift.shift_id}
            refreshKey={receivablesRefreshKey}
            onChange={() => {
              setReceivablesRefreshKey((k) => k + 1)
              refreshShift(siteId)
            }}
          />
        </>
      )}
    </div>
    </div>
  )
}
