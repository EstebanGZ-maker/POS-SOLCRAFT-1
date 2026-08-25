"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  LogOut,
  Menu,
  X,
  Users,
  Package,
  ShoppingCart,
  Receipt,
  Boxes,
  Warehouse,
  ClipboardList,
  Tags,
  Percent,
  Settings,
  Settings2,
  BarChart3,
  Send,
  Building2,
  Calculator,
  ChevronDown,
  Barcode,
  ScrollText,
  UserCog,
  PackageCheck,
  ShoppingBag,
  ClipboardCheck,
  HandCoins,
  Truck,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { useSite } from "@/lib/site-context"
import type { ModuleKey } from "@/lib/permissions"

type NavItem = { name: string; href: string; icon: any; permission?: ModuleKey }
type NavGroup = {
  label: string
  icon: any
  items: NavItem[]
  centralOnly?: boolean
  siteOnly?: boolean
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { currentSite } = useSite()
  const { hasPermission } = useAuth()
  const isCentral = currentSite?.is_central ?? false

  const canSee = (perm?: ModuleKey) => (perm ? hasPermission(perm) : true)

  const singleLinks: NavItem[] = [
    { name: "Panel", href: "/dashboard", icon: Home, permission: "dashboard" },
    { name: "Administración de sedes", href: "/admin", icon: Building2, permission: "sites_admin" },
    ...(!isCentral ? [{ name: "Punto de venta", href: "/pos", icon: ShoppingCart, permission: "pos" as ModuleKey }] : []),
    { name: "Pedidos web", href: "/web-orders", icon: ShoppingBag, permission: "web_orders" },
    { name: "Usuarios", href: "/users", icon: UserCog, permission: "users_admin" },
    { name: "Configuración", href: "/settings/receipt", icon: Settings, permission: "settings" },
  ]

  const groups: NavGroup[] = [
    {
      label: "Inventario",
      icon: Boxes,
      items: [
        { name: "Productos y servicios", href: "/inventory/products", icon: Package, permission: "inventory" },
        { name: "Importar productos", href: "/inventory/products/import", icon: Upload, permission: "inventory" },
        { name: "Códigos de barra", href: "/inventory/barcodes", icon: Barcode, permission: "inventory" },
        { name: "Valor de inventario", href: "/inventory/value", icon: BarChart3, permission: "inventory" },
        { name: "Ajustes de inventario", href: "/inventory/adjustments", icon: ClipboardList, permission: "adjustments" },
        { name: "Bodegas", href: "/inventory/warehouses", icon: Warehouse, permission: "warehouses" },
        { name: "Listas de precios", href: "/inventory/price-lists", icon: Tags, permission: "price_lists" },
        { name: "Promociones", href: "/inventory/promotions", icon: Percent, permission: "promotions" },
        { name: "Gestión de inventario", href: "/inventory/management", icon: Settings2, permission: "inventory_management" },
        { name: "Kardex", href: "/inventory/kardex", icon: ScrollText, permission: "kardex" },
        { name: "Enviar mercancía", href: "/transfers/send", icon: Send, permission: "transfers_send" },
        { name: "Recibir mercancía", href: "/transfers/receive", icon: PackageCheck, permission: "transfers_receive" },
        { name: "Reconciliar traslados", href: "/transfers/reconcile", icon: ClipboardCheck, permission: "transfers_reconcile" },
      ],
    },
    {
      label: "Bodega central",
      icon: Warehouse,
      centralOnly: true,
      items: [
        { name: "Entradas y envíos", href: "/central", icon: Send, permission: "transfers_send" },
        { name: "Historial de envíos", href: "/central/transfers", icon: Truck, permission: "transfers_send" },
      ],
    },
    {
      label: "Contabilidad",
      icon: Calculator,
      siteOnly: true,
      items: [
        { name: "Movimientos y reportes", href: "/accounting", icon: Calculator, permission: "accounting" },
        { name: "Ventas", href: "/sales", icon: Receipt, permission: "sales" },
        { name: "Cuentas por cobrar", href: "/receivables", icon: HandCoins, permission: "receivables" },
        { name: "Clientes", href: "/customers", icon: Users, permission: "customers" },
      ],
    },
  ]

  const visibleGroups = groups.filter((g) => {
    if (g.centralOnly && !isCentral) return false
    if (g.siteOnly && isCentral) return false
    return true
  })

  const [open, setOpen] = useState<Record<string, boolean>>({
    Inventario: true,
    "Bodega central": true,
    Contabilidad: true,
  })

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/")

  // Cuando estamos en /pos (ruta crítica para el vendedor, sensible a
  // cold-start), desactivamos el prefetch de Next.js del sidebar para no
  // competir por lambda/bandwidth durante el bootstrap. En el resto de
  // rutas mantenemos el prefetch por default. Trade-off aceptado: la
  // primera navegación desde /pos a otra ruta tarda ~200-500ms más, pero
  // el arranque del POS libera contención de ~9 RSC prefetches paralelos.
  const posActive = pathname === "/pos" || pathname.startsWith("/pos/")
  const linkPrefetch: false | undefined = posActive ? false : undefined

  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {singleLinks.filter((item) => canSee(item.permission)).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={linkPrefetch}
          onClick={onNavigate}
          className={cn(
            "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
            isActive(item.href)
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <item.icon className="mr-3 h-5 w-5 shrink-0" />
          {item.name}
        </Link>
      ))}

      {visibleGroups.map((group) => {
        const isOpen = open[group.label]
        const visibleItems = group.items.filter((item) => canSee(item.permission))
        if (visibleItems.length === 0) return null
        return (
          <div key={group.label} className="pt-2">
            <button
              type="button"
              onClick={() => setOpen((p) => ({ ...p, [group.label]: !p[group.label] }))}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              <span className="flex items-center gap-2">
                <group.icon className="h-4 w-4" />
                {group.label}
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen ? "" : "-rotate-90")} />
            </button>
            {isOpen && (
              <div className="mt-1 space-y-1">
                {visibleItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={linkPrefetch}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center rounded-md py-2 pl-9 pr-3 text-sm font-medium transition-colors",
                      isActive(item.href)
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <item.icon className="mr-2 h-4 w-4 shrink-0" />
                    {item.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function DashboardSidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black bg-opacity-25 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-card transform border-r transition-transform duration-300 ease-in-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Boxes className="h-5 w-5 text-primary" /> POS Multisede
          </h2>
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks onNavigate={() => setSidebarOpen(false)} />
        </div>
        <div className="border-t p-4">
          <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={handleSignOut}>
            <LogOut className="mr-3 h-5 w-5" />
            Cerrar sesión
          </Button>
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-72 lg:flex-col">
        <div className="flex min-h-0 flex-grow flex-col border-r bg-card">
          <div className="flex h-16 shrink-0 items-center border-b px-5">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Boxes className="h-6 w-6 text-primary" /> POS Multisede
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NavLinks />
          </div>
          <div className="shrink-0 border-t p-4">
            <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={handleSignOut}>
              <LogOut className="mr-3 h-5 w-5" />
              Cerrar sesión
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu button */}
      <div className="lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-4 top-3 z-40"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    </>
  )
}
