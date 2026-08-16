// Catálogo de módulos del sistema y permisos por defecto por rol.
// La fuente de verdad de qué permisos tiene un usuario es user_profiles.permissions[]
// en la DB. Este archivo define las etiquetas UI y los defaults al crear usuarios.

export type ModuleKey =
  | "dashboard"
  | "pos"
  | "sales"
  | "customers"
  | "inventory"
  | "adjustments"
  | "warehouses"
  | "price_lists"
  | "promotions"
  | "kardex"
  | "inventory_management"
  | "transfers_send"
  | "transfers_receive"
  | "transfers_reconcile"
  | "accounting"
  | "receivables"
  | "sites_admin"
  | "users_admin"
  | "settings"
  | "web_orders"

export type ModuleDef = {
  key: ModuleKey
  label: string
  description: string
  group: "general" | "inventario" | "operaciones" | "administracion"
  adminOnly?: boolean
}

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Panel principal", description: "Vista general y KPIs.", group: "general" },
  { key: "pos", label: "Punto de venta", description: "Registrar ventas en el POS.", group: "general" },
  { key: "sales", label: "Historial de ventas", description: "Ver y anular ventas.", group: "general" },
  { key: "customers", label: "Clientes", description: "Gestionar clientes.", group: "general" },

  { key: "inventory", label: "Productos", description: "Ver productos, códigos de barra, valor de inventario.", group: "inventario" },
  { key: "inventory_management", label: "Gestión de inventario", description: "Operaciones masivas sobre catálogo.", group: "inventario" },
  { key: "adjustments", label: "Ajustes de inventario", description: "Registrar ajustes de stock.", group: "inventario" },
  { key: "warehouses", label: "Bodegas", description: "Crear y editar bodegas.", group: "inventario" },
  { key: "price_lists", label: "Listas de precios", description: "Definir listas de precios.", group: "inventario" },
  { key: "promotions", label: "Promociones", description: "Crear promociones y descuentos.", group: "inventario" },
  { key: "kardex", label: "Kardex", description: "Consultar movimientos de stock.", group: "inventario" },

  { key: "web_orders", label: "Pedidos web", description: "Gestionar pedidos del catálogo público.", group: "operaciones" },
  { key: "transfers_send", label: "Enviar traslados", description: "Enviar mercancía entre sedes.", group: "operaciones" },
  { key: "transfers_receive", label: "Recibir mercancía", description: "Recibir traslados en la sede destino.", group: "operaciones" },
  { key: "transfers_reconcile", label: "Reconciliar traslados", description: "Cerrar pendientes y dar de baja faltantes.", group: "operaciones" },
  { key: "accounting", label: "Contabilidad", description: "Movimientos y reportes contables.", group: "operaciones" },
  { key: "receivables", label: "Cuentas por cobrar", description: "Ventas a crédito con saldo pendiente.", group: "operaciones" },

  { key: "sites_admin", label: "Administrar sedes", description: "Crear y editar sedes.", group: "administracion", adminOnly: true },
  { key: "users_admin", label: "Gestión de usuarios", description: "Crear, editar y asignar permisos a usuarios.", group: "administracion", adminOnly: true },
  { key: "settings", label: "Configuración", description: "Datos del negocio y plantilla de factura.", group: "administracion", adminOnly: true },
]

export const MODULE_MAP: Record<ModuleKey, ModuleDef> = MODULES.reduce(
  (acc, m) => ({ ...acc, [m.key]: m }),
  {} as Record<ModuleKey, ModuleDef>,
)

export const GROUP_LABELS: Record<ModuleDef["group"], string> = {
  general: "General",
  inventario: "Inventario",
  operaciones: "Operaciones",
  administracion: "Administración",
}

export type UserRole = "admin" | "contador" | "encargado" | "vendedor"

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, ModuleKey[]> = {
  admin: MODULES.map((m) => m.key),
  // El contador reconcilia pérdidas: dar de baja faltantes es un acto contable
  contador: [
    "dashboard", "sales", "customers", "inventory", "kardex", "accounting",
    "receivables", "transfers_reconcile",
  ],
  encargado: [
    "dashboard", "pos", "sales", "customers", "inventory", "adjustments",
    "price_lists", "promotions", "kardex", "transfers_send", "transfers_receive",
    "accounting", "receivables", "web_orders",
  ],
  vendedor: ["dashboard", "pos", "sales", "customers", "receivables"],
}

export function isGlobalRole(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "contador"
}
