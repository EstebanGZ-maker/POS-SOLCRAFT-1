# CONTEXT-POS.md

Contexto denso de POS-SOLCRAFT para pasar a otra instancia de Claude sin acceso al repo. Estado al 2026-08-04.

## 1. Stack y versiones

- **Framework**: Next.js `15.5.21` (App Router, RSC).
- **React**: `^19.2.8` + `react-dom ^19.2.8`.
- **Lenguaje**: TypeScript `^5`.
- **Estilos**: Tailwind CSS `^3.4.17` + shadcn/ui + lucide-react.
- **Data-fetch cliente**: SWR `^2.4.2`.
- **Validación**: Zod `^3.25.76`.
- **3D del storefront**: `three ^0.185.1` + `@react-three/fiber ^9.6.1` + `@react-three/drei ^10.7.7` + `@react-three/postprocessing ^3.0.4`.
- **Backend**: Supabase (Postgres 17.6.1, us-west-2, ref `nxszaxwsrtlofqimbfig`). Cliente vía `@supabase/ssr` (server components/actions) y `@supabase/supabase-js` (browser + service_role).
- **Pagos**: Wompi (Colombia) — sandbox por default, prod configurable.
- **AI**: `ai` SDK con `google/gemini-2.5-flash` vía Vercel AI Gateway (endpoint opcional `/api/analyze-product`).
- **Hosting**: Vercel (deploy desde `main`).
- **Gestor de paquetes**: pnpm (lockfile v9.0). No hay `.nvmrc`.
- **Tests**: Playwright `1.61.1` (matched a Next 15.2.4 originalmente; actualizado a 15.5.21 recientemente — verificar compat).

`next.config.mjs`: `eslint.ignoreDuringBuilds=true`, `typescript.ignoreBuildErrors=true`, imagenes remotas del bucket de Supabase (`nxszaxwsrtlofqimbfig.supabase.co/storage/v1/object/public/**`), formats `avif|webp`, TTL 24h.

## 2. Estructura

```
app/
├─ accounting/               # movimientos y reportes contables
├─ admin/                    # administración global
├─ api/
│  ├─ analyze-product/       # POST → Gemini vía AI SDK (opcional)
│  └─ wompi/webhook/         # POST del webhook Wompi
├─ catalog/                  # storefront público (landing, ficha, cart, checkout)
│  ├─ [code]/                # ficha de producto por código
│  ├─ cart/ | checkout/ | productos/
│  └─ order/[order_number]/  # seguimiento de pedido web
├─ central/transfers/        # bodega central, gestión de traslados
├─ customers/                # CRUD clientes
├─ dashboard/                # KPIs por sede
├─ inventory/
│  ├─ adjustments/ | barcodes/ | kardex/ | management/
│  ├─ price-lists/ | products/ | promotions/ | value/ | warehouses/
├─ login/
├─ pos/                      # PUNTO DE VENTA (foco de este documento)
├─ products/                 # (legacy? — subset de inventory/products)
├─ sales/                    # listado + detalle de ventas
├─ settings/receipt/         # personalización del recibo impreso
├─ transfers/                # send/receive/reconcile (usuario)
├─ users/                    # gestión de usuarios y roles
├─ web-orders/               # fulfillment de pedidos web
├─ layout.tsx                # RootLayout — html lang="es" translate="no"
└─ globals.css               # tokens de tema + shadcn base

lib/
├─ supabase/
│  ├─ client.ts              # createBrowserClient (anon)
│  └─ server.ts              # createServerSupabaseClient (anon+cookies) + createServiceRoleSupabaseClient
├─ auth-context.tsx          # React context: user, profile, loading, hasPermission, hasSiteAccess
├─ auth-helpers.ts           # getUserProfile, getAccessibleSiteIds (server)
├─ cart-context.tsx          # estado del carrito del storefront (client)
├─ site-context.tsx          # sede activa del POS (client)
├─ role-guard.ts             # requireRole (server)
├─ permissions.ts            # matriz módulo→rol
├─ format.ts | utils.ts | image-compress.ts
│
├─ actions.ts                # 15 Server Actions: getCustomers, createSale (RPC create_sale), voidSale, getSales, getSaleDetails, getProducts, getCategories, createProduct, updateProduct, deleteProduct, createContact, getDashboardStats
├─ inventory-actions.ts      # 46 SA (1496 líneas): productos, kardex, ajustes, precios, promociones, traslados
├─ shift-actions.ts          # 5 SA: openShift, closeShift, addCashMovement (vía RPC SECURITY DEFINER), getCurrentShift, getShiftHistory
├─ accounting-actions.ts     # 5 SA: entries CRUD + summary
├─ business-settings-actions.ts # 3 SA: config negocio (recibo, wompi_public_key, etc)
├─ catalog-actions.ts        # 9 SA: getPublicCommerceConfig, getPublicSites, listPublicCatalog, getPublicProduct, getProductSizes, placeWebOrder, lookupWebOrder, getCatalogFacets
├─ dashboard-actions.ts      # getDashboardStats
├─ kardex-actions.ts         # 4 SA
├─ site-actions.ts           # 11 SA (sites, warehouses, user_sites)
├─ suspended-actions.ts      # 4 SA
├─ user-actions.ts           # 6 SA (admin_create_user, admin_reset_password vía RPC)
├─ web-orders-actions.ts     # 5 SA (fulfill_web_order vía RPC)
├─ wompi-actions.ts          # 3 SA: getWompiStatus, createWompiCheckout (usa service_role para RPC), verifyAndApplyTransaction (usa service_role para RPC)
└─ wompi.ts                  # utilidades server: getWompiEnv, verifyEventChecksum (HMAC SHA-256 timingSafeEqual), buildIntegritySignature, buildReference, fetchWompiTransaction
```

## 3. Base de datos

### 3.1 Tablas (columnas · tipo · nullable · default)

Nulos anotados con `?`. Sin anotación = NOT NULL. Todos los timestamps son `timestamptz DEFAULT now()`.

```
accounting_entries
  entry_id uuid PK DEFAULT gen_random_uuid()
  site_id uuid FK sites CASCADE
  entry_type varchar          -- 'income' | 'expense'
  category? varchar
  description? text
  amount numeric
  sale_id? uuid FK sales SET NULL
  entry_date timestamptz

adjustment_items
  adjustment_item_id uuid PK
  adjustment_id uuid FK inventory_adjustments CASCADE
  product_id uuid FK products RESTRICT
  cost numeric DEFAULT 0
  objective varchar           -- 'increase' | 'decrease' (ajuste)
  quantity integer

business_settings              -- single row (id=1)
  id integer PK DEFAULT 1
  business_name text DEFAULT 'SOLCRAFT'
  legal_name? tax_id? phone? email? address? logo_url? custom_phrase? text
  regime? text DEFAULT 'Responsable de IVA'
  legal_footer? text
  template_style text DEFAULT 'clasico'    -- recibo
  header_alignment text DEFAULT 'center'
  paper_width_mm/margin_*_mm integer
  show_description/show_unit_price/show_logo/group_product_data/
    show_unit_of_measure/show_lines_summary/show_tax_summary/show_customer_id boolean
  updated_at, updated_by? uuid
  shipping_cost numeric DEFAULT 0
  free_shipping_over? numeric
  whatsapp_number? text, whatsapp_enabled bool DEFAULT true
  cod_enabled/pickup_enabled/delivery_enabled bool DEFAULT true
  wompi_enabled bool DEFAULT false, wompi_sandbox bool DEFAULT true
  wompi_public_key? text

cash_movements
  movement_id uuid PK
  shift_id uuid FK pos_shifts CASCADE
  type varchar                -- 'income' | 'expense' | 'refund'
  amount numeric
  description? text
  created_at

categories
  category_id uuid PK
  name varchar UNIQUE

customer_accounts
  user_id uuid PK             -- FK auth.users
  customer_id uuid FK customers CASCADE

customers
  customer_id uuid PK
  name varchar
  email? UNIQUE, phone? id_type? id_number? first_name? second_name? last_names?
  city_state? address? postal_code? varchar/text
  is_wholesale boolean DEFAULT false
  created_at, updated_at

inventory_adjustments
  adjustment_id uuid PK
  warehouse_id uuid FK warehouses CASCADE
  notes? text
  total_adjusted numeric DEFAULT 0
  adjustment_date timestamptz

online_orders                 -- (LEGACY / paralelo a web_orders — coexisten)
  order_id uuid PK
  order_number text
  customer_name text, customer_phone text, customer_email? customer_id_number? text
  delivery_method text, site_id uuid FK sites, warehouse_id uuid FK warehouses
  address? city? notes? text
  payment_method text, payment_status text DEFAULT 'pending', payment_reference? text
  status text DEFAULT 'pending'
  subtotal/discount_total/tax_total/shipping_cost/total numeric DEFAULT 0
  sale_id? uuid FK sales, handled_by? uuid
  created_at, updated_at, cancelled_at? cancelled_reason?

online_order_items
  order_item_id uuid PK
  order_id uuid FK online_orders CASCADE
  product_id uuid FK products NO ACTION
  product_name text, product_code text
  quantity int, unit_price/base_price numeric, discount/tax_rate numeric DEFAULT 0, subtotal numeric

online_order_counter          -- singleton (id=1) contador secuencial
  id int PK DEFAULT 1, last_number int DEFAULT 0

payment_events                -- bitácora del webhook Wompi
  event_id uuid PK
  provider text DEFAULT 'wompi'
  transaction_id? reference? event_type? status? text
  amount_in_cents? bigint
  raw_payload? jsonb
  signature_valid? boolean
  processed boolean DEFAULT false
  error_message? text, created_at

pos_shifts
  shift_id uuid PK
  number bigint IDENTITY
  site_id uuid FK sites CASCADE
  warehouse_id? uuid FK warehouses SET NULL
  status varchar DEFAULT 'open'    -- 'open' | 'closed'
  initial_cash numeric DEFAULT 0
  bank_base? varchar
  opened_by? text (nombre, no user_id), opened_at
  closed_at? closed_by? text, counted_cash? expected_cash? difference? numeric
  notes? text
  UNIQUE INDEX one_open_shift_per_site (site_id) WHERE status='open'

price_lists
  price_list_id uuid PK
  name varchar
  is_default boolean DEFAULT false      -- UNIQUE INDEX one_default_price_list WHERE is_default

product_images
  image_id uuid PK
  product_id uuid FK products CASCADE
  url text, storage_path? alt_text? text
  sort_order int DEFAULT 0
  is_primary boolean DEFAULT false      -- UNIQUE INDEX WHERE is_primary
  created_at, created_by? uuid

product_prices                -- precio por (producto, lista)
  product_id uuid FK products CASCADE
  price_list_id uuid FK price_lists CASCADE
  price numeric
  PK (product_id, price_list_id)

product_stock                 -- CACHÉ DENORMALIZADO (fuente de verdad = stock_movements)
  product_id uuid FK products CASCADE
  warehouse_id uuid FK warehouses CASCADE
  quantity integer DEFAULT 0
  min_quantity? max_quantity? int
  updated_at
  PK (product_id, warehouse_id)

products                      -- CATÁLOGO CENTRAL (código inmutable)
  product_id uuid PK
  name varchar
  code? varchar UNIQUE
  barcode? type_prefix? description? size? image_url? varchar/text
  category_id? uuid FK categories SET NULL
  unit varchar DEFAULT 'Unidad'
  cost numeric DEFAULT 0
  price numeric                -- precio detal base
  wholesale_price? numeric     -- precio mayorista
  tax_rate numeric DEFAULT 0   -- IVA %
  is_service/is_active/is_favorite boolean
  stock_quantity int DEFAULT 0 -- LEGACY, congelado en 0, ignorar
  created_at, updated_at

promotions
  promotion_id uuid PK
  name varchar, description? text
  discount_percent numeric
  start_date? end_date? date
  is_active boolean DEFAULT true
  site_id? uuid FK sites SET NULL (NULL = todas las sedes)

promotion_products
  promotion_id uuid FK promotions CASCADE
  product_id uuid FK products CASCADE
  PK (promotion_id, product_id)

public_availability           -- VIEW derivada (no tabla) — expuesta al storefront

sales
  sale_id uuid PK
  customer_id uuid FK customers RESTRICT
  sale_date timestamptz
  total_amount numeric, subtotal? numeric, discount_total numeric DEFAULT 0, tax_total numeric DEFAULT 0
  payment_method? varchar, amount_received? numeric
  seller? text, notes? text
  site_id? uuid FK sites SET NULL, warehouse_id? uuid FK warehouses SET NULL
  shift_id? uuid FK pos_shifts SET NULL
  numero? int (secuencial por sede; UNIQUE INDEX (site_id, numero) WHERE numero NOT NULL)
  status text DEFAULT 'active'    -- 'active' | 'voided'
  created_at

sale_items
  sale_item_id uuid PK
  sale_id uuid FK sales CASCADE
  product_id uuid FK products RESTRICT
  quantity int, unit_price numeric
  discount numeric DEFAULT 0 (%), tax_rate numeric DEFAULT 0 (%)
  created_at

site_counters                 -- secuencia atómica de numero por sede
  site_id uuid PK FK sites CASCADE
  last_numero int DEFAULT 0

sites
  site_id uuid PK
  name varchar, code varchar UNIQUE
  is_central boolean DEFAULT false  -- UNIQUE INDEX one_central_site WHERE is_central
  address? text

stock_movements               -- LEDGER APPEND-ONLY (fuente de verdad del inventario)
  movement_id uuid PK
  product_id uuid FK products NO ACTION
  warehouse_id uuid FK warehouses NO ACTION
  movement_type text CHECK IN ('apertura','compra','venta','traslado_salida',
                                'traslado_entrada','transito_entrada','transito_salida',
                                'ajuste','devolucion')
  quantity int                -- signo: positivo entra, negativo sale
  reference_type? text, reference_id? uuid
  user_id? uuid, notes? text
  created_at

suspended_sales               -- ventas en pausa (parked)
  suspended_sale_id uuid PK
  site_id uuid FK sites NO ACTION
  customer_id? uuid FK customers NO ACTION
  price_list? text DEFAULT 'general'
  items jsonb DEFAULT '[]'    -- copia in-flight del cart
  notes? text
  suspended_by? uuid, created_at
  -- NO reserva stock. product_stock no se toca hasta create_sale.

transfers
  transfer_id uuid PK
  from_warehouse_id uuid FK warehouses RESTRICT
  to_warehouse_id uuid FK warehouses RESTRICT
  status text DEFAULT 'pendiente'
    -- 'pendiente' | 'en_transito' | 'recibido' | 'recibido_con_pendiente'
  notes? text, transfer_date timestamptz
  sent_by? received_by? uuid, received_at? timestamptz

transfer_items
  transfer_item_id uuid PK
  transfer_id uuid FK transfers CASCADE
  product_id uuid FK products RESTRICT
  quantity int, quantity_received? int DEFAULT 0

user_profiles
  id uuid PK FK auth.users(id) CASCADE
  email text, full_name? text
  role text DEFAULT 'vendedor' CHECK IN ('admin','contador','encargado','vendedor')
  site_id? uuid FK sites SET NULL     -- sede primaria (admin/contador => NULL)
  is_active boolean DEFAULT true
  permissions text[] DEFAULT '{}'
  created_at

user_sites                    -- asignación multi-sede (encargado con varias sedes)
  user_id uuid FK auth.users, site_id uuid FK sites CASCADE
  PK (user_id, site_id)

warehouses
  warehouse_id uuid PK
  site_id uuid FK sites CASCADE
  name varchar
  is_primary boolean DEFAULT false   -- UNIQUE per site WHERE is_primary
  is_system boolean DEFAULT false    -- true = bodega virtual Tránsito
  is_public boolean DEFAULT false

web_orders                    -- storefront público
  order_id uuid PK
  numero int SEQ web_orders_numero_seq
  customer_id? uuid FK customers NO ACTION
  guest_name text, guest_phone text, guest_email? guest_id_type? guest_id_number? text
  shipping_address text, shipping_city? shipping_notes? text
  subtotal/discount_total/tax_total/shipping_cost numeric DEFAULT 0
  total numeric
  fulfillment_site_id? uuid FK sites NO ACTION
  sale_id? uuid FK sales NO ACTION
  status text DEFAULT 'pending_payment'
    -- 'pending_payment' | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'cancelled'
  payment_method text DEFAULT 'whatsapp'  -- 'wompi' | 'whatsapp' | 'cod'
  payment_status text DEFAULT 'pending'   -- 'pending' | 'approved' | 'declined' | 'voided' | 'error'
  wompi_reference? UNIQUE, wompi_transaction_id? text
  paid_at? timestamptz
  order_number? text UNIQUE (patrón WEB-######)
  delivery_method text DEFAULT 'delivery'
  payment_reference? text, notes? text
  created_at, updated_at

web_order_items
  order_item_id uuid PK
  order_id uuid FK web_orders CASCADE
  product_id uuid FK products NO ACTION
  product_code? product_name? text
  quantity int, unit_price/base_price numeric, discount/tax_rate DEFAULT 0
```

### 3.2 Índices (btree salvo indicación)

`accounting_entries` — pk(entry_id), (sale_id), (site_id, entry_date) · `adjustment_items` — pk, (adjustment_id), (product_id) · `business_settings` — pk(id), (updated_by) · `cash_movements` — pk, (shift_id) · `categories` — pk, name UNIQUE · `customer_accounts` — pk(user_id), (customer_id) · `customers` — pk, email UNIQUE, (name) · `inventory_adjustments` — pk, (warehouse_id) · `online_order_counter` — pk · `online_order_items` — pk, (order_id), (product_id) · `online_orders` — pk, order_number UNIQUE, (created_at DESC), (handled_by), (customer_phone), (sale_id), (site_id), (status), (warehouse_id) · `payment_events` — pk, (reference), (transaction_id) · `pos_shifts` — pk, (warehouse_id), UNIQUE(site_id) WHERE status='open' · `price_lists` — pk, UNIQUE(is_default) WHERE is_default · `product_images` — pk, (product_id, sort_order), UNIQUE(product_id) WHERE is_primary, (created_by) · `product_prices` — pk(product_id, price_list_id), (price_list_id) · `product_stock` — pk(product_id, warehouse_id), (warehouse_id) · `products` — pk, code UNIQUE, (name), (barcode), (category_id) · `promotion_products` — pk(promotion_id, product_id), (product_id) · `promotions` — pk, (site_id) · `sale_items` — pk, (sale_id), (product_id) · `sales` — pk, (customer_id), (shift_id), (warehouse_id), (site_id, sale_date), UNIQUE(site_id, numero) WHERE numero NOT NULL · `site_counters` — pk(site_id) · `sites` — pk, code UNIQUE, UNIQUE(is_central) WHERE is_central · `stock_movements` — pk, (product_id, warehouse_id, created_at), (reference_type, reference_id), (movement_type), (warehouse_id), (user_id) · `suspended_sales` — pk, (site_id), (customer_id), (suspended_by) · `transfer_items` — pk, (transfer_id), (product_id) · `transfers` — pk, (from_warehouse_id), (to_warehouse_id), (to_warehouse_id, status), (sent_by), (received_by) · `user_profiles` — pk(id), (role), (site_id) · `user_sites` — pk(user_id, site_id), (user_id), (site_id) · `warehouses` — pk, (site_id), UNIQUE(site_id) WHERE is_primary · `web_order_items` — pk, (order_id), (product_id) · `web_orders` — pk, numero UNIQUE, order_number UNIQUE, wompi_reference UNIQUE, (customer_id), (sale_id), (fulfillment_site_id), (status), (wompi_reference), (wompi_transaction_id)

### 3.3 Funciones / RPCs

**Regla crítica**: `stock_movements` = ledger append-only fuente de verdad. `product_stock` = caché denormalizado. Cada operación de dinero/inventario ocurre en una transacción atómica que actualiza ambos, respaldada por `adjust_warehouse_stock`. Invariante `SUM(stock_movements.quantity) = product_stock.quantity` por (producto, bodega). Verificable con `verify_kardex_integrity()`.

#### Helpers RLS (SECURITY DEFINER, STABLE)

```sql
user_role() RETURNS text
  SELECT role FROM user_profiles WHERE id = auth.uid();

user_site_id() RETURNS uuid
  SELECT site_id FROM user_profiles WHERE id = auth.uid();

is_admin() RETURNS boolean
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin');

is_global_role() RETURNS boolean
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id=auth.uid() AND role IN ('admin','contador'));

is_admin_or_encargado() -- análoga

has_site_access(p_site_id uuid) RETURNS boolean
  SELECT is_global_role()
    OR EXISTS (SELECT 1 FROM user_sites WHERE user_id=auth.uid() AND site_id=p_site_id)
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id=auth.uid() AND site_id=p_site_id);
```

#### Núcleo stock/venta

```sql
adjust_warehouse_stock(
  p_product_id uuid, p_warehouse_id uuid, p_delta int,
  p_movement_type text=NULL, p_reference_type text=NULL, p_reference_id uuid=NULL,
  p_user_id uuid=NULL, p_notes text=NULL
) RETURNS int  -- NUEVA cantidad
-- (No SECURITY DEFINER — corre como caller.)
-- Intenta UPDATE atómico con guard "quantity + delta >= 0". Si toma la fila:
--   inserta stock_movement (si p_movement_type NOT NULL) y retorna.
-- Si no encontró y v_avail existe o delta<0: RAISE 'Stock insuficiente para "%": disponible %, solicitado %.'
-- Si no existe fila y delta>=0: UPSERT product_stock + inserta movement.
```

```sql
create_sale(
  p_customer_id uuid, p_total_amount numeric, p_items jsonb,
  p_payment_method text=NULL, p_amount_received numeric=NULL,
  p_seller text=NULL, p_notes text=NULL,
  p_site_id uuid=NULL, p_warehouse_id uuid=NULL,
  p_shift_id uuid=NULL, p_user_id uuid=NULL
) RETURNS uuid  -- sale_id
-- 1. RAISE si items vacío o total_amount<0.
-- 2. Si p_site_id: UPDATE site_counters SET last_numero+=1 RETURNING → v_numero (numeración atómica).
-- 3. INSERT sales (... numero, status='active') RETURNING sale_id.
-- 4. Loop items: INSERT sale_items; acumula v_subtotal/v_discount_total/v_tax_total.
--    Para cada item: si products.is_service=false ⇒
--       adjust_warehouse_stock(product, p_warehouse_id, -qty, 'venta', 'sale', sale_id, p_user_id)
--    (si p_warehouse_id NULL, fallback legacy decrement_product_stock — código muerto).
-- 5. UPDATE sales SET subtotal, discount_total, tax_total.
-- 6. INSERT accounting_entries (income, 'Ventas POS', 'Venta #v_numero - method', total, sale_id).
-- 7. RETURN sale_id.
-- No hay pre-validación de rol/sede: la valida el wrapper createSale (via requireRole en actions.ts).
```

```sql
void_sale(p_sale_id uuid, p_user_id uuid=NULL) RETURNS void
-- 1. Fetch sales row. RAISE si NOT FOUND o status='voided'.
-- 2. UPDATE sales SET status='voided'.
-- 3. Loop sale_items: si producto no is_service y warehouse_id NOT NULL:
--    adjust_warehouse_stock(prod, warehouse, +qty, 'devolucion', 'sale', sale_id, p_user_id,
--                            'Anulación de venta #<numero>')
-- 4. INSERT accounting_entries (expense, 'Anulación venta', 'Anulación venta #<numero>', total, sale_id).
```

```sql
verify_kardex_integrity() RETURNS TABLE(product_id uuid, warehouse_id uuid,
                                         saldo_real int, suma_kardex bigint, diff bigint)
-- FULL OUTER JOIN product_stock vs SUM(stock_movements) GROUP BY (product,warehouse)
-- WHERE COALESCE(s.quantity,0) <> COALESCE(m.total,0)
-- Debe retornar 0 filas en todo momento.
```

#### Turnos de caja (S1-paso1 — SECURITY DEFINER con role/site check interno)

```sql
open_shift(p_site_id uuid, p_warehouse_id uuid, p_initial_cash numeric,
           p_bank_base text=NULL, p_opened_by text=NULL) RETURNS uuid
-- RAISE si auth.uid IS NULL / rol NOT IN admin,encargado,vendedor
-- Si rol encargado|vendedor: user_site_id() debe = p_site_id (else RAISE).
-- Guard initial_cash>=0, no duplicar (chequea EXISTS status='open' + índice único).
-- INSERT pos_shifts RETURNING shift_id.

add_cash_movement(p_shift_id uuid, p_type text, p_amount numeric,
                  p_description text=NULL) RETURNS uuid
-- Chequeos análogos + p_type IN ('income','expense','refund') + amount>=0.
-- Turno debe estar 'open'; site_id del turno debe coincidir con user_site_id() si no-admin.
-- INSERT cash_movements RETURNING movement_id.

close_shift(p_shift_id uuid, p_counted_cash numeric,
            p_closed_by text=NULL, p_notes text=NULL) RETURNS jsonb
-- Autoriza igual. Computa expected_cash internamente:
--   v_cash_sales = SUM(sales.total_amount) WHERE shift_id=? AND (payment_method ILIKE '%efectivo%' OR '%cash%')
--     [NOTA M12: NO filtra status='active' — cuenta también anuladas (paridad 1:1 con buildBalance TS legacy)]
--   v_cash_in/out/refunds = SUM(cash_movements.amount) FILTER (WHERE type=?)
--   v_expected = initial_cash + v_cash_sales + v_cash_in - v_cash_out - v_refunds
-- UPDATE pos_shifts SET status='closed', closed_at=NOW(), counted_cash, expected_cash, difference, notes.
-- RETURN jsonb {shift_id, expected_cash, counted_cash, difference}.
```

#### Traslados (bodega central → sedes)

```sql
send_transfer_via_transit(p_product_id, p_from_warehouse_id, p_transit_warehouse_id,
                          p_quantity, p_reference_id=NULL, p_user_id=NULL) RETURNS void
-- Guard quantity>0.
-- adjust_warehouse_stock(from, -qty, 'traslado_salida', 'transfer', ref, user)
-- adjust_warehouse_stock(transit, +qty, 'transito_entrada', 'transfer', ref, user)
-- (Sin autorización interna — el wrapper valida.)

receive_transfer(p_transfer_id uuid, p_items jsonb, p_user_id uuid=NULL) RETURNS json
-- SECURITY DEFINER.
-- FOR UPDATE lock del transfer. Guard status IN ('en_transito','recibido_con_pendiente').
-- Autoriza: is_admin() OR (user_role()='encargado' AND has_site_access(v_dest_site)).
-- Ubica bodega transit (is_system=true).
-- Loop items: lock transfer_items row + lock product_stock del transit;
--   guard v_transit_qty >= v_to_receive; adjust_warehouse_stock -qty transit_salida y +qty traslado_entrada.
--   UPDATE transfer_items.quantity_received.
-- Recalcula si "still pending" → status = 'recibido_con_pendiente' | 'recibido'.
-- UPDATE transfers status/received_by (conserva first) / received_at.
-- RETURN {success, status, lines_received, units_received, pending}.

reconcile_transfer(p_transfer_id uuid, p_items jsonb, p_notes text=NULL, p_user_id uuid=NULL) RETURNS json
-- SECURITY DEFINER.
-- Autoriza: is_admin() OR user_role()='contador' (encargado NO puede ocultar faltantes).
-- Solo aplica si status='recibido_con_pendiente'.
-- Loop items {product_id, found_qty}: v_pending = qty - received.
--   v_found = LEAST(input, pending); v_lost = pending - v_found.
--   Si found>0: transit -found → destino +found ('traslado_entrada').
--   Si lost>0: transit -lost movimiento 'ajuste' ref_type='transfer_reconcile' (baja definitiva).
-- UPDATE transfers status='recibido', notes con resumen.
```

#### Web/Wompi (S3-P0 — REVOCADAS de anon/authenticated, solo service_role)

```sql
apply_wompi_transaction(p_reference text, p_transaction_id text, p_status text,
                        p_amount_in_cents bigint) RETURNS json
-- SECURITY DEFINER. Busca web_orders por wompi_reference. Idempotente.
-- Valida amount == total*100 (else error). Mapea status APPROVED/DECLINED/VOIDED/ERROR → payment_status.
-- UPDATE web_orders set payment_status, wompi_transaction_id, paid_at (si approved),
--   status='paid' si (approved AND status='pending_payment'), updated_at=NOW().
-- Retorna {success, order_number, payment_status}.

set_web_order_payment_reference(p_order_id uuid, p_reference text) RETURNS json
-- SECURITY DEFINER. Guarda wompi_reference en el pedido.

log_payment_event(p_transaction_id, p_reference, p_event_type, p_status,
                  p_amount_in_cents, p_raw jsonb, p_signature_valid bool,
                  p_processed bool, p_error text=NULL) RETURNS void
-- SECURITY DEFINER. Bitácora del webhook (INSERT payment_events).

fulfill_web_order(p_order_id uuid, p_site_id uuid, p_user_id uuid) RETURNS ?
update_online_order_status(p_order_id uuid, p_new_status text, p_user_id uuid, p_reason text) RETURNS ?
-- Ambas SECURITY DEFINER, revocadas de anon (script 09), aún ejecutables por authenticated.
```

#### RPCs storefront público (`public_*`, todas SECURITY DEFINER, anon esperado)

`public_catalog_business()`, `public_catalog_facets()`, `public_catalog_list(p_site_id,p_search,p_only_available,p_limit,p_offset,p_line,p_size)`, `public_catalog_product(p_code)`, `public_catalog_sites()`, `public_commerce_config()`, `public_get_order(p_order_number, p_phone)`, `public_place_order(...)` , `public_product_sizes(p_code)`, `public_web_order_lookup(p_numero, p_phone)`. Todas leen del catálogo con is_active/is_public filtros. `public_place_order` toma precio del catálogo (nunca del cliente).

#### Utilidades

`decrement_product_stock` — legacy fallback (código muerto, usar `adjust_warehouse_stock`).
`transfer_stock` — variante antigua.
`next_product_code` — genera código con `type_prefix + secuencial`.
`get_low_stock_products` — reescrita 2026-07-31 para leer de `product_stock` (antes leía columna legacy `products.stock_quantity`).
`create_web_order`, `place_web_order` — variantes viejas de `public_place_order`.
`admin_create_user(email, password, full_name, role, site_id)`, `admin_reset_password(user_id, new_password)` — revocadas de anon en script 09.
`handle_new_user()` — trigger de auth.users que crea user_profiles con role='vendedor'.

### 3.4 RLS

- **Habilitada en todas las tablas de negocio.**
- **Lectura**: policies por rol + accesibilidad de sede vía helpers `is_global_role()`, `has_site_access()`.
- **Escritura (`_write`, `_update`)** hoy es **"always true"** para `authenticated` en `sales`, `sale_items`, `stock_movements`, `product_stock`, `transfers`, `transfer_items`, `accounting_entries`, `cash_movements`, `customers`, `suspended_sales`, `site_counters`. Reason histórica: todas las escrituras iban por Server Actions con `requireRole()`. S1-paso1 empezó a cerrar esto en `pos_shifts`/`cash_movements` moviendo la lógica a RPCs `SECURITY DEFINER` con validación interna, pero el resto sigue permisivo. Ver §5.1.

## 4. Flujo POS de punta a punta

### 4.1 Al montar `app/pos/page.tsx`

`useEffect([siteId])` (client component, "use client"):

```
1. setLoading(true)
2. whId = await getWarehouseForSite(siteId)     // Server Action → 1 query warehouses
3. Promise.all([
     refreshShift(siteId)                        // getCurrentShift → 1 query pos_shifts + agregados sales+cash_movements para balance
     refreshData(whId) {
       Promise.all([
         getProductsWithStock(whId)              // 1 query — ver §4.2
         getCustomers()                          // 1 query customers
         getCategories()                         // 1 query categories
       ])
     }
   ])
4. Promise.all([
     getPriceListsForPOS()                       // 2 queries: price_lists + product_prices (todo)
     getActivePromotionsForPOS(siteId)           // 1 query promotions con embed promotion_products
   ])
5. Elige customer default ("Consumidor final" | "Walk-in Customer") → tabId inicial.
6. setLoading(false)
```

Total: **~8 queries en el mount inicial** (+ auth/session del AuthProvider).

### 4.2 Lista de productos con stock — `getProductsWithStock(warehouse_id)` en `lib/inventory-actions.ts`

```ts
supabase.from("products")
  .select("*, categories(category_id, name), product_stock(warehouse_id, quantity, min_quantity, max_quantity)")
  .order("name")
// Post-procesamiento en JS:
data.map(p => {
  totalStock = sum(p.product_stock)
  warehouseStock = warehouse_id ? p.product_stock.find(r => r.warehouse_id===warehouse_id)?.quantity ?? 0 : totalStock
  return {...p, totalStock, warehouseStock}
})
```

Sin `.limit()`, sin `.eq("is_active", true)`. Filtro por bodega ocurre en JS. **Trae TODOS los productos con TODAS las columnas cada mount**. Ver §6 tech debt.

### 4.3 Resolución de precio en el UI (`resolvePrice(product)`)

Client-side. `selectedPriceList` es un estado UI del `Select` en el header del POS, valor `"general" | "mayorista" | <price_list_uuid>`:

```ts
if (selectedPriceList === "mayorista") return product.wholesale_price ?? product.price
if (selectedPriceList !== "general")   return priceMap[selectedPriceList]?.[product_id] ?? product.price
return product.price
```

**El precio NO se resuelve automáticamente por `customer.is_wholesale`** — el cajero elige la lista manualmente. Ver §5.2.

### 4.4 Descuentos y promociones

- `getActivePromotionsForPOS` construye `promoMap[product_id] = {name, discount}` con la promoción activa de mayor `discount_percent` que aplica a esa (producto, sede).
- Al agregar al carrito (`addToCart`): `line.discount = promoMap[product_id]?.discount ?? 0`. **Un solo campo `discount` por línea** (porcentaje).
- El usuario puede editar la línea (`EditLineDialog`) y sobrescribir `discount` o `price`.

### 4.5 Validación de disponibilidad al agregar

`addToCart(product)` en `app/pos/page.tsx`:
```ts
if (product.stock_quantity <= 0) return
if (existing && existing.quantity >= product.stock_quantity) toast("Sin stock")
```
Solo lee del estado en memoria (`stock_quantity = warehouseStock`). No consulta la DB en cada add. La validación **real** ocurre server-side en `adjust_warehouse_stock` cuando se confirma la venta (UPDATE con `WHERE quantity + delta >= 0` toma lock de fila).

### 4.6 Crear venta

`startSale()` → `PaymentDialog` (método + monto + vendedor + notas) → `confirmPayment(payment)`:
```
createSale(customer_id, total_amount, items[], payment: {payment_method, amount_received, seller, notes})
  → lib/actions.ts createSale():
     requireRole("admin","encargado","vendedor")  // no está aún — S1-paso2 pendiente
     supabase.rpc("create_sale", {
       p_customer_id, p_total_amount, p_items: items.map({product_id, quantity, unit_price, base_price, discount, tax_rate}),
       p_payment_method, p_amount_received, p_seller, p_notes,
       p_site_id: siteId, p_warehouse_id: warehouseId, p_shift_id: shift?.shift_id, p_user_id: profile.id
     })
     revalidatePath("/pos"); revalidatePath("/sales"); revalidatePath("/accounting")
     toast("Venta realizada")
```

`create_sale` RPC hace todo atómico: `sales` + `sale_items` + `stock_movements` (via `adjust_warehouse_stock`) + `product_stock UPDATE` + `accounting_entries`. Numeración secuencial vía `site_counters` con `UPDATE ... RETURNING`.

### 4.7 Turnos de caja

- **Un turno abierto por sede** (índice único parcial `one_open_shift_per_site`).
- Abrir: `openShift → open_shift RPC` (S1-paso1, SECURITY DEFINER, valida rol + sede).
- Movimientos manuales: `addCashMovement → add_cash_movement RPC`.
- Cerrar: `closeShift → close_shift RPC` que computa `expected_cash` en SQL (sin filtrar `sales.status='active'` — ver M12).
- Sin turno abierto ⇒ `startSale()` bloquea y abre `OpenShiftDialog`.

### 4.8 Anular venta

`voidSale(sale_id) → RPC void_sale(p_sale_id, p_user_id)`. Revierte stock (`adjust_warehouse_stock` con qty positiva y `movement_type='devolucion'`), inserta `accounting_entry` tipo `expense` con category `Anulación venta`. La venta queda con `status='voided'` (no se borra). Actualmente solo admin/encargado (validado en wrapper `voidSale` con `requireRole`).

## 5. Decisiones de arquitectura abiertas

### 5.1 RLS vs SECURITY DEFINER / service_role

**Estado**: mixto y en migración incremental.
- **Lecturas**: RLS por rol/sede vía helpers `is_global_role()`/`has_site_access()`. Cerrada.
- **Escrituras dinero/inventario**:
  - `pos_shifts`, `cash_movements` (S1-paso1, aplicado 2026-08-03): RPCs SECURITY DEFINER con validación de rol/sede DENTRO de la función. Wrappers TS llaman RPCs, ya no `.from().insert()`. Deploy pendiente de merge del PR `s1-s3p0-rpc-hardening`.
  - `apply_wompi_transaction`, `set_web_order_payment_reference`, `log_payment_event` (S3-P0, aplicado 2026-08-03): REVOKE anon/authenticated + GRANT service_role. Refactor: webhook y `wompi-actions.ts` usan `createServiceRoleSupabaseClient()`.
  - `sales`, `sale_items`, `stock_movements`, `product_stock`, `transfers`, `transfer_items`, `accounting_entries`, `suspended_sales`, `customers`, `site_counters` (S1-paso2 pendiente): RLS de escritura sigue `USING (true) WITH CHECK (true)` para authenticated. Cerradas de facto porque todas las escrituras van por RPC (`create_sale`, `void_sale`, `adjust_warehouse_stock`), pero un `authenticated` cualquiera puede escribir directo saltándose el wrapper. `create_sale` NO valida rol internamente aún.
  - `receive_transfer`, `reconcile_transfer` (S3 general): SECURITY DEFINER, anon puede ejecutar pero validan rol internamente con `is_admin`/`user_role`/`has_site_access` → seguras.
- **Otras RPCs anon-ejecutables**: 27 totales. 10 `public_*` intencionales, 8 helpers RLS retornan NULL sin `auth.uid()`, 3 storefront `place_order` toman precio del catálogo. Verificado sin más P0.

**Pendiente**: S1-paso2 (create_sale/void_sale/adjust_warehouse_stock a SECURITY DEFINER + role check) y S3 general.

### 5.2 Composición de descuentos y precios

**Actual**: por línea, un solo campo `discount NUMERIC` (porcentaje). Se aplica antes del IVA:
```
line_after_disc = base_price * qty * (1 - discount/100)
line_tax        = line_after_disc * tax_rate/100
line_total      = line_after_disc + line_tax
```

**Precio base (`base_price`)** se decide en el UI vía `resolvePrice(product)`:
1. Si `selectedPriceList === "mayorista"` → `product.wholesale_price ?? product.price`.
2. Si `selectedPriceList` es un `price_list_id` custom → `priceMap[list][product_id]` de `product_prices`.
3. Default: `product.price`.

**Promociones**: `promoMap[product_id].discount` se aplica automáticamente en `addToCart` sobre `line.discount`. Si el usuario edita la línea (`EditLineDialog`), el discount se sobreescribe manualmente — no se compone.

**Ambigüedades no resueltas**:
- No hay un descuento global de venta (solo por línea).
- No hay descuento por método de pago.
- Si un cliente `is_wholesale=true` entra al POS, el sistema **no cambia** `selectedPriceList` automáticamente — el cajero debe hacerlo manualmente. Comportamiento por diseño o bug: sin decidir.
- Si una promoción tiene `discount_percent` mayor a un descuento manual previo, no se pregunta al usuario cuál gana — el `addToCart` reasigna al promo. Idem al revés (edición manual sobre línea con promo).
- El servidor (`create_sale`) confía en `discount`/`tax_rate` del payload y recalcula `subtotal/discount_total/tax_total` sumándolos, pero **no re-valida** que `base_price` coincida con `products.price` / `wholesale_price` / `product_prices`. El principio "el servidor decide el precio" **no** está enforced en `create_sale`. En `public_place_order` sí (lee precio del catálogo). Discrepancia deliberada pendiente de resolución.

### 5.3 Ventas suspendidas y reserva de inventario

**Estado**: `suspended_sales` guarda `items jsonb` como snapshot del carrito, pero **NO reserva stock**. `product_stock.quantity` no cambia hasta `create_sale`. Consecuencia: dos vendedores pueden "suspender" ventas del mismo producto y ambos llegar a `startSale()`; el segundo recibe error de stock insuficiente al llegar a `adjust_warehouse_stock`.

**Decisión abierta**: ¿reservar stock al suspender? Alternativas discutidas informalmente:
1. Reservar decrementando `product_stock.quantity` con un `stock_movement` tipo `reserva` y devolver al reanudar/vencer.
2. Añadir columna `product_stock.reserved_quantity` (agregada de suspended_sales) y validar `quantity - reserved >= delta` en `adjust_warehouse_stock`.
3. TTL corto (ej. 30 min) sobre `suspended_sales` — release automático.
4. Mantener el modelo actual (el 2º vendedor pierde) por simplicidad.

Ninguna decidida. `suspended_sales` funciona hoy con opción 4 implícita.

## 6. Deuda técnica y TODO

### Aplicado a prod pero pendiente de deploy (PR `s1-s3p0-rpc-hardening` abierto)

- **S1-paso1**: shifts/caja vía RPCs SECURITY DEFINER. `lib/shift-actions.ts` refactorizado. RPC en prod, código sin desplegar aún.
- **S3-P0**: hotfix Wompi RPCs. REVOKE aplicado, refactor en `route.ts` + `wompi-actions.ts` pendiente de deploy. Requiere `SUPABASE_SERVICE_ROLE_KEY` en Vercel antes de mergear (o webhook rompe).

### Bugs conocidos sin corregir

- **`app/central/page.tsx:23`**: importa `getCategories` de `@/lib/inventory-actions` que no existe. Warning webpack, silencioso runtime; UI de central muestra "sin categorías". Solo requiere crear el export.
- **`lib/shift-actions.ts` (pre-S1)**: `openShift`, `closeShift`, `addCashMovement`, `getShiftHistory`, `getCurrentShift` sin `requireRole()`. Cerrado por S1-paso1 vía validación interna en los RPCs, pero mientras el deploy no lande el path directo del wrapper viejo sigue vivo.
- **`lib/actions.ts createSale`**: sin `requireRole`. Único punto abierto para venta en el POS. Cierra en S1-paso2 pendiente.

### Drift de esquema (prod tiene objetos no versionados en `scripts/*.sql`)

- **M11**: `user_sites` (tabla + RLS) — usada por `role-guard.ts` y header multi-sede del POS. Sin script.
- **M14**: `web_orders`, `payment_events`, `online_orders`, `web_order_items`, `product_images` (parcial) + RPCs `apply_wompi_transaction`, `set_web_order_payment_reference`, `log_payment_event`, `fulfill_web_order`, `update_online_order_status` — todo aplicado por Studio sin versionar.
- **M13**: `scripts/08_perf_fk_indexes.sql` a `12_fix_low_stock_use_product_stock.sql` existen en working tree pero **nunca se commit-earon** al repo git antes de esta sesión (van en el PR S1).

### Deuda funcional (PLAN-PENDIENTES)

- **M5** — Wompi bloqueado por credenciales (llaves privadas no configuradas en Vercel).
- **M6** — SEO / performance (LCP < 1s en catálogo, presupuesto `PERFORMANCE.md`).
- **M7** — Reproducibilidad de scripts SQL (relacionado con M11+M14).
- **M8** — Recoger en tienda (feature del storefront).
- **M9** — Cuentas de cliente (tabla `customer_accounts` existe, UI no).
- **M12** — Excluir ventas anuladas del cálculo de `expected_cash` en `close_shift` RPC y `buildBalance` TS (paridad 1:1 preservada en S1 por prudencia; mejora aparte).
- **`products.stock_quantity`** — columna legacy congelada en 0. Ignorable, `product_stock.quantity` es la fuente.

### Deuda de tests

- Sin cobertura Playwright para módulos B (inventario), C (traslados), D (contabilidad), F (catálogo/Wompi), G (pedidos web), H (dashboard). Solo A (POS + turnos) tiene: `smoke-core.mjs` (invariantes DB), `auth.spec.ts` (3 tests), `routes-smoke.spec.ts` (9 rutas), `pos-sale.spec.ts` (venta+void con validación de estabilidad reciente), `shifts-role.spec.ts` (3 casos rol/sede). Todos ejecutados contra prod verde salvo pos-sale (flake corregido — ver commit reciente en branch S1).
- Sin tests de webhook Wompi con payload firmado (parte de S3 general pendiente).

### Optimización pendiente para POS (paso 3 del análisis en curso, no aplicado)

- **`getProductsWithStock`** trae 3.000 productos × 20+ columnas cada mount del POS (payload ~3-5 MB proyectado). Falta paginación server-side + `SELECT` proyectado.
- Sospecha adicional: TTFB alto en producción por cold start Vercel o región Vercel≠Supabase (`us-west-2`). No verificado.

### Env vars requeridas para runtime prod (Vercel)

Requeridas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`.
Wompi (opcional): `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`, `NEXT_PUBLIC_WOMPI_PUBLIC_KEY`.
AI (opcional): `AI_GATEWAY_API_KEY` (solo para `/api/analyze-product`).

---

## 7. Cambios post-2026-08-04 (sesiones 2026-08-05 → 2026-08-11)

Este bloque acumula lo NUEVO desde la última versión estable de CONTEXT-POS.md.
Para la cola operativa (qué está en cada archivo, gates humanos, orden de
apply), ver [docs/ESTADO-PENDIENTES.md](docs/ESTADO-PENDIENTES.md).

Todo lo aplicado a prod es solo lo listado en §7.5 "Ya en prod". El resto
está escrito, commiteado en `s1-s3p0-rpc-hardening`, y sin apply — bloqueado
por Free plan (branches Supabase requieren Pro).

### 7.1 Módulo de crédito (fiado) — escrito, sin apply

Spec: [docs/CREDIT-SALES-SPEC.md](docs/CREDIT-SALES-SPEC.md).

**Modelo Fase 1**:
- `sales += is_on_account BOOLEAN, amount_paid NUMERIC, balance_due
  NUMERIC GENERATED ALWAYS AS (total_amount - amount_paid) STORED`.
- Nueva `sale_payments` (ledger de abonos, patrón
  `stock_movements→product_stock`): `payment_id, sale_id, amount>0,
  payment_method, shift_id?, site_id, received_by, notes, status
  ('active'|'voided'), created_at`. RLS de escritura CERRADA.
- `customers += allows_credit BOOLEAN DEFAULT TRUE, is_walk_in BOOLEAN
  DEFAULT FALSE`. Índice único parcial `WHERE is_walk_in` + CHECK
  `NOT (is_walk_in AND allows_credit)`. Walk-in bootstrapped por nombre
  una única vez; runtime detecta por `is_walk_in`.
- Nueva `customer_credits` (Fase 1 solo emisión desde `void_sale`;
  redención en Fase 3): `credit_id, customer_id, amount, source_type
  ('void_sale'|'manual_adjustment'|'redemption'), source_sale_id?,
  site_id, notes, created_by, created_at`. RLS cerrada.

**RPCs Fase 1** (todos SECDEF + `auth.uid()`):
- `create_sale` — nueva firma con `p_is_on_account, p_initial_payment`.
  Ignora `p_user_id` (D11 general). Ventas a cuenta usan
  `payment_method='crédito'` **como etiqueta** — la lógica de caja usa
  SOLO `is_on_account`, nunca ILIKE sobre `payment_method` (matiz D8).
- `register_payment` (Fase 2) — abonos posteriores.
- `close_shift` — reescrito para consumir `get_shift_balance`.
- **`get_shift_balance(shift_id)` (nuevo, D10)** — única fuente del
  arqueo. Suma desde `sale_payments` con `status='active'` filtrando cash
  por `payment_method ILIKE '%efectivo%'`. Elimina duplicación
  SQL/TS (M12 se resuelve aquí).
- `void_sale` — regla asimétrica Casos A/B/C: contado con refund cash en
  turno actual vía `cash_movements` (aun si es cross-turno del abono);
  fiado NO toca `sale_payments` ni caja, solo emite `customer_credits`
  por lo pagado; sin `amount_paid` no genera nada.

**Función `verify_credit_integrity()`** — invariante
`SUM(sale_payments.amount WHERE active) = sales.amount_paid` por venta.

**Ciclo del saldo a favor (§6.1 del spec)**: traza numérica muestra que
`apply_customer_credit` (Fase 3) DEBE asentar `income` por el monto
aplicado (**precondición bloqueante D14**), aunque no entre plata nueva.
Sin eso la P&L queda debajo del cash real.

### 7.2 Módulo de ajustes de inventario — reescrito completo, sin apply

Spec: [docs/INVENTORY-ADJUSTMENTS-SPEC.md](docs/INVENTORY-ADJUSTMENTS-SPEC.md).
Reemplaza el `createAdjustment` + `deleteAdjustment` no-transaccionales
actuales por RPCs SECDEF atómicos.

**Fase 1** — nuevas columnas en `inventory_adjustments`:

```
inventory_adjustments (post-Fase 1)
  adjustment_id uuid PK
  warehouse_id uuid FK warehouses CASCADE
  notes? text
  total_adjusted numeric DEFAULT 0
  adjustment_date timestamptz
  site_id? uuid FK sites SET NULL          -- NUEVO, derivado de warehouse
  numero? int                              -- NUEVO, inerte hasta 2A
  status text DEFAULT 'active'             -- NUEVO 'active'|'voided'
  motivo? text CHECK IN (NULL,'compra','sobrante','correccion')  -- NUEVO, inerte hasta 2C
  created_by? uuid FK auth.users SET NULL  -- NUEVO
  updated_at timestamptz                   -- NUEVO
  UNIQUE INDEX (site_id, numero) WHERE numero NOT NULL  -- inerte hasta 2A
```

- Trigger `update_inventory_adjustments_updated_at` reutiliza
  `update_updated_at_column()`.
- RLS de `inventory_adjustments` + `adjustment_items` de escritura
  **cerrada** — solo RPC SECDEF escribe.
- RPCs SECDEF nuevos: `create_adjustment(warehouse_id, notes, items)` y
  `void_adjustment(adjustment_id)`. Elimina el `Promise.all`
  no-transaccional actual (bug de partial-write documentado).

**Fase 2** sub-faseada por riesgo (2A→2B→2C+2D):

- **2A · Numeración** — `adjustment_counters (site_id PK, last_numero
  int)`. `create_adjustment` numera atómicamente. Backfill de históricos
  = NO (§7 del spec).
- **2B · WAC** — recalcula `products.cost` al incrementar con cost>0.
  Orden estricto documentado en §5.1.1 del spec: LOCK `products` FOR
  UPDATE → READ `SUM(product_stock.quantity)` global BEFORE → adjust
  kardex → recalc con valores BEFORE → UPDATE `products.cost`. Loop
  iterativo. WAC NO cambia al disminuir (D2). Reversión NO revierte WAC
  (D5) — banner UI lo avisa.
- **2C · Contabilidad con motivos** (⚠ GATE CONTADOR):
  - `accounting_entries += adjustment_id UUID FK` (D4).
  - `create_adjustment` firma cambia a
    `(warehouse_id, notes, items, motivo TEXT DEFAULT NULL)`. Reglas:
    motivo obligatorio si hay incrementos; NULL si 100% disminuciones;
    correccion exige notes no vacío. RAISE en violación.
  - Asientos: `compra → expense "Compra de mercancía"`,
    `sobrante → income "Sobrante de inventario"`,
    `correccion → sin asiento`. Disminuciones → expense
    "Merma / Ajuste negativo". Referencia `adjustment_id` para
    trazabilidad.
  - `void_adjustment` compensa asientos originales (income↔expense
    inverso, category=`Reversión <cat>`). NO revierte WAC.
  - Nueva `verify_adjustment_accounting_integrity()`: para cada voided
    con asientos, `SUM(income) - SUM(expense) = 0`.
- **2D · Unificar entradas** — `receiveMerchandise` +
  `ingressNewProduct` migran a `create_adjustment` con `motivo='compra'`.
  Post-2D toda entrada de mercancía queda como `movement_type='ajuste'`
  en `stock_movements`; distinción compra vs ajuste migra a
  `inventory_adjustments.motivo`. Análisis DN2 completo en
  [scripts/17d_adjustments_unify_entries.md](scripts/17d_adjustments_unify_entries.md).

**Fase 3 UI** — ya deployable independiente de Fase 1 (degrada limpio):

- Nueva ruta `app/inventory/adjustments/[adjustment_id]/page.tsx` —
  detalle con header (numero o "sin número", sede, bodega, fecha, badges
  status/motivo, botón Anular), banner de anulado con warning WAC D5
  condicional, tabla de líneas con totales.
- Botón Anular visible SOLO si `role='admin'` o
  `(role='encargado' && assignedSiteId === adjustment.site_id)` —
  espejo estricto de la regla del RPC. **canVoid es visibilidad, la
  autorización real vive en el RPC** (comentado explícito).
- Server Action `voidAdjustment` mapea Postgres `42883` (función no
  existe) a mensaje amigable para que el UI no muestre stacktraces
  mientras Fase 1 no está aplicada.
- `getAdjustmentById` extendido: embed `warehouses(sites(name))` +
  segundo select a `user_profiles` para `creator` (casos borde
  `created_by NULL` → sin línea; user_profiles ausente → "Usuario
  desconocido").

**Decisiones D1–D8 + DN1/DN2/DN3** cerradas en el spec:
- D1 → motivos (compra/sobrante/correccion), gate contador vigente.
- D2 → WAC no cambia al disminuir. Confirmado.
- D3 → `adjustment_counters` propio (no compartir con sales).
- D4 → FK `adjustment_id` en `accounting_entries`.
- D5 → WAC NO se revierte al voider; UI avisa.
- D6 → WAC usa stock global de todas las bodegas.
- D7 → No editar ajustes, solo anular (analogía void_sale).
- D8 → 2D migra `ingressNewProduct` al RPC común.
- DN1 → WAC continúa desde valor movido tras void (sin acción).
- DN2 → `movement_type='ajuste'` uniforme post-2D; distinción en
  motivo. Copy kardex "Compra (histórico)" ya aplicado en Fase 3 UI.
- DN3 → `adjustment_counters` con seed ON CONFLICT para sedes creadas
  después del apply de 2A.

### 7.3 Fix POS "stock replicado" (APLICADO — sesión 2026-08-08)

Diagnóstico completo en sesión 2026-08-08:
- Auditoría de `product_stock` de PA-32-120-00 confirmó que **no hay
  duplicación de datos**: cada sede tiene su cantidad, `stock_movements`
  cuadra 1:1 por-cell.
- Bug era de lectura: `getProductsWithStock(null)` (fallback
  `warehouseStock = totalStock` sumando TODAS las bodegas) se disparaba
  durante el bootstrap del POS mientras `useSite()` aún no resolvía
  (`siteId=null → whId=null → refreshData(null)`), y por race condition
  entre re-runs del `useEffect`.
- **Vector latente adicional**: sede sin `warehouse.is_primary=true` →
  `getWarehouseForSite` retorna null → mismo fallback dañino.

**Fix aplicado en commit `5fb37fd`**:
- `lib/inventory-actions.ts:getProductsWithStock` — sin `warehouse_id`
  devuelve `warehouseStock=null` (en vez de `totalStock`). `totalStock`
  se sigue exponiendo por separado.
- `app/pos/page.tsx` — `useEffect` con `if (!siteId) return` (evita
  disparar sin sede resuelta) + flag `cancelled` en closure con
  cleanup (evita race entre re-runs). Estado nuevo `warehouseError`
  bloquea el POS con mensaje si `getWarehouseForSite` retorna null.
- `app/inventory/products/page.tsx` — usa `warehouseStock ?? totalStock`
  para preservar la vista "todas las bodegas".
- `app/inventory/kardex/page.tsx` — `TYPE_LABELS.compra = "Compra
  (histórico)"` prepara post-Fase 2D.

Verificado end-to-end en navegador contra prod sede "El Carmen Hombres"
(PA-32-120-00 muestra "Inv. 8" = cantidad real de esa sede, no la suma
33).

**Task #15 backlog** creada: enforce "exactamente 1 warehouse.is_primary
por sede" — app + BD (todas las 6 sedes de prod cumplen hoy, pero el
código no valida).

### 7.4 Feature celular obligatorio al crear cliente (APLICADO)

Aplicado en commit `5fb37fd`:
- `lib/validators/customer.ts` — schema Zod compartido
  (`normalizePhoneCO`, `phoneCORequired`, `PHONE_CO_ERROR`) — 10 dígitos
  empezando en 3, strip automático de `+57` prefix.
- `components/pos/new-contact-dialog.tsx` — campo Celular obligatorio
  con feedback inline.
- `app/customers/page.tsx` — misma validación en el CRUD.
- `lib/actions.ts:createContact` y `:createCustomer` — validan phone en
  servidor y persisten valor normalizado. Walk-in exento (venta rápida
  no pide celular).

### 7.5 Ya en prod (verificado)

- Fix POS stock por sede (§7.3).
- Feature celular obligatorio (§7.4).
- `app/layout.tsx` — `lang="es" translate="no"` + meta
  `google:notranslate` (fix del bug de reconciliación React vs Google
  Translate).
- El commit `5fb37fd` de la rama `s1-s3p0-rpc-hardening` está pusheado a
  origin (verificado en la sesión 2026-08-11).

### 7.6 Regresiones atrapadas antes de romper prod

- **Filtros `.eq("status","active")` revertidos** en `getAdjustments()`
  y `getCentralPurchases()` de `lib/inventory-actions.ts`. Los había
  puesto como parte del commit de Fase 1 de ajustes; sin la migración 16
  aplicada, la columna `status` no existe en prod y esos filtros
  romperían la lista y el reporte. Revertidos con `TODO(fase-1-ajustes)`
  para re-agregarse en el commit que aplique la 16. Ver §0 de
  ESTADO-PENDIENTES.md — DEPENDENCIA CRÍTICA #1.

### 7.7 Actualizaciones al drift documentado

De la sesión de introspección MCP (baseline monolítico
[supabase/migrations/20260807042453_baseline_monolithic.sql](supabase/migrations/20260807042453_baseline_monolithic.sql)):

- Al concatenar `scripts/00-14` en orden emergieron **stubs adicionales
  de drift** que faltaban en §6.5.4 original:
  `business_settings, online_orders, online_order_items, product_images,
  web_order_items, user_sites, customer_accounts` (además de los ya
  documentados). El archivo `00_stubs.sql` en scratchpad los define
  minimal para poder aplicar el baseline en PG puro.
- **Ordenamiento**: `02_rls.sql` referencia tablas de `05_merge_features.sql`
  (stock_movements, user_profiles, suspended_sales, promotion_products).
  El baseline monolítico aplica 05 antes de 02.
- `scripts/09_security_revoke_anon_sensitive_fns.sql` referencia 4
  funciones drift (`admin_create_user`, `admin_reset_password`,
  `fulfill_web_order`, `update_online_order_status`). Saltado en el
  baseline para desbloquear el apply local.

### 7.8 Task #14 sigue pendiente

Captura canónica del baseline vía `supabase db pull` (o introspección
MCP exhaustiva). Requiere Pro para vía CLI; alternativa: introspección
por SELECT sobre `pg_catalog`/`information_schema` vía MCP
`execute_sql` — factible pero lenta por intermitencia del MCP. Ver §5 de
ESTADO-PENDIENTES.md.

---

Fin del contexto.
