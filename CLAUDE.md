# CLAUDE.md — Contexto del proyecto POS-SOLCRAFT (base de trabajo actual)

## Qué es este proyecto

Sistema **POS Multisede** para un almacén de ropa en Colombia (marca Taiwy). Modelo de negocio: una **bodega central** recibe mercancía (entradas) y la despacha por envíos/traslados a las sedes de venta; cada sede vende por POS con turnos de caja.

**Este proyecto reemplaza a `taiwy-pos` (Express + React + Docker, en `C:\Users\esteb\Downloads\taiwy-pos1.1\taiwy-pos`) como base de trabajo.** El proyecto anterior queda solo como referencia de reglas de negocio ya validadas (kardex, traslados con estados, arqueo de caja, mayoristas, reserva de campos DIAN).

**Directriz principal (se mantiene): el POS debe ser lo más parecido posible en funcionalidades a Alegra POS.** Al mejorar cualquier módulo, comparar contra el equivalente de Alegra antes de diseñar.

## Principios rectores

1. **`stock_movements` es la única fuente de verdad del inventario.** `product_stock` es un caché derivado. Ninguna operación toca el saldo sin escribir su movimiento en la MISMA transacción.
2. **Invariante del kardex:** para todo (producto, bodega), `SUM(stock_movements.quantity) = saldo actual`. Contando la bodega virtual de Tránsito. Verificar con `SELECT * FROM verify_kardex_integrity()` — debe devolver 0 filas.
3. **El servidor decide el precio, nunca el cliente.** El frontend propone; el RPC recalcula/valida contra el catálogo.
4. **El catálogo de productos es único y propiedad de la bodega central.** Un código identifica un modelo (no una prenda física). El código es inmutable.
5. **Toda operación con impacto en dinero o inventario corre bajo transacción con lock cuando hay concurrencia.**

## Roles y permisos

4 roles: `admin` (global), `contador` (global), `encargado` (por sede), `vendedor` (por sede). Tabla `user_profiles` con `role` + `site_id`. Trigger `on_auth_user_created` crea perfil automáticamente. Seguridad: sesión del usuario (JWT) + RLS + `role-guard.ts` como defensa en profundidad. Admin y contador tienen `site_id = NULL` (acceso global).

## Stack y estructura

- **Framework**: Next.js 15 (App Router) + React 19 + TypeScript. Generado y sincronizado con **v0.dev** (proyecto "Admin Dashboard Creation", desplegado en Vercel).
- **UI**: Tailwind CSS + shadcn/ui (`components/ui/`), lucide-react, sonner/toast, next-themes (claro/oscuro), recharts, jsbarcode (etiquetas de código de barras).
- **Backend**: **Supabase** (Postgres + Auth + Storage). Sin API propia: toda la lógica vive en **Server Actions** (`lib/*-actions.ts`) que usan `createServerSupabaseClient()` (`lib/supabase/server.ts`, con `@supabase/ssr` y cookies).
- **IA**: `app/api/analyze-product/route.ts` usa AI SDK (`ai`, modelo `google/gemini-2.5-flash` vía AI Gateway de Vercel) para analizar fotos/videos de prendas y extraer nombre, tipo, talla, color, precio sugerido (COP) y cantidad — alimenta el panel de ingreso de mercancía (`components/central/ai-ingress-panel.tsx`).
- **Datos por sede**: la sede activa se guarda en cookie `current_site_id` (`lib/site-actions.ts`) y se expone con `SiteProvider`/`useSite` (`lib/site-context.tsx`, SWR). Auth con `AuthProvider`/`useAuth` (`lib/auth-context.tsx`) + `ProtectedRoute`.
- **Ejecución local**: `pnpm install && pnpm dev` (si no hay pnpm: `npx pnpm install`). El `.env.local` ya existe con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` apuntando al proyecto de desarrollo. `next.config.mjs` ignora errores de ESLint y TypeScript en build — no confiarse del build como validación. La ruta de IA (`/api/analyze-product`) requiere `AI_GATEWAY_API_KEY` de Vercel; sin ella el resto de la app funciona igual.

## Supabase

- Proyecto de desarrollo: **EstebanGZ-maker's Project**, ref `nxszaxwsrtlofqimbfig`, región us-west-2, Postgres 17. Restaurado y activo desde el 16/07/2026. **Nota**: la instancia que usa el deploy de v0/Vercel es OTRA (interna de v0, no visible por MCP); este proyecto es la BD oficial de desarrollo local.
- **`scripts/*.sql` es la fuente de verdad del esquema**: `00_schema.sql` (18 tablas + índices + triggers), `01_functions.sql` (RPCs: `create_sale`, `void_sale`, `adjust_warehouse_stock`, `transfer_stock`, `verify_kardex_integrity`, etc.), `02_rls.sql`, `03_storage.sql`, `04_seed.sql`, **`05_merge_features.sql`** (Fase 1: `user_profiles`, `stock_movements`, `site_counters`, bodega Tránsito, saldos de apertura, campos mayorista/disponibilidad). Cualquier cambio de esquema: nueva migración vía Supabase + actualizar los scripts.
- RPCs: `create_sale` (venta atómica + kardex + numeración), `void_sale` (anulación + reversión stock), `adjust_warehouse_stock` (valida stock ≥ 0, escribe kardex), `transfer_stock` (con kardex), `verify_kardex_integrity`, `decrement_product_stock`, `next_product_code`, `get_low_stock_products`, `get_sales_summary`.
- Usuario de desarrollo: `admin@solcraft.dev` / `Solcraft2026*` (email confirmado por SQL; el signup normal exige confirmación por correo).

## Módulos (rutas en `app/`)

| Ruta | Módulo |
|---|---|
| `/dashboard` | Panel con KPIs, gráficas e insights (`lib/dashboard-actions.ts`) |
| `/admin` | Administración de sedes (CRUD sites; cada sede nueva crea bodega "Principal") |
| `/pos` | Punto de venta: grid de productos con stock de la bodega de la sede, favoritos, filtro por categorías, búsqueda, carrito con edición de línea, cliente rápido ("Nuevo contacto"), diálogo de pago, turnos de caja (abrir/cerrar/movimientos) |
| `/inventory/products` | Productos y servicios (form completo con foto, código, impuestos) |
| `/inventory/barcodes` | Códigos de barras / etiquetas (jsbarcode) |
| `/inventory/value` | Valor de inventario (cantidad × costo por bodega) |
| `/inventory/adjustments` | Ajustes de inventario (incrementar/disminuir con reversión al borrar) |
| `/inventory/warehouses` | Bodegas por sede |
| `/inventory/price-lists` | Listas de precios (default + adicionales, precio por producto) |
| `/inventory/promotions` | Promociones (% descuento, vigencia, por sede) — CRUD listo, **aún no se aplican en el POS** |
| `/inventory/management` | Categorías y gestión general |
| `/central` | Bodega central: ingreso de mercancía (manual o con IA) y envíos masivos a sedes (`createBulkTransfer`) |
| `/central/transfers` | Historial de traslados |
| `/inventory/kardex` | Kardex de inventario (movimientos de stock por producto/bodega/fecha) |
| `/users` | Gestión de usuarios (roles, sedes, activación) — solo admin |
| `/accounting` | Movimientos contables (ingresos/gastos por sede) y reportes |
| `/sales` | Historial de ventas |
| `/customers` | Clientes/contactos (con identificación, dirección, etc.) |
| `/login` | Autenticación Supabase (email + password) |

## Reglas de negocio implementadas

- **Stock por bodega**: `product_stock` (producto × bodega). El POS muestra/descuenta el stock de la bodega principal de la sede activa; los servicios (`is_service`) no manejan stock.
- **Venta** (`createSale` en `lib/actions.ts`): inserta `sales` + `sale_items`, descuenta stock vía RPC `adjust_warehouse_stock` (o `decrement_product_stock` si no hay bodega), escribe movimientos en `stock_movements` (kardex), asigna `numero` secuencial vía `site_counters`, y registra ingreso en `accounting_entries` con categoría "Ventas POS". Guarda método de pago, monto recibido, vendedor, notas, site/warehouse/shift. `sales.status` = 'active' | 'voided'. Anulación vía RPC `void_sale`.
- **Kardex**: tabla `stock_movements` es append-only, registra todo cambio de stock con tipo, referencia y usuario. Bodega virtual "Tránsito" (`is_system=true`) para mercancía en movimiento. Verificación de integridad: `SELECT * FROM verify_kardex_integrity()`.
- **Turnos de caja** (`lib/shift-actions.ts`): un turno abierto por sede. Efectivo esperado = base inicial + ventas en efectivo + ingresos manuales − egresos − reembolsos (`cash_movements`). Al cerrar se guarda contado, esperado y diferencia.
- **Ingreso de mercancía** (`ingressNewProduct`): genera código único secuencial `PREFIJO-TALLA-PRECIOmiles-NN` vía RPC `next_product_code` (ej. `CA-M-95-00`), crea producto + precio en lista default + stock en bodega central + gasto contable "Compra de mercancía". El código sirve también de barcode.
- **Traslados** (`createBulkTransfer`): envío desde una bodega a varias sedes a la vez; estado `completed` inmediato vía RPC `transfer_stock` (sin estados pendiente/en tránsito todavía).
- **Ajustes**: `receiveMerchandise` reutiliza los ajustes como entradas (`[Entrada]` en notas); borrar un ajuste revierte el stock.
- Productos con ventas no se eliminan: se desactivan (`deleteProductSafe`).
- Cliente por defecto: "Walk-in Customer" (seed) — **renombrar a "Consumidor final"** para paridad con Alegra.

## Convenciones

- UI y mensajes al usuario **en español**; código/identificadores en inglés (tablas y columnas en inglés snake_case — convención distinta al proyecto anterior, respetarla).
- Server Actions devuelven `{ success: boolean, message: string, ... }`.
- Tras mutaciones, `revalidatePath()` de las rutas afectadas.
- Moneda: pesos colombianos (COP), formateo en `lib/format.ts` / `formatCurrency`.
- Componentes de dominio en `components/<módulo>/`; primitivas shadcn en `components/ui/` (no modificarlas salvo necesidad).

## Deudas técnicas conocidas (priorizar al seguir el desarrollo)

1. ~~`createSale` no es atómico~~ **Resuelto (16/07/2026)**: la venta completa corre en la RPC `create_sale` (una transacción: sales + sale_items + stock + asiento contable). `adjust_warehouse_stock` valida stock suficiente y lanza error en español ("Stock insuficiente para X: disponible N, solicitado M").
2. **Promociones no se aplican en el POS** (solo CRUD).
3. ~~**RLS permisiva**~~ **Parcialmente resuelto (Fase 1)**: roles implementados en `user_profiles` con 4 niveles (admin/contador/encargado/vendedor). Guards en server actions vía `role-guard.ts`. RLS de `user_profiles` implementada. RLS granular por rol para las demás tablas pendiente de endurecimiento.
4. **Duplicación products/actions**: `app/products/page.tsx` + acciones viejas de producto en `lib/actions.ts` coexisten con `app/inventory/products` + `lib/inventory-actions.ts`; `products.stock_quantity` global coexiste con `product_stock` por bodega. Consolidar.
5. `createAdjustment` y `createBulkTransfer` siguen haciendo mutaciones multi-paso desde el server action (no atómicas); migrarlas a RPCs como se hizo con la venta.
6. ~~Sin numeración consecutiva de venta~~ **Resuelto (Fase 1)**: `site_counters` + `sales.numero` con UPDATE atómico. ~~ni recibo imprimible~~ Recibo imprimible pendiente (Fase 3).
7. Traslados sin estados (pendiente/en tránsito/recibido con faltantes) — pendiente Fase 2.
8. Sin facturación electrónica DIAN (reservar campos cuando se diseñe, como en el proyecto anterior).

## Rendimiento

Ver @PERFORMANCE.md para presupuestos, patrones de optimización y orden de ataque.
Medición canónica: `node scripts/measure-perf.mjs` (requiere Playwright + dev server corriendo).

## Hoja de ruta (paridad Alegra POS)

Mejorar módulo a módulo SIN perder funcionalidad, comparando contra Alegra: Productos, Códigos de barras, POS (pestañas de venta en paralelo, ventas suspendidas, recibo imprimible, descuentos por línea y globales, pagos mixtos), Caja, Inventario, Facturación, Clientes, Promociones (aplicarlas en POS), Cambios y Devoluciones, Compras, Reportes, Usuarios y Permisos, Múltiples Sucursales.

Rasgos de Alegra ya replicados aquí: favoritos, filtro por categorías, badges de stock, cliente rápido, diálogo de cobro con métodos de pago, turnos de caja. Pendientes: pestañas de ventas en paralelo, ventas suspendidas, lista de precio seleccionable en el cobro, recibo imprimible, descuentos, numeraciones de factura.
