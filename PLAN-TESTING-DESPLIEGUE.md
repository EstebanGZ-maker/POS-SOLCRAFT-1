# Plan de testing, correcciones y optimización para despliegue — POS-SOLCRAFT

> Fundamentado contra el código y la base de datos real (`nxszaxwsrtlofqimbfig`)
> el **31/07/2026**. Objetivo: dejar cada módulo probado, sin bugs conocidos y
> por debajo del presupuesto de rendimiento (`LCP < 1000 ms`) antes de desplegar.

---

## 1. Cómo vamos a probar (3 capas)

Cada módulo pasa por las tres, de la más barata y fiable a la más cara:

| Capa | Herramienta | Qué valida | Por qué |
|---|---|---|---|
| **DB / invariantes** | Supabase MCP (`execute_sql`, RPCs, `verify_kardex_integrity()`) | Transacciones atómicas, kardex cuadrado, RLS por rol, sobreventa | Es lo único que garantiza los principios rectores (stock y dinero) |
| **E2E automatizado** | Playwright (ya instalado, sin tests aún) | Flujos completos de usuario y regresión repetible | Blindaje antes de cada deploy; se corre en CI o a mano |
| **Navegador manual** | Chrome (herramientas de navegador) | UX, estados de carga, errores de interfaz que no salen en logs | Detecta lo que las otras dos no ven (layout, foco, mensajes) |

**Entorno:** Supabase MCP conectado + `pnpm dev` local. Medición de rendimiento
canónica con `node scripts/measure-perf.mjs` (regla de `PERFORMANCE.md`: una ruta
solo "pasa" si el script la reporta como `pass`).

**Regla de oro en cada módulo:** antes y después de tocar nada,
`SELECT * FROM verify_kardex_integrity();` debe devolver **0 filas**.

---

## 2. Hallazgos ya detectados (bloquean o condicionan el despliegue)

Estos salieron del linter de Supabase antes de escribir una sola prueba. Van
primero porque son transversales y varios son de seguridad real, no cosmética.

### 2.1 Seguridad — CRÍTICO (revisar antes de exponer el dominio)

| # | Hallazgo | Riesgo | Acción |
|---|---|---|---|
| S1 | **22 políticas RLS "always true"** en tablas de dinero/inventario: `sales`, `sale_items`, `transfers`, `transfer_items`, `pos_shifts`, `stock_movements`, `product_stock`, `accounting_entries`, `cash_movements`, `customers`, `suspended_sales`, `site_counters` | El `INSERT/UPDATE/DELETE` a nivel DB está abierto: cualquier usuario autenticado podría escribir saltándose el server. Hoy la defensa es solo `role-guard.ts` | Reescribir las políticas de escritura para que validen rol/sede (`is_admin_or_encargado()`, `has_site_access()`). Es defensa en profundidad, que el propio CLAUDE.md exige |
| S2 | **`admin_create_user` y `admin_reset_password` ejecutables por `anon`** vía `/rest/v1/rpc/...` | Escalada de privilegios: crear un admin o resetear contraseñas sin sesión | `REVOKE EXECUTE ... FROM anon, authenticated` y validar rol dentro de la función. **Máxima prioridad** |
| S3 | ~30 funciones `SECURITY DEFINER` ejecutables por `anon`/`authenticated` (incluye `apply_wompi_transaction`, `fulfill_web_order`, `update_online_order_status`) | Un anónimo podría marcar pedidos como pagados o cambiar estados | Revocar `EXECUTE` salvo las `public_*` del catálogo (esas sí deben ser públicas por diseño) |
| S4 | 1 ERROR: vista `public_availability` con `SECURITY DEFINER` | Evita RLS al leer | Recrear como `security_invoker` o justificar |
| S5 | 34 funciones con `search_path` mutable | Vector de inyección de esquema | `ALTER FUNCTION ... SET search_path = public, pg_temp` |
| S6 | Bucket `product-media` público permite listar todos los archivos | Enumeración de assets | Política de `storage.objects` que sirva por ruta, no listado |
| S7 | Protección de contraseñas filtradas (HaveIBeenPwned) desactivada | Contraseñas débiles/comprometidas | Activar en Auth settings |

### 2.2 Rendimiento — de aquí sale la optimización de "todas las consultas"

| # | Hallazgo | Impacto | Acción |
|---|---|---|---|
| P1 | **~24 foreign keys sin índice**, incluidas las calientes: `stock_movements.warehouse_id` y `.user_id`, `sales.warehouse_id`, `transfer_items.transfer_id`/`.product_id`, `pos_shifts.warehouse_id`, `accounting_entries.sale_id` | Seq scans en kardex, ventas por sede, recepción de traslados | Migración `08_perf_indexes.sql` con índices de cobertura (ver §5) |
| P2 | 4 políticas RLS re-evalúan `auth.<fn>()` por fila (`user_profiles`, `user_sites`, `customer_accounts`) | O(n) por consulta a escala | Envolver en `(select auth.<fn>())` |
| P3 | 3 tablas con múltiples políticas permisivas para el mismo rol/acción | Cada política se ejecuta en cada query | Consolidar políticas |
| P4 | ~22 índices sin uso (`idx_products_barcode`, `idx_sales_customer`, varios de `web_orders`/`online_orders`) | Escritura más lenta, espacio | Confirmar si la feature aún no se ejerce; si es muerta, eliminar tras verificar |

> Nota: los ~22 índices "sin uso" probablemente lo están porque el volumen es
> mínimo (3 productos, 2 pedidos web). No los borramos a ciegas: se re-evalúan
> **después** de correr la suite E2E, que sí ejercita esas rutas.

---

## 3. Preparación (Fase 0, antes del primer módulo)

1. `pnpm dev` corriendo; `node scripts/measure-perf.mjs` para **baseline** de todas las rutas → `perf-results.json` (identifica la `slowest`).
2. Sembrar datos de prueba mínimos y realistas: 2 sedes + central, ~20 productos con stock, 1 turno abierto, usuarios de cada rol (reutilizar `qa.multisede@solcraft.dev`).
3. Scaffolding de Playwright: `playwright.config.ts`, carpeta `e2e/`, helpers de login por rol y un `global-setup` que resetee a un estado conocido.
4. Snapshot de integridad: guardar salida de `verify_kardex_integrity()` (debe ser 0) como línea base.

---

## 4. Plan por módulo (núcleo crítico primero)

Orden acordado: **núcleo que toca dinero/stock primero**, resto después. Cada
módulo es un punto de control: se prueba → se corrigen bugs/mejoras → se re-mide →
se cierra contigo.

### Módulo A — POS / Ventas + Turnos de caja  🔴 núcleo
Archivos: `app/pos/`, `lib/actions.ts` (488 L), `lib/shift-actions.ts`, `lib/suspended-actions.ts`.

**Casos a probar**
- Venta atómica: crea `sale` + `sale_items` + `stock_movements` en una transacción; el servidor recalcula precio (nunca el cliente).
- **Bloqueo de sobreventa**: vender más que el stock de la sede debe fallar limpio.
- Concurrencia: dos cajeros venden la última unidad → solo una gana (lock de fila).
- Turnos: abrir/cerrar caja, arqueo, movimientos de efectivo; no vender sin turno abierto.
- Ventas suspendidas: suspender y retomar sin duplicar stock.
- Anulación (`void_sale`): revierte stock y deja rastro contable.

**Invariantes DB:** por cada venta, `SUM(stock_movements.quantity)` del producto/bodega baja exactamente lo vendido; kardex sigue en 0 descuadres.
**Optimización esperada:** índice `sales(site_id, created_at DESC)` y `sale_items(sale_id)`; evitar `select('*')` en el listado de ventas; medir ruta `/pos` y `/sales`.

### Módulo B — Inventario / Productos / Kardex  🔴 núcleo
Archivos: `app/inventory/*` (adjustments, kardex, management, products, price-lists, promotions, value, warehouses), `lib/inventory-actions.ts` (**1496 L, el más grande**), `lib/kardex-actions.ts`.

**Casos a probar**
- Catálogo único: código inmutable, un código = un modelo.
- Ajustes de inventario escriben su `stock_movement` en la misma transacción.
- Kardex por (producto, bodega) incluida bodega virtual Tránsito; multi-sede (que un encargado con 2 sedes vea ambas — regresión de M1 ya corregida, re-verificar).
- Listas de precios y promociones: el precio efectivo que devuelve el server.
- Valor de inventario y reporte de bajo stock (`get_low_stock_products`).

**Invariantes DB:** `verify_kardex_integrity()` = 0 tras cada ajuste.
**Optimización esperada:** este archivo de 1496 L es candidato #1 a N+1; revisar joins ocultos (item→producto→sede) con un solo `.select(...)`. Índices FK de §2.2. Virtualizar la tabla de inventario de bodega central (cientos de filas).

### Módulo C — Bodega central / Traslados  🔴 núcleo
Archivos: `app/central/`, `app/transfers/` (send, receive, reconcile), RPCs `send_transfer_via_transit`, `receive_transfer`, `reconcile_transfer`.

**Casos a probar** (M2/M3 ya cerrados — esto es regresión)
- Envío sede→sede y sede→central; origen = bodega de la sede activa, no hardcodeado.
- Seguridad: un encargado de La Ceja **no** puede despachar desde Marinilla ni central (hueco corregido en M2, re-verificar por API además de por UI).
- Recepción parcial con tope estricto; doble recepción rechazada; **rollback** si una línea falla.
- Bodega Tránsito no elegible como destino.

**Invariantes DB:** `traslado_salida` + `transito_entrada` cuadran; 0 descuadres; `receive_transfer` corre con `FOR UPDATE`.
**Optimización esperada:** índices en `transfer_items.transfer_id/product_id` y `transfers.status` (P1); medir `/transfers/receive`.

### Módulo D — Contabilidad
Archivos: `app/accounting/`, `lib/accounting-actions.ts`, `get_sales_summary`.
**Probar:** asientos generados por venta/anulación cuadran; reportes por rango de fecha/sede; acceso solo admin/contador (rol global).
**Optimización:** índice `accounting_entries.sale_id` (P1, ya detectado); `EXPLAIN ANALYZE` en el resumen; considerar vista materializada si recalcula en cada carga.

### Módulo E — Usuarios / Roles / Permisos
Archivos: `app/users/`, `lib/user-actions.ts`, `lib/permissions.ts`, `lib/role-guard.ts`, `user_sites`.
**Probar (matriz de roles):** admin/contador global vs encargado/vendedor por sede; RLS + `role-guard` como doble defensa. **Cerrar S1/S2/S3** aquí (RLS de escritura y revocar EXECUTE de `admin_create_user`/`admin_reset_password`).
**Optimización:** P2 (RLS initplan) en `user_profiles`/`user_sites`.

### Módulo F — Catálogo público / Carrito / Checkout / Wompi
Archivos: `app/catalog/*`, `lib/catalog-actions.ts`, `lib/cart-context.tsx`, `lib/wompi*.ts`, `app/api/wompi`, funciones `public_*`.
**Probar:** listado/detalle público (RPCs `public_catalog_*` deben seguir siendo `anon`), carrito, checkout, webhook Wompi (`apply_wompi_transaction`) — **verificar firma y que no lo pueda invocar cualquiera** (relacionado con S3). Estados de pago idempotentes.
**Optimización:** paginación en `public_catalog_list`; imágenes WebP/AVIF (ya activado con `sharp`), `loading="lazy"`, dimensiones fijas (0 CLS).

### Módulo G — Pedidos web (fulfillment)
Archivos: `app/web-orders/`, `lib/web-orders-actions.ts`, `fulfill_web_order`, `update_online_order_status`.
**Probar:** un pedido web se convierte en venta/despacho descontando stock atómicamente; `fulfill_web_order` no ejecutable por `anon` (S3).
**Optimización:** índices FK en `web_order_items.product_id`, `online_orders.*`.

### Módulo H — Dashboard + Settings
Archivos: `app/dashboard/`, `lib/dashboard-actions.ts`, `app/settings/`, `lib/business-settings-actions.ts`.
**Probar:** métricas por sede/rol correctas; configuración de negocio (recibo, datos) persiste.
**Optimización:** `dynamic import` de recharts (regla de `PERFORMANCE.md`) para no cargarlo en el bundle inicial.

---

## 5. Optimización transversal de consultas

Se ejecuta en paralelo a los módulos, siguiendo el orden de ataque de `PERFORMANCE.md`:

1. **Migración de índices** `scripts/08_perf_indexes.sql`: cubrir las ~24 FK sin índice (§2.2/P1), priorizando `stock_movements`, `sales`, `transfer_items`, `pos_shifts`. Índices compuestos para el `WHERE + ORDER BY` típico (ej. `sales(site_id, created_at DESC)`).
2. **RLS eficiente:** `(select auth.<fn>())` (P2) y consolidar políticas permisivas (P3) — se hace junto con la reescritura de RLS de S1.
3. **Backend:** matar N+1 en `inventory-actions.ts` y ventas; nunca `select('*')` en listados; paginar inventario/ventas; `unstable_cache` para datos de referencia (sedes, categorías, listas de precios).
4. **Frontend:** `dynamic import` de recharts y jsbarcode; virtualizar tablas largas; debounce 300 ms en búsquedas POS/inventario.
5. **Re-medir** cada ruta tocada con `node scripts/measure-perf.mjs --route <path>`; documentar cuellos que no bajen del presupuesto tras 3 intentos y seguir.
6. **Limpieza de índices muertos** (P4) solo **después** de correr la suite E2E completa, para no borrar uno que sí se usaba.

---

## 6. Checklist de pre-despliegue (go / no-go)

- [ ] `verify_kardex_integrity()` = 0 filas.
- [ ] Suite Playwright del núcleo (A, B, C) en verde.
- [ ] S1–S4 resueltos (RLS de escritura + revocar EXECUTE anon + vista SECURITY DEFINER).
- [ ] S5–S7 resueltos (search_path, bucket, leaked passwords).
- [ ] Advisors de Supabase sin ERROR y sin WARN de seguridad crítico.
- [ ] Todas las rutas del núcleo en `pass` en `measure-perf.mjs`.
- [ ] `pnpm build` sin errores; variables de entorno de producción definidas (`NEXT_PUBLIC_APP_URL`, claves Wompi, Supabase).
- [ ] M7 (reproducibilidad SQL): esquema versionado en `scripts/*.sql` para poder recrear el entorno.

---

## 7. Cómo trabajamos cada módulo

1. Te muestro el alcance concreto y los casos antes de tocar código.
2. Escribo/ejecuto las pruebas (DB → Playwright → Chrome).
3. Corrijo bugs y aplico la optimización de ese módulo.
4. Re-mido y re-verifico integridad.
5. Te muestro resultado y decisiones; ajustamos y cerramos.

**Punto de arranque propuesto:** Fase 0 (baseline + scaffolding Playwright) →
**Módulo A (POS/Ventas/Turnos)**, que es donde vive la venta atómica y el bloqueo
de sobreventa. En paralelo, S2 (revocar `admin_create_user`/`admin_reset_password`
de `anon`) por ser la corrección de seguridad más urgente y de bajo esfuerzo.
