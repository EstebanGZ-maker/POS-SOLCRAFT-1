# ESTADO-PENDIENTES.md

> **Propósito**: dump de estado para que una instancia nueva de Claude sin
> memoria pueda retomar sin perder nada. Última actualización: **2026-08-18**
> (release s9 + s10 APLICADO A PROD: fix carga infinita post-login + colapso
> de cascada bootstrap POS + scroll interno del sidebar. Merge commits
> `4d54ab7` s9 y `9d52f35` s10, deploy `dpl_7SeUqpRzsDgiExRAn577ZnfXtWsx`
> READY 50s de build, wompi webhook 200, runtime logs limpios).

---

## 0. LEE ESTO PRIMERO — estado tras sesión 2026-08-18 (POS perf + sidebar scroll)

**Estado de ramas**: ninguna rama de trabajo abierta. `main` en `9d52f35`
(merges `4d54ab7` s9-pos-loading-fixes + `9d52f35` s10-sidebar-scroll-fix).
Ramas `s9-pos-loading-fixes` y `s10-sidebar-scroll-fix` **borradas de
origin y local** tras el merge. Ramas históricas `s1-s3p0-rpc-hardening`,
`s2-adjustments-phase1`, `s3-credit-fiar-ui`, `s3p0-hotfix-to-main`,
`merge-s1-s3p0-to-main` siguen en origin como legado — no bloquean nada.

**Prod (`nxszaxwsrtlofqimbfig`)**: kardex OK
(`verify_kardex_integrity()`=0), credit OK
(`verify_credit_integrity()`=0), ajustes-contabilidad OK
(`verify_adjustment_accounting_integrity()`=0). Sirviendo
`dpl_7SeUqpRzsDgiExRAn577ZnfXtWsx` (sha `9d52f35`, target=production,
READY 50s de build el 2026-08-18, alias `app-solcraft.com`). Deploy
anterior `dpl_5FZTwJNSPUVyCrngvbTeDvpCPvkk` (sha `892f647`) queda como
rollback candidate. `GET /api/wompi/webhook` responde HTTP 200 con
`{ok:true, configured:false}`. Runtime logs limpios (0 errores últimos
15 min post-deploy, todos 200/304, todos apuntando al deploy nuevo).

**Nota de cadencia de release s9 + s10**: los dos merges fueron
empujados juntos en un solo `git push origin main`, no en dos deploys
escalonados. Historia git limpia con 2 merge commits separados
(`4d54ab7` s9 y `9d52f35` s10) más 2 commits de fix internos
(`43d53a4` s9 y `90fe7d6` s10), pero Vercel corrió un único build de
prod. En caso de regresión hay que revisar los 3 archivos combinados
(`lib/site-context.tsx`, `app/pos/page.tsx`, `lib/inventory-actions.ts`
del s9 + `components/dashboard-sidebar.tsx` del s10) — el rollback por
componente independiente requiere revert manual de commits en vez de
promote de deploy previo.

**Deuda técnica identificada, NO cerrada**: cold-start de infraestructura
en `/pos` sigue generando ~4–6 s de latencia percibida en frío (primera
carga tras idle largo o desde ventana privada). Causa raíz identificada
esta sesión: (i) cold-start del serverless de Vercel para la ruta `/pos`
(~500–1500 ms típico); (ii) `getSites()` en el SiteProvider dispara
antes del POS mismo y sale a Supabase con conexión fría del pool
pgbouncer + JWT decode + PostgREST warmup — medido 1356 ms p95, 1690 ms
max en edge_logs sobre una tabla de 6 filas cuyo `EXPLAIN ANALYZE` es
0.15 ms de ejecución (todo el tiempo es infra, no DB); (iii) al colapsar
la cascada del bootstrap a 6 requests paralelas de server actions (s9
Ronda 1), si excede la concurrencia de la instancia caliente Vercel
spawnea una segunda lambda cold — vista en el smoke del usuario como
un outlier de 2.49 s dentro de la tanda paralela. Warm ya mejoró
~300–500 ms confirmado en Network waterfall. Opciones para bajar el
techo cold, **evaluadas y NO implementadas** (decisión de costo/
beneficio pendiente del usuario):
- Vercel Fluid Compute / concurrent invocations on warm instance —
  requiere revisión del plan actual (Hobby vs. Pro) y ajuste de
  `vercel.json`. Bajo esfuerzo, elimina el spawn cold del outlier.
- Consolidar las 6 server actions en 1 sola que haga `Promise.all`
  server-side (evita spawn extra manteniendo paralelismo DB) —
  ~30 min de trabajo, bajo riesgo.
- Edge Runtime en server actions read-only — complejidad media con
  supabase-js, elimina el cold start Node.
- Warm-connection al pgbouncer via ping periódico — hack, no fix real.
La Ronda 2(a) investigación (EXPLAIN ANALYZE sobre `getSites`) confirmó
que **NO hay índice ni policy que agregar** — el fix real vive del lado
de infra/edge, no del schema.

**Deuda técnica identificada, NO cerrada** (2026-08-18, encontrada en
smoke de s11-ai-ingress-feedback): errores de nivel-framework de
Server Actions (413 body exceeded, network, timeout, deploy en curso)
escapan al try/catch cliente y disparan el ErrorBoundary/mensaje
genérico de Next.js "An error occurred in the Server Components
render" — el feedback amigable diseñado en s11 (toast, card roja con
mensaje legible) NO se muestra en esos casos porque la excepción
ocurre antes de que el promise cliente resuelva y React la eleva al
boundary. Mitigado en s11 subiendo `bodySizeLimit` a 20 MB y agregando
guard pre-flight de 5 MB en `handleFiles` (coincide con
`MAX_IMAGE_BYTES` server-side), cerrando la ventana práctica de 413
para el flujo IA. Ventanas residuales: (i) timeouts/network fails en
uploads legítimos <5 MB, (ii) otros flujos de Server Action con
payload grande (bulk transfers si crecen). **Solución robusta pendiente,
no incluida**: refactorizar `uploadProductMedia` a upload
client-side directo a Supabase Storage (`supabase.storage.from(...)
.upload(file)` con anon key + RLS), ~60-100 líneas. Elimina el hop
Server Action por completo para el binario, con lo cual todos los
framework errors (413, timeout, deploy) desaparecen para uploads.
Decisión de scope + prioridad pendiente del usuario.

**Módulo Ajustes de Inventario**: **cerrado end-to-end en prod**.
Fase 1 (RPC atómico) + 2A (numeración) + 2B (WAC) + 2C v2 (motivo +
capitalización sin asientos) + 2D (unificación entradas TS + UI motivo/
WAC + validación cost>0) + Fase 3 (UI detalle + anular) — TODO
deployed. Sin sub-fases pendientes.

**Gates humanos abiertos**: solo uno, no bloqueante — re-confirmar con
contador si "sobrante" alguna vez necesita tratamiento distinto de
"compra" (caso de sobrante sin costo real: donación, hallazgo sin
factura). Definición actual acotada a "mercancía comprada y pagada
pero no registrada a tiempo". Ver §4 tabla. Motivo nuevo separado
(`hallazgo`/`donacion`) queda fuera de alcance hasta que aparezca el
caso real.

**Cleanup ejecutado post-release triple**:
- Branch Supabase `validate-2c-v2-cogs` (`qqnpdhjxzfiwzbrtywym`)
  eliminado.
- Rama git `s8-adjustments-2c-v2-cogs` eliminada de origin y local.
- **Pendiente para el usuario** (no bloqueante): si se agregaron env
  vars scoped a la rama `s8-adjustments-2c-v2-cogs` en Vercel Settings
  → Environment Variables (para smoke visual local §5 del runbook),
  borrarlas — la rama ya no existe y la config quedaría huérfana.
- `main` y `origin/main` sincronizados (`git status` limpio).

**Próximo bloque**: sin definir. Al arrancar la próxima sesión, el
usuario decide el siguiente foco (cold-start de `/pos` según opción
elegida arriba, promociones aplicadas en POS, mejoras UX Alegra-like,
otras deudas del §5 backlog). Ver §5 "Backlog vigente" y §1 "Cola de
trabajo escrito-pero-no-aplicado" para candidatos.

### ✅ CERRADO Y DEPLOYED — s9 POS loading fixes + s10 sidebar scroll (2026-08-18)

Dos ramas independientes mergeadas a main en la misma sesión, empujadas
juntas en un solo `git push origin main`. Vercel corrió un único build
de prod (`dpl_7SeUqpRzsDgiExRAn577ZnfXtWsx`, READY 50s, alias
`app-solcraft.com`). Smoke post-deploy limpio (webhook 200, runtime
logs 0 errores últimos 15 min).

**s9-pos-loading-fixes** (merge `4d54ab7`, fix commit `43d53a4`):

Problema 1 — carga infinita post-login sin recargar manualmente.
Diagnóstico: SiteProvider ([lib/site-context.tsx](../lib/site-context.tsx))
usaba key SWR estática `"site-bootstrap"`. Race con
`signInWithPassword` + `router.push("/dashboard")`: si la server action
`getSites()` corría antes de que la cookie de sesión estuviera escrita,
`getAccessibleSiteIds()` devolvía `[]`, SWR cacheaba ese vacío y
`revalidateOnFocus:false` impedía el retry. `currentSite` quedaba
`null` para siempre; POS mostraba "Cargando…" indefinidamente. Fix de
scope de productos por sede (s4) expuso el bug al eliminar el fallback
silencioso a `whId=null`.

Fix: key condicional dependiente de `useAuth()`. `null` mientras
`authLoading`, `["site-bootstrap", user.id]` cuando resuelto, `null` si
no hay user. SWR no fetchea hasta que auth resuelva y refetchea limpio
al cambiar de usuario (logout/login como otro). Cubre login flow, hard
refresh en otra ruta y token refresh mid-session. Elegido sobre
`useEffect(mutate)` reactivo porque evita el frame intermedio con `[]`,
y sobre "esperar sesión en login-form" porque esa sola no cubre hard
refresh ni token refresh.

Problema 2 (Ronda 1) — /pos tardaba ~6 s al cargar.
Bootstrap en [app/pos/page.tsx](../app/pos/page.tsx) tenía 3 tandas
seriales: `getWarehouseForSite` → `Promise.all([refreshShift,
refreshData])` → `Promise.all([priceLists, promos])`. Solo la primera
dependencia era real (whId). Colapsado a 2 tandas: `getWarehouseForSite`
→ un único `Promise.all` con las 6 queries restantes
(`getCurrentShift`, `getProductsWithStock`, `getCustomers`,
`getCategories`, `getPriceListsForPOS`, `getActivePromotionsForPOS`).
`getShiftReceivables` sigue como piggyback fire-and-forget post-render.

Filtro `is_active`: agregado a `getProductsWithStock`
([lib/inventory-actions.ts](../lib/inventory-actions.ts) —
`products.is_active` existe NOT NULL default true, verificado antes de
tocar). **NO agregado** en `getCustomers` porque `customers.is_active`
no existe en el schema (solo `is_walk_in`, semántica distinta);
requeriría cambio de schema — decisión de producto para otra sesión.

Ronda 2(a) investigación (no aplicada): `EXPLAIN ANALYZE` sobre
`SELECT * FROM sites ORDER BY is_central DESC, name` en prod con RLS
authenticated devolvió Planning 0.4 ms + Execution 0.15 ms sobre 6
filas, `sites_read` policy = `true` (sin filtro). Los 1356 ms p95 vistos
en edge_logs son 100% cold-connection pool + PostgREST warmup — no hay
índice ni policy que agregar. Ver "Deuda técnica identificada, NO
cerrada" arriba para opciones de fix del cold-start.

Smoke test usuario confirmado en preview antes del merge:
- Fix carga post-login OK (login limpio + hard refresh en `/pos`).
- Regresión producto inactivo OK (ya no aparece en el grid, sigue
  visible en /inventory/products que usa otra query).
- Venta end-to-end OK (abrir turno → agregar producto → cobrar contado
  → recibo).
- Warm (segunda visita) medido en Network waterfall: tanda paralela
  ~1.2 s → mejora ~300–500 ms sobre el estimado warm previo. Cold
  outlier de 2.49 s dentro de la tanda paralela — spawn de segunda
  lambda cold documentado como deuda técnica arriba.

**s10-sidebar-scroll-fix** (merge `9d52f35`, fix commit `90fe7d6`):

Diagnóstico: el sidebar
([components/dashboard-sidebar.tsx](../components/dashboard-sidebar.tsx))
YA tenía `flex-1 overflow-y-auto` en la lista de navegación (mobile
línea 213 y desktop línea 232). No scrolleaba por el bug clásico de
flexbox: un flex item con `flex: 1 1 0%` tiene `min-height: auto` (no
`0`) por default, entonces el contenedor se estira al alto del
contenido y el overflow nunca se activa. Usuario terminaba haciendo
zoom-out del navegador para ver "Gestión de inventario" y siguientes
del grupo Inventario.

Fix: `min-h-0` en el contenedor scrollable (mobile + desktop). `shrink-0`
defensivo en header (`h-16`) y footer (`border-t p-4`) para que no se
compriman cuando aparece la barra. `overflow-y-auto` pinta scrollbar
solo con overflow real → en pantallas altas no aparece scrollbar
innecesaria. Solo la lista de navegación scrollea; header y botón
"Cerrar sesión" quedan fijos.

Smoke test usuario confirmado en preview antes del merge: scroll
interno operativo en preview.

### ✅ CERRADO Y DEPLOYED — Release triple 2C v2 + COGS + 2D (2026-08-18)

Aplicado a prod (`nxszaxwsrtlofqimbfig`) en ventana única el 2026-08-18.
Método contable aprobado por el contador 2026-08-17: **capitalización al
comprar (WAC) + reconocimiento COGS al vender**. Reemplaza el diseño
original de "compra → expense inmediato" (que estaba pendiente de
validación en 17c v1, ahora invalidado). Detalles en
[docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2/§6.4/§6.5](INVENTORY-ADJUSTMENTS-SPEC.md).

**SQL aplicado**:
- `apply_17c_v2_adjustments_no_expense` — `create_adjustment` firma 4-arg
  con `p_motivo`, sin asientos de incrementos (los 3 motivos capitalizan
  vía WAC ya activo desde 2B), mantiene asiento de merma para
  disminuciones. FK `accounting_entries.adjustment_id` (D4).
  `verify_adjustment_accounting_integrity()`.
- `apply_17e_cogs_in_sales` — `ALTER sale_items ADD unit_cost NUMERIC(12,2)`.
  `create_sale` persiste `unit_cost` desde `products.cost` al momento de
  la venta + emite 1 asiento agregado `expense "Costo de mercancía
  vendida"`. `void_sale` reversa COGS desde `sale_items.unit_cost` (no
  `products.cost` vivo, para reverso exacto contra descuadre por WAC
  intermedio); early return con `amount_paid=0` eliminado para que la
  reversa COGS aplique también en ventas a crédito Caso C.

**TS merged** (sha `892f647`, merge `--no-ff` desde `s8-adjustments-2c-v2-cogs`):
- `lib/inventory-actions.ts`: `createAdjustment` delega al RPC 4-arg
  (elimina el patrón multi-step no-atómico pre-Fase 1);
  `receiveMerchandise` pasa `motivo='compra'`; `ingressNewProduct`
  delega en `createAdjustment` (elimina el INSERT directo a
  `accounting_entries` viejo — coherente con método nuevo, ese asiento
  ahora se reconoce como COGS al vender).
- `components/inventory/adjustment-dialog.tsx`: selector Compra/Sobrante/
  Corrección (obligatorio con incrementos, deshabilitado en 100% merma),
  fila por producto muestra "WAC actual" como referencia.
- `components/inventory/product-form-dialog.tsx`: validación `cost>0`
  para productos físicos nuevos (bloqueo de submit, servicios exentos).

**Verificación post-deploy** (smoke §3 del runbook, 2026-08-18):
- §3.1 Compra Central: adj #3, motivo='compra', **0 asientos** (método
  nuevo NO asienta al comprar), WAC=60000 sin cambio, stock 28 → 29.
- §3.2 Venta contado 1 pantalón @ 80000: unit_cost=60000 persistido,
  income=80000, COGS=60000, 2 asientos, WAC no cambia al vender,
  utilidad bruta = 20000.
- §3.3 Anular ambos: void_sale → 4 asientos (income venta + expense COGS
  + expense anulación + income reversión COGS), **neto=0**;
  void_adjustment → 0 asientos (no había ninguno en el original),
  **neto=0**. Stock y WAC restaurados al valor pre-test.
- `verify_kardex_integrity()`=0, `verify_credit_integrity()`=0,
  `verify_adjustment_accounting_integrity()`=0.

**Rollback disponible**: `scripts/17rollback_2c_v2_and_cogs.sql` (probado
en branch validate-2c-v2-cogs pre-deploy). Restaura las 3 RPCs al estado
post-2A+2B; columnas nuevas se dejan intactas para no matar datos ya
insertados. Riesgo residual documentado en el header del script.

**Cleanup ejecutado post-deploy**:
- Branch Supabase `validate-2c-v2-cogs` (`qqnpdhjxzfiwzbrtywym`)
  eliminado.
- Rama git `s8-adjustments-2c-v2-cogs` eliminada de origin y local.
- **Pendiente para el usuario**: si se agregaron env vars scoped a
  `s8-adjustments-2c-v2-cogs` en Vercel Settings → Environment Variables
  (para el smoke visual local §5 del runbook), borrarlas ahora — la rama
  ya no existe, quedarían huérfanas.

### ✅ CERRADO Y DEPLOYED — Ajustes Fase 2A + 2B (numeración + WAC)

Aplicado a prod (`nxszaxwsrtlofqimbfig`) 2026-08-17. Registrado como
migraciones `apply_17a_adjustments_numeracion` y `apply_17b_adjustments_wac`
en `supabase_migrations.schema_migrations`. **Sin cambio de firma pública
del RPC** (`create_adjustment(UUID, TEXT, JSONB)`) — código app existente
sigue funcionando sin edición.

**Cambios en prod**:
- Tabla nueva `adjustment_counters(site_id PK, last_numero)`. Seed 0 por
  sede existente + fallback on-the-fly (DN3) para sedes creadas después.
- `create_adjustment` v2b: numera atómicamente por sede vía
  `UPDATE ... RETURNING`; recalcula `products.cost` con WAC en items
  `incrementar` con `cost>0` (orden: LOCK products → READ stock global
  BEFORE → adjust → recalc, spec §5.1.1).
- `products.cost` es global (todas las bodegas, D6). En disminuciones
  NO cambia (D2). Void NO revierte WAC (D5) — la UI de anulación ya
  muestra el warning correspondiente desde Fase 3.
- Ajustes históricos (5 pre-2A) siguen con `numero=NULL` (no se hace
  backfill — decisión spec §7).

**Validación previa**: branch desechable `validate-phase2-adjustments`
(borrado post-verificación). Se aplicó 2A+2B+2C al branch y corrieron
los 8 tests del script (`T1-T8` en `scripts/17_validation_phase2.sql`) —
todos OK. Se corrigieron 2 typos del script (línea 133 esperaba
`15000/15` cuando debía ser `20000/15`; línea 347 esperaba counter=6
cuando el escenario real deja counter=7). RPCs correctos, script tenía
las expectativas mal calculadas.

**Post-verificación en prod**: 2 ajustes reales de prueba (Pantalón jean
clásico, +2 y +3 unidades) → numero=1, numero=2 secuencial correcto;
WAC calculado exacto en ambos casos (61935.48 y 65294.11, ambos
= fórmula esperada). Ambos anulados con `void_adjustment` para dejar
stock en 29 igual que pre-test. Cost restaurado manualmente a 60000
con UPDATE directo (D5: void no revierte cost automáticamente; en un
producto real de prod que se usó para el test, se corrige a mano en vez
de dejarlo movido).

**Estado post-apply verificado**: `verify_kardex_integrity()=0`,
`verify_credit_integrity()=0`.

**Gate contador RESUELTO 2026-08-17 con cambio de método**: se adopta
capitalización + COGS al vender (opción a1 del análisis original,
extendida a `sobrante`). 17c v1 queda invalidado. **Release triple
acoplado** para prod (misma ventana): (a) SQL 17c v2 sin asientos de
incrementos; (b) SQL cambio `create_sale`+`void_sale` con COGS
persistido en `sale_items.unit_cost`; (c) TS 2D refactor callers + UI.
NO se pueden fasear los tres — cualquier subset introduce regresión
contable (detalle en §1.3 y bloque "GATE CONTADOR RESUELTO" abajo).

### ✅ CERRADO Y DEPLOYED — MoneyInput con formateo en vivo (18 sitios)

Rama `s7-money-input-live-format` mergeada a main (merge commit `e711ccb`).
Iteración incremental: primero se creó el componente reusable + migraron
los 18 sitios con reformateo on-blur en `s6-money-input-format`, después
se hizo upgrade a formateo EN VIVO en `s7` (mismo contrato de props, solo
cambia el mecanismo interno). Ambos flujos verificados por el usuario en
preview antes del merge; s7 quedó como ancestro-superset de s6 (contiene
sus 2 commits + el upgrade), por eso se hizo un único merge s7 → main.

**Componente** (`components/ui/money-input.tsx`, ~80 líneas):
- Wrapper sobre `<Input>` de shadcn usando `NumericFormat` de
  **react-number-format@5.4.4** (pineada exacta, coherente con la deuda #21
  del backlog de evitar `"latest"` en `package.json`).
- Configuración COP: `thousandSeparator="."`, `decimalSeparator=","`,
  `decimalScale=0` (sin decimales), `allowNegative=false`,
  `inputMode="numeric"` (teclado numérico en mobile).
- Contrato de props: `value: number | null | undefined`,
  `onChange: (n: number | null) => void`, `emptyAsNull` (default `false`),
  más `id, className, placeholder, disabled, autoFocus, onBlur, onFocus,
  autoComplete`.
- **Formateo en vivo** con manejo automático de cursor (la lib recoloca el
  caret ignorando los puntos al insertar/borrar dígitos en cualquier
  posición). Auto-select on focus (preservado del comportamiento previo).
- Copiar/pegar `"1.500.000"` limpia puntos automáticamente.

**18 inputs migrados en 12 archivos** (detalle exhaustivo en el commit
interno `53113ac`; tabla de decisiones `emptyAsNull` por sitio en el
reporte de sesión):
- POS: `payment-dialog` (abono inicial fiado, monto recibido efectivo),
  `edit-line-dialog` (precio base), `open-shift-dialog` (base inicial),
  `close-shift-dialog` (dinero contado, `emptyAsNull` para preservar
  botón Guardar disabled cuando vacío), `cash-movement-dialog` (monto,
  `emptyAsNull` + toast si vacío).
- Crédito: `register-payment-dialog` (monto del abono, `emptyAsNull` +
  botón disabled).
- Inventario: `adjustment-dialog` (costo línea), `product-form-dialog`
  (costo inicial, precio base), `price-lists` (override, `emptyAsNull`).
- Bodega central: `BulkSend` (precio mayorista), `ReceivePanel` (costo
  entrada), `ai-ingress-panel` (precio venta, costo adquisición).
- Contabilidad: `entry-dialog` (monto asiento).
- Settings: `receipt` (costo envío, umbral envío gratis `emptyAsNull`).

**Fuera de scope**: 2 filtros de búsqueda mín/máx en `/central` (precio
mínimo/máximo para filtrar el catálogo) siguen como `type="number"` sin
formateo por decisión explícita — no son montos monetarios que se
persistan, solo criterios de filtro.

**Deuda menor arrastrada de esta PR**: `BusinessSettings.shipping_cost`
sigue como `number` (no nullable). La intención UX (vacío = "no
configurado" ≠ 0 = "envío gratis") NO se respeta hoy: el `MoneyInput` de
`app/settings/receipt/page.tsx` para "Costo de envío" usa
`emptyAsNull=false` (vacío se coerce a 0) porque widening a
`number | null` requeriría (a) alterar la columna a NULLable en Supabase,
(b) widening del tipo TS en `lib/business-settings-actions.ts`,
(c) cambiar el `MoneyInput` a `emptyAsNull` + parent que persista null,
(d) auditar `app/catalog/*` para manejar `shipping_cost = null` como "no
cobrar envío" o el default que decida el negocio. `free_shipping_over` sí
quedó con `emptyAsNull=true` porque su tipo ya era `number | null`.

**Smoke test verificado por el usuario en preview** antes del merge
(`dpl_gwupsrfqoVuPU7wtE5WjHwqe9Jh5`, s7):
- Formateo en vivo al tipear dígito por dígito.
- Click con el cursor en medio del número + inserción → caret queda en
  la posición correcta ignorando el punto insertado.
- Backspace antes de un punto → borra el dígito correcto, no el punto.
- Cierre de turno con input vacío → botón Guardar sigue disabled
  (contrato `null` preservado tras el upgrade).

### ✅ CERRADO Y DEPLOYED — Crédito Fase 3 (CxC completo, ciclo end-to-end)

Rama `s5-credit-phase3-ui` mergeada a main (merge commit `28109a0`).
Cierra el ciclo end-to-end del módulo de crédito: **fiar → abonar → anular
con abonos → redimir saldo a favor**.

**BD (script `18_credit_phase3.sql`, aplicado a prod vía `apply_migration`
en la misma sesión antes del código)**:
- **RPC `register_payment(sale_id, amount, method, shift_id?, notes?)`**
  SECDEF con FOR UPDATE del sale, guard D9 (cash sin shift → RAISE),
  asiento income `'Abono crédito'`, `received_by` derivado de `auth.uid()`
  (D11).
- **RPC `apply_customer_credit(sale_id, amount, shift_id?)`** SECDEF con
  lock sobre `customer_credits` del cliente (FOR UPDATE sobre filas primero,
  luego SUM aparte — Postgres no permite FOR UPDATE con aggregate),
  asiento income `'Redención saldo a favor'` (D14 bloqueante — sin él la
  P&L diverge del cash real total del ciclo), `sale_payments.payment_method
  = 'credito_favor'` (no infla arqueo).
- **`create_sale` v3**: hardening D9 server-side (era solo cliente-side
  desde Fase 2A). Guard también valida shift open + misma sede cuando
  `p_shift_id` viene.
- Validado en branch Supabase con 21/21 tests (regresión v2==v3,
  guards D9, register_payment edge cases, ciclo void→credit→redemption
  traza spec §6.1). Bug menor encontrado en primera pasada: `FOR UPDATE`
  con `SUM(amount)` — corregido antes de aplicar a prod.

**Código (commits internos)**:
- `09f6055` server actions (`registerPayment`, `applyCustomerCredit`,
  `getReceivables`, `getShiftReceivables`, `getCustomerCreditBalance`,
  `getSalePayments`) + UI (`RegisterPaymentDialog`,
  `ShiftReceivablesSheet`, botón "Fiados del turno" en header POS,
  ruta `/receivables`). Lecturas con `requireRole` incluyendo
  contador; mutaciones sin contador.
- `63312c6` UX guard rol contador: oculta CTA "Registrar abono" en
  `/receivables` y `ShiftReceivablesSheet` client-side (defensa en
  profundidad — la mutación ya está bloqueada server-side). PageHeader
  cambia a "Vista de solo lectura. Los abonos se registran desde el POS."
- `f93b479` sidebar link "Cuentas por cobrar" en grupo Contabilidad
  (siteOnly=true, junto a Ventas/Clientes) con ícono `HandCoins`. Nuevo
  `ModuleKey = "receivables"`. Defaults por rol agregan `receivables` a
  contador/encargado/vendedor (admin lo tiene por default).

**Deuda D9 cerrada**: `create_sale` server-side ahora rechaza cash sin
turno. Guard cliente-side (payment-dialog.tsx) queda como defensa en
profundidad.

**⚠️ RECORDATORIO OPERATIVO — usuarios existentes NO ven el link
'Cuentas por cobrar' automáticamente**: `ROLE_DEFAULT_PERMISSIONS` solo
aplica al **crear** nuevos usuarios (o al reset explícito de permisos).
Usuarios pre-existentes tienen `user_profiles.permissions[]` congelados
desde su creación. Para que vean el link nuevo, un admin debe **agregar
manualmente `'receivables'`** a sus permisos desde `/users`. Mismo
comportamiento cuando se agregó `web_orders` en una fase previa. No es
bug — es política del sistema.

**Smoke test confirmado por el usuario en preview** (deploy
`dpl_2mXYCDTvtHASgURKk6txW2QhNMQC`) antes del merge:
- POS: fiar + botón "Fiados del turno" con badge count + drawer + abono
  cash con turno + abono no-cash sin turno + guard cash-sin-turno.
- `/receivables`: agrupado por cliente, buckets 0-30/31-60/60+, saldo a
  favor, expand por cliente, botón abono por venta.
- Guard rol contador: link visible en sidebar, vista solo lectura, CTA
  ocultos, sin errores crudos del RPC.
- Sidebar link visible en preview.

**Branch Supabase de validación** (`credit-sales-phase1-validation`,
`oxramdmsllprpxbhkhmi`): **BORRADO** post-merge (`delete_branch` OK).
Ya no aporta valor.

### ✅ CERRADO Y DEPLOYED — Ajustes Fase 1 (scripts/16 + swap deleteAdjustment)
Rama `s2-adjustments-phase1` mergeada a main (merge commit `af31a01`, commit
interno `231838d`). BD: `apply_migration` a prod OK, invariante kardex
intacto (pre=0, post=0). Código: `.eq("status","active")` re-agregado en
`getAdjustments` y `getCentralPurchases`, función `deleteAdjustment` borrada
(dead code post-swap), lista de ajustes ahora usa `voidAdjustment` (RPC
SECDEF). Ver detalle abajo (§1.2).

### ✅ CERRADO Y DEPLOYED — Scope productos por sede
Rama `s4-inventory-products-scope` mergeada a main (merge commit `e16b976`,
commit interno `f71fc2b`). `/inventory/products` ahora arranca por default
en la bodega primary de `currentSite` (misma que el POS), con badge de
scope + subtítulo de columna en modo "Todas las bodegas". Elimina la
confusión "Inv. 2 en POS vs. 29 en Productos y Servicios" que no era bug
sino UX diferencial (default agregado vs. sede activa).

### ✅ CERRADO Y DEPLOYED — Crédito Fase 2 (mínimo) "fiar desde POS"
Rama `s3-credit-fiar-ui` mergeada a main (commit `344bbd2`). Vercel prod
`dpl_8NZNqZ5bkCMRFXWvmFgBw7qvTwWd` READY, alias `pos-solcraft-1.vercel.app`.
Runtime logs limpios (0 errors últimos 15 min post-merge). Webhook Wompi
intacto (`GET /api/wompi/webhook` → 200 `{ok:true, configured:false}`).

Smoke test confirmado por el usuario en el preview antes del merge:
- Regresión buildBalance OK — venta contado normal, `expected_cash` idéntico
  a antes del cambio a `get_shift_balance`.
- Fiado con abono parcial cash OK — "Recibido hoy" y arqueo solo suman el
  abono, no el `total_amount` de la venta.
- Fiado sin abono OK — no altera el arqueo (`Recibido hoy` no sube, cash
  bucket no sube).
- Bloqueo sin turno abierto: aceptado como está (outer gate de `startSale`
  bloquea con toast antes de abrir el diálogo; el guard inline
  `initialCashNeedsShift` queda como defense-in-depth para un futuro
  refactor).

Alcance de esta entrega (sin `register_payment`/CxC): habilitar botón "Fiar
(crédito)" en el diálogo de pago del POS, permitiendo abono inicial 0..total
en `Efectivo/Tarjeta débito/Tarjeta crédito/Transferencia`.

Cambios:
- **[lib/shift-actions.ts]** `buildBalance()` reemplazada por llamada al
  RPC `get_shift_balance` (fuente única compartida con `close_shift`).
  Cierra **D10** del spec crédito (deuda que quedó abierta en el deploy de
  Fase 1: el RPC existía pero el TS seguía usando la clasificación por
  substring sobre `sales.payment_method` — bug que hubiera reportado
  arqueos incorrectos apenas alguien fíe con abono cash). Buckets no-cash
  (`debit/credit/transfer/other_sales`) ahora vienen de `sale_payments`
  filtrando `status='active'` con el classifier operando sobre el método
  REAL del pago; no del label `'crédito'` del header.
- **[lib/actions.ts]** `createSale()` extendida: `payment` acepta
  `is_on_account?: boolean` + `initial_payment?: number | null`. Se propagan
  como `p_is_on_account` + `p_initial_payment` al RPC v2. Backwards-compat
  total (defaults FALSE / NULL).
- **[components/pos/payment-dialog.tsx]** Nuevo `MethodCard "Fiar (crédito)"`
  en step 1. Deshabilitado con tooltip si no hay cliente / cliente es
  walk-in / `allows_credit=false`. Step 2 en modo fiado ofrece input de
  abono inicial (opcional, 0..total, quick-options `[Sin abono, total]`)
  + dropdown de método del abono (solo si abono > 0, default Efectivo).
  Guard client-side: `abono > 0` + método Efectivo + sin turno abierto →
  botón Continuar deshabilitado con mensaje inline.
- **[app/pos/page.tsx]** Interface `Customer` extendida con
  `allows_credit + is_walk_in` (los datos ya venían del `select("*")` de
  `getCustomers()`). Pasa `customer` + `hasOpenShift` al PaymentDialog.
  Toast diferenciado para venta a crédito vs contado.

Findings del RPC `create_sale` v2 confirmados en el source real:
- `sales.payment_method` siempre queda `'crédito'` (hardcoded) cuando
  `is_on_account=true`; `p_payment_method` se usa para el método del abono
  inicial en `sale_payments`.
- `p_shift_id` **no es validado** por el RPC (ni siquiera cuando el abono
  inicial es cash). El guard vive cliente-side en la UI. Deuda para
  endurecer en Fase 2 real (mismo patrón que D9 del spec para
  `register_payment`).

**✅ Crédito Fase 3 CERRADO Y DEPLOYED** — ver bloque nuevo al inicio de
esta sección §0 ("Crédito Fase 3 (CxC completo, ciclo end-to-end)"). El
ciclo completo del módulo de crédito (fiar → abonar → anular → redimir)
funciona end-to-end en prod. Deuda D9 en `create_sale` v2 también cerrada
como parte de Fase 3 (`create_sale` v3 con guard server-side).

**✅ MoneyInput CERRADO Y DEPLOYED** — ver bloque nuevo al inicio de
esta sección §0 ("MoneyInput con formateo en vivo"). 18 sitios de
dinero migrados a formato COP con separador de miles en vivo.

Deudas menores dejadas por Fase 3 (no bloquean nada):
- **§8.1 crear cliente inline** — cuando el usuario elige "Fiar" y el
  cliente actual no cumple, hoy solo mostramos tooltip informativo. El
  spec pedía CTA "Crear cliente nuevo →" con el `NewContactDialog`
  existente. Trivial de agregar cuando se decida.
- **walk-in detection por nombre** — `app/pos/page.tsx:240-241` sigue
  buscando el walk-in por `name === "Consumidor final" || "Walk-in Customer"`.
  Migrar a `is_walk_in=true` (spec Fase 1 §8.11). No crítica.
- **Reporte "ventas por método" contando `credito_favor`** — si en el
  futuro se hace un reporte que agrupe `sale_payments.payment_method`,
  `'credito_favor'` inflaría "no-cash" sin ser plata real. Documentar
  cuando exista ese reporte.

### ✅ CERRADO Y DEPLOYED — Ajustes Fase 1 (scripts/16)
- **BD**: aplicado a prod (`nxszaxwsrtlofqimbfig`) vía `apply_migration` en
  la sesión 2026-08-15. Baseline kardex pre-apply: 0 violaciones; post-apply:
  0 violaciones — invariante `SUM(stock_movements) = product_stock` intacto.
- **Código**: mergeado a main en commit `af31a01` (merge --no-ff de
  `s2-adjustments-phase1` con commit interno `231838d`).
- **Vercel prod**: deploy `dpl_48wp7r2XHp4iRcepGBVCscBDR1sS` READY en 47s
  el 2026-08-15. Alias `pos-solcraft-1.vercel.app` sirviendo el nuevo build.
  Runtime logs limpios (0 errors/warnings/fatals últimos 30 min).
- **Smoke post-deploy prod**: `GET /api/wompi/webhook` → HTTP 200
  `{"ok":true,"configured":false,"endpoint":"wompi/webhook"}` (mismo estado
  que pre-merge — Wompi no tocado, sin regresión colateral).
- Validado previamente en branch `credit-sales-phase1-validation`
  (`oxramdmsllprpxbhkhmi`) con T1..T8 OK del script 16_validation_phase1.sql,
  y en Vercel preview del branch antes del merge (crear/anular ajuste +
  lista refleja status OK).

Cambios en el mismo commit atómico:
- `lib/inventory-actions.ts`: re-agregado `.eq("status","active")` en
  `getAdjustments()` y `getCentralPurchases()` (los TODO(fase-1-ajustes) ya
  no aplican; se borraron).
- `lib/inventory-actions.ts`: **eliminada la función `deleteAdjustment`**
  (dead code post-swap). Ver finding abajo.
- `app/inventory/adjustments/page.tsx`: swap del handler del ícono papelera
  de `deleteAdjustment` → `voidAdjustment(RPC void_adjustment)`. La copia
  del AlertDialog ya decía "¿Anular ajuste?" desde el merge de Fase 3, así
  que ahora label + función + semántica quedan alineados.

**Finding lateral registrado (silent-fail preexistente)**: pre-apply,
`deleteAdjustment` estaba efectivamente roto en prod desde antes de esta
sesión. `pg_policies` de `inventory_adjustments` nunca tuvo policy de
DELETE (solo `_read` SELECT, `_write` INSERT, `_update` UPDATE) y RLS estaba
enabled — así que el `.delete()` bajo cliente SSR (rol `authenticated`)
devolvía `{ error: null }` con 0 rows affected, mientras el paso previo
`adjust_warehouse_stock` (SECDEF) sí revertía stock. Resultado: la UI
seguía mostrando el ajuste con su `total_adjusted` intacto mientras el
stock ya estaba bajado — soft-inconsistencia silenciosa. **Resuelto** por
el swap a `voidAdjustment` (RPC SECDEF que sí funciona bajo RLS y marca
`status='voided'` como fuente de verdad).

Fases 2A/2B/2C/2D siguen pendientes (ver §1.3). Fase 3 UI ya estaba
desplegada desde el merge previo.

### 📁 ARCHIVADO abajo — sesión 2026-08-14

### ✅ CERRADO — Wompi S3-P0 (agujero P0 de RPCs de pago)
`scripts/14` aplicado a prod (`nxszaxwsrtlofqimbfig`). Verificado end-to-end:
`apply_wompi_transaction`, `set_web_order_payment_reference`, `log_payment_event`
devuelven `42501 permission denied` con anon key; storefront público
(`place_web_order`) sigue intacto. Vercel prod usa `service_role` client via
`SUPABASE_SERVICE_ROLE_KEY` en el webhook + `createWompiCheckout`. Registro
completo en CONTEXT-POS §7.9.

### ✅ CERRADO — Baseline canónico de prod
`supabase/migrations/20260812000000_baseline_canonical_from_prod.sql` (3.299
líneas, 132 KB). Introspección directa de prod, ordenado por dependencias,
incluye los 6 REVOKE de Wompi post-S3-P0. Commiteado en main (`773e333`).
Validado en branch Supabase: al aplicarlo desde cero produce 33 tablas + 1
vista + 111 índices + 48 funciones + 5 triggers + 99 policies = paridad total
con prod. Monolítico viejo (`20260807042453_baseline_monolithic.sql`) BORRADO
en el merge — era stubs-driven y divergente por drift M11/M14.

### ✅ CERRADO — Crédito Fase 1 (scripts/15)
Aplicado a prod con `apply_migration`. Backfill 1:1 limpio: 9 sales activas
históricas → 9 filas en `sale_payments` (sum 1.520.000). `verify_credit_integrity()=0`,
`verify_kardex_integrity()` sin nuevas violaciones. Walk-in "Consumidor final"
marcado `is_walk_in=TRUE, allows_credit=FALSE` con constraint + índice único.
Nuevas RPCs SECDEF (`create_sale` v2 con `p_is_on_account`+`p_initial_payment`,
`get_shift_balance`, `void_sale` con regla asimétrica A/B/C, `close_shift`
consumiendo `get_shift_balance`) todas con anon revocada + authenticated
permitida. Validado en branch con 14/14 tests + dry-run backfill en prod con
0 anomalías antes del apply. Rama `s1-s3p0-rpc-hardening` mergeada a main
(commit `9c3c93c`), Vercel prod desplegado READY en 73s, `GET /api/wompi/webhook`
devuelve 200, runtime logs sin errores.

### ✅ CERRADO — Dependencia crítica #1 (filtros `.eq("status","active")`)
Ambos filtros re-agregados en el mismo commit del apply de 16 a prod
(sesión 2026-08-15). Los TODO(fase-1-ajustes) ya no existen en el código.

### ⚠ DEPENDENCIA CRÍTICA VIGENTE #2 — Fase 3 UI de ajustes ya está en main

Con el merge a main, la ruta `app/inventory/adjustments/[adjustment_id]/page.tsx`
está desplegada en prod. Degrada limpio (sin `status` → botón "Anular" oculto;
sin `motivo`/`numero` → labels omitidos). El wrapper `voidAdjustment` en
`inventory-actions.ts` mapea el error de Postgres `42883` (función
`void_adjustment` no existe) a mensaje amigable, no stacktraces. **Estado
verificado en producción tras el merge.**

### ✅ GATE CONTADOR RESUELTO 2026-08-17 — método cambia a capitalización + COGS al vender

**Estado**: contador aprobó **cambio de método** para Fase 2C. En vez de
"compra → expense inmediato" (17c v1), se adopta **capitalización a
inventario (WAC) + reconocimiento del costo como expense al momento de
la venta (COGS)** — opción (a1) del análisis original del spec, extendida
para que `sobrante` también capitalice bajo la definición acotada de
"mercancía comprada y pagada al proveedor pero no registrada a tiempo".

**Consecuencia**: `scripts/17c_adjustments_contabilidad.sql` (v1)
**queda invalidado**. Se reescribe como 17c v2 conforme a
[docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2](INVENTORY-ADJUSTMENTS-SPEC.md)
(tabla nueva) + §6.4 (COGS en create_sale) + §6.5 (traza numérica).
DN4 en §10.1 consolida el cambio.

**Punto abierto para re-confirmación futura**: la definición de
`sobrante` cubre solo el caso "comprado no registrado". Si en el futuro
aparece un sobrante genuino sin origen de compra (donación, obsequio,
hallazgo sin factura), requiere motivo nuevo separado
(`hallazgo`/`donacion`) con tratamiento contable distinto — fuera de
alcance por ahora, a re-confirmar con el contador cuando surja el caso
real. Documentado en §6.2 tabla de motivos.

**RELEASE TRIPLE ACOPLADO** para prod (misma ventana, mismo commit):

1. **SQL 17c v2** — RPC `create_adjustment` con `p_motivo` (mantiene
   firma prevista); WAC ahora para los 3 motivos (no solo compra);
   ELIMINA asientos de incrementos; conserva asiento de merma (§6.1).
2. **SQL cambio `create_sale` + `void_sale`** — persiste
   `sale_items.unit_cost` (ALTER TABLE nueva); emite asiento COGS
   agregado por venta; void_sale reversa COGS desde `unit_cost`
   persistido (no de `products.cost` vivo, para reverso exacto).
   `void_sale` también quita el `RETURN` temprano cuando
   `amount_paid=0` para que el COGS de venta a crédito sin abono
   también se reverse.
3. **TS 2D** — refactor callers `receiveMerchandise` +
   `ingressNewProduct` + wrapper `createAdjustment` para pasar
   `motivo`; UI `adjustment-dialog.tsx` muestra WAC actual como
   referencia; UI `product-form-dialog.tsx` valida `cost>0` en
   creación de productos físicos (preventivo — hoy 0 productos en
   prod tienen cost=0/NULL).

**NO se puede fasear el release**:
- Aplicar solo 17c v2 sin cambio de create_sale = incrementos ya no
  asientan pero tampoco COGS al vender → catálogo capitalizado que
  nunca se reconoce como expense → utilidad falsamente inflada
  perpetua.
- Aplicar solo cambio create_sale sin 17c v2 = mantiene el asiento
  "Compra de mercancía" viejo de `ingressNewProduct` + añade COGS al
  vender → doble reconocimiento del costo (exactamente el riesgo que
  el spec original identificaba y que motivó el cambio de método).
- Aplicar solo 2D sin lo demás = misma regresión ya documentada.

**Retroactividad**: NO aplica. Ventas actuales en prod son datos de
prueba, no se reconcilia histórico. El nuevo método rige desde el
deploy. Notar en el commit que aplique el release.

Cross-reference en [docs/CREDIT-SALES-SPEC.md §6](CREDIT-SALES-SPEC.md)
— `register_payment` (Fase 2/3 crédito, aún por escribir) **NO debe
generar COGS adicional**; el COGS se registra completo al vender,
abonos posteriores solo tocan income.

### ⚠ SMOKE TEST DE PROD PENDIENTE (para vos, en el navegador)

`GET /api/wompi/webhook` responde OK; runtime logs limpios; deploy READY. Pero
**no se hizo smoke visual del POS real** contra `https://pos-solcraft-1.vercel.app`
tras el merge (venta contado end-to-end, abrir+cerrar turno, crear cliente
con celular). Prioridad ALTA para la próxima ventana operativa antes de
declarar la sesión 100% cerrada.

---

## 1. Cola de trabajo escrito-pero-no-aplicado

Ajustes Fase 1/2/3 escritos, validados localmente (WSL/PG18 + branch Supabase
Pro para Fase 1 crédito). **Solo crédito Fase 1 aplicado a prod hasta hoy** —
los ajustes siguen pendientes de apply.

### 1.1 ✅ Crédito (fiado) — Fase 1 — APLICADO A PROD 2026-08-14

- Registrado como migración `15_credit_sales_phase1` en
  `supabase_migrations.schema_migrations` de prod (`nxszaxwsrtlofqimbfig`).
- Spec: [docs/CREDIT-SALES-SPEC.md](CREDIT-SALES-SPEC.md) — Fase 1 tal cual
  fue especificada; Fase 2/3 sigue como diseño futuro.
- **Fase 2/3 pendientes**: `register_payment`, UI abonos, CxC, UX creación
  inline de cliente al fiar, `apply_customer_credit`. Requieren código nuevo
  (server actions + UI); no requieren migración BD adicional (el schema
  Fase 1 ya cubre columnas necesarias).

### 1.2 ✅ Ajustes de inventario — Fase 1 — APLICADO A PROD 2026-08-15

- Registrado como migración `16_inventory_adjustments_phase1` en
  `supabase_migrations.schema_migrations` de prod (`nxszaxwsrtlofqimbfig`).
- Baseline kardex prod pre-apply: 0 violaciones; post-apply: 0 violaciones.
- **Spec**: [docs/INVENTORY-ADJUSTMENTS-SPEC.md](INVENTORY-ADJUSTMENTS-SPEC.md).
- **Bug menor descubierto en `scripts/16_validation_phase1.sql`**: el
  INSERT en `sites` (líneas 88-89) pasa `(name, is_central)` sin `code`,
  pero el canonical baseline tiene `sites.code NOT NULL`. Falla contra
  cualquier ambiente basado en el baseline canónico. Parche trivial:
  agregar `code='VAL16A'/'VAL16B'` en los INSERT.

### 1.2.1 Fase 2A/2B APLICADAS A PROD 2026-08-17; 2C rediseñado (release triple con 2D + cambio create_sale, listo para SQL)

### 1.3 Ajustes — Fase 2 (sub-faseada por riesgo)

- **2A · Numeración** (🟢 bajo) — ✅ **APLICADO A PROD 2026-08-17**.
  Ver bloque "CERRADO Y DEPLOYED — Ajustes Fase 2A + 2B" arriba en §0.
- **2B · WAC** (🟡 medio) — ✅ **APLICADO A PROD 2026-08-17**.
  Ver bloque "CERRADO Y DEPLOYED — Ajustes Fase 2A + 2B" arriba en §0.
- **2C · Contabilidad por motivos — REDISEÑADA 2026-08-17** (🔴 alto,
  gate contador RESUELTO) — 17c v1 INVALIDADO, reemplazado por 17c v2
  (por escribir) que **NO asienta al comprar** (los 3 motivos
  capitalizan a WAC, ya cableado por 2B); mantiene `p_motivo` en la
  firma, ALTER `accounting_entries += adjustment_id` FK, asiento de
  merma para disminuciones (§6.1 sin cambio), `verify_adjustment_
  accounting_integrity()`. Reconocimiento del costo migra a COGS al
  vender en `create_sale` (nueva pieza — ver bullet siguiente).
  Detalles en [docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2](../docs/INVENTORY-ADJUSTMENTS-SPEC.md).
- **NUEVO · Cambio create_sale + void_sale (COGS)** (🔴 alto,
  parte del release triple con 2C v2 y 2D) — ALTER
  `sale_items += unit_cost NUMERIC(12,2)`; `create_sale` persiste
  `unit_cost` desde `products.cost` al momento de la venta y emite 1
  asiento agregado `expense "Costo de mercancía vendida"` por venta;
  `void_sale` reversa COGS desde `sale_items.unit_cost` (no de
  `products.cost` vivo) y quita el `RETURN` temprano cuando
  `amount_paid=0` para que la reversa del COGS también aplique en
  ventas a crédito sin abono. Detalle en
  [docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.4](../docs/INVENTORY-ADJUSTMENTS-SPEC.md).
- **2D · Unificar entradas** (🟡 medio, solo TS) — 🚫 **BLOQUEADA por el
  mismo gate del contador que 2C. NO adelantar 2D sin 2C, bajo ninguna
  circunstancia** (regresión contable real: sin la lógica de asiento del
  RPC de 2C, refactorizar `ingressNewProduct` al camino común elimina el
  `expense` "Compra de mercancía" que hoy asienta directo — el resultado
  es una regresión, no una mejora). **2C + 2D = un solo release,
  aplicado en la misma ventana coordinada** una vez el contador
  autorice: SQL 2C primero (agrega firma `p_motivo`, asientos, FK
  `adjustment_id`, validaciones), TS 2D en el mismo commit
  (`receiveMerchandise` inyecta `motivo="compra"`, `ingressNewProduct`
  delega en `createAdjustment`, wrapper `createAdjustment` acepta y
  reenvía `motivo`). Detalle técnico + análisis DN2 (pérdida de
  granularidad `movement_type='compra'` en kardex, recuperable con join
  a `inventory_adjustments.motivo`) en
  [scripts/17d_adjustments_unify_entries.md](../scripts/17d_adjustments_unify_entries.md).
  Post-2D toda entrada de mercancía queda como `movement_type='ajuste'`
  en kardex; distinción vive en `inventory_adjustments.motivo`.
- **Validación 2A+2B+2C**:
  [scripts/17_validation_phase2.sql](../scripts/17_validation_phase2.sql).
  8 tests — numeración secuencial, WAC correcto tras N incrementos, WAC
  intacto tras disminución, asiento por cada motivo, void compensa pero
  no revierte WAC, `verify_adjustment_accounting_integrity`=0.

### 1.4 Ajustes — Fase 3 (UI de detalle + anular) — DEPLOYABLE INDEPENDIENTE

- **Página nueva**: [app/inventory/adjustments/[adjustment_id]/page.tsx](../app/inventory/adjustments/%5Badjustment_id%5D/page.tsx).
  Detalle con breadcrumb, header, tabla de líneas, botón Anular con
  visibilidad estricta (`admin` o `encargado` con `assignedSiteId ===
  adjustment.site_id`; autorización real en el RPC, canVoid es solo
  visibilidad — comentado explícito en el código), banner de anulación
  con warning WAC D5 solo si hubo incrementos con costo. **Total desde
  `adjustment.total_adjusted`** (fuente única, mismo criterio que la
  lista: suma sin signo, no neto).
- **Enlace desde lista**: [app/inventory/adjustments/page.tsx](../app/inventory/adjustments/page.tsx)
  — celda fecha envuelta en `Link` a detalle; copy "Anular" en el
  AlertDialog.
- **Server Actions**: `voidAdjustment` (nuevo, wrapper del RPC con mapeo
  del `42883`) + `getAdjustmentById` extendido (embed `sites(name)` +
  segundo select a `user_profiles` para `creator` con casos borde
  `created_by NULL` y usuario ausente).
- **Copy kardex**: [app/inventory/kardex/page.tsx:25](../app/inventory/kardex/page.tsx)
  — `TYPE_LABELS.compra = "Compra (histórico)"` (prepara post-Fase 2D).
- **Degrada limpiamente contra prod actual** (verificado end-to-end en
  navegador contra prod, sesión 2026-08-10): sin `status` → botón oculto;
  sin `motivo` → badge omitido; sin `created_by` → línea omitida; sin
  `numero` → "Ajuste (sin número)".

---

## 2. Trabajo YA DESPLEGADO (marcado hecho)

### 2.1 Fix POS "stock replicado" (bugfix, prod)

- **Diagnóstico**: sesiones 2026-08-08 auditaron `product_stock` de PA-32-120-00
  y confirmaron que los datos son correctos (cada sede su stock, movements
  cuadran). El bug era de lectura, no de datos.
- **Causa**: [lib/inventory-actions.ts:getProductsWithStock](../lib/inventory-actions.ts)
  antes hacía `warehouseStock = totalStock` cuando `warehouse_id` era
  `null`. Combinado con el bootstrap del POS que pasaba `whId=null`
  mientras `useSite()` no resolvía, mostraba la SUMA de todas las bodegas
  como si fuera stock de la sede activa.
- **Fix aplicado en el commit `5fb37fd`**:
  - `getProductsWithStock`: sin `warehouse_id` devuelve `warehouseStock=null`
    (en vez de sumar). `totalStock` se sigue devolviendo por separado.
  - `app/pos/page.tsx`: `useEffect` con guard `if (!siteId) return` +
    flag `cancelled` en closure + cleanup, evita race entre re-runs;
    estado `warehouseError` bloquea el POS con mensaje si
    `getWarehouseForSite` retorna null.
  - `app/inventory/products/page.tsx`: usa `warehouseStock ?? totalStock`
    para preservar la vista "todas las bodegas".
- **Verificado end-to-end en el navegador** contra prod sede "El Carmen
  Hombres" (PA-32-120-00 muestra "Inv. 8" — cantidad real, no la suma
  33).

### 2.2 Feature celular obligatorio al crear cliente

- **Aplicado en `5fb37fd`**. Validador Zod compartido en
  [lib/validators/customer.ts](../lib/validators/customer.ts)
  (`normalizePhoneCO`, `phoneCORequired`). Client + server validan; walk-in
  ("Consumidor final") exento; se persiste el valor normalizado (10 dígitos).

### 2.3 Fix i18n del `<html>`

- [app/layout.tsx](../app/layout.tsx) — `lang="es" translate="no"` +
  `<meta name="google" content="notranslate">` para evitar el bug de
  reconciliación de React con Google Translate.

---

## 3. Orden de apply — actualizado post 2026-08-17

**Ya aplicado a prod**: script 14 (REVOKE Wompi, sesión 2026-08-14), script
15 (crédito Fase 1, sesión 2026-08-14), script 16 (ajustes Fase 1, sesión
2026-08-15), script 17a (ajustes 2A numeración, sesión 2026-08-17), script
17b (ajustes 2B WAC, sesión 2026-08-17).

**Pendiente por aplicar a prod**:
1. **Release TRIPLE ACOPLADO 2C v2 + create_sale/void_sale + 2D**
   (nombres provisionales: `17c_v2_adjustments_no_expense.sql` +
   `17e_cogs_in_sales.sql` + refactor TS). Diseño completo en
   [docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2 + §6.4](../docs/INVENTORY-ADJUSTMENTS-SPEC.md).
   Método aprobado por el contador 2026-08-17: capitalizar al comprar
   (WAC), reconocer COGS al vender. **NO se puede fasear**: cualquier
   subset introduce regresión contable (aplicar solo 17c v2 = catálogo
   capitalizado sin reconocimiento perpetuo → utilidad inflada; aplicar
   solo cambio create_sale = doble reconocimiento con el asiento viejo
   de `ingressNewProduct` que aún existe; aplicar solo 2D = pérdida del
   asiento actual sin sustituto). Retroactividad NO aplica — solo
   ventas nuevas post-deploy. Todavía debe escribirse el SQL de las 2
   migraciones (`17c v2` y el nuevo `17e`) + validación end-to-end en
   branch desechable antes del apply a prod.

**Patrón de validación probado esta sesión** (para replicar con ajustes):
1. `create_branch` con `with_data=false` en Supabase Pro (~$0.01344/hora).
2. Si branch queda MIGRATIONS_FAILED (cadena oficial rompe en migración #6
   por drift Studio), hacer `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
   + limpiar `supabase_migrations.schema_migrations`, luego aplicar el baseline
   canónico en 4 chunks vía `apply_migration` (con `SET check_function_bodies
   = off` en el chunk de funciones).
3. Seed mínimo (`scripts/04_seed.sql` — sedes + warehouses).
4. Aplicar la migración a validar (`scripts/16`) vía `apply_migration`.
5. Correr script de validación (`scripts/16_validation_phase1.sql`) — esperar
   T1..T8 OK.
6. Dry-run del backfill/lógica contra prod (SELECT-only) para verificar 0
   anomalías reales.
7. Apply a prod vía `apply_migration`.
8. Post-verificación en prod: invariantes (`verify_*`) = 0, sanity check de
   schema/RPCs/ACLs.

**Supabase Pro ya activo** (confirmado esta sesión). Branching disponible.

---

## 4. Gates humanos (no dependen de Pro)

| Gate | Qué revisar | Bloquea |
|---|---|---|
| ✅ ~~Contador — `compra → expense` inmediato~~ | **RESUELTO 2026-08-17** — se adopta capitalización + COGS al vender en su lugar (opción a1 extendida). Ver DN4 en [INVENTORY-ADJUSTMENTS-SPEC.md §10.1](INVENTORY-ADJUSTMENTS-SPEC.md) y §0 bloque "GATE CONTADOR RESUELTO" arriba. | — (ya no bloquea; nuevo release triple queda como trabajo de SQL) |
| ✅ ~~Contador — DN2 `movement_type='ajuste'` uniforme~~ | **RESUELTO** con el mismo cambio de método — DN2 se mantiene válida bajo el nuevo diseño. | — |
| **Contador — sobrante sin costo de adquisición real** | Definición actual de `sobrante` = "mercancía comprada y pagada al proveedor pero no registrada a tiempo". Si aparece caso genuino sin origen de compra (donación, hallazgo sin factura), requiere motivo nuevo (`hallazgo`/`donacion`) con tratamiento distinto — no está diseñado. Re-confirmar con contador cuando surja. | Motivos nuevos post-2C v2 |

---

## 5. Backlog vigente

- **✅ CERRADO** Task #14 (captura del drift canónico) — hecho vía introspección
  MCP en esta sesión. Baseline: `supabase/migrations/20260812000000_baseline_canonical_from_prod.sql`.
- **✅ CERRADO** validación en branch Supabase real — hecho para crédito Fase 1
  esta sesión (patrón replicable documentado en §3).
- **Backups**: Pro incluye daily backups automáticos (7 días retención). PITR
  es add-on separado; hoy no está activado. Recomendado activarlo antes de
  volumen de ventas real.
- **#13 Docs CONTEXT-POS §3.1** — registrar 4 drifts menores capturados esta
  sesión: `stock_movements.movement_type` acepta `reserva_online` +
  `liberacion_online`; `transfers.status` acepta `cancelado`;
  `web_orders.payment_method` acepta `transfer` + `gateway`; columnas de
  `sales` (subtotal/discount_total/tax_total/numero/status) que estaban solo
  parcialmente documentadas.
- **#14 Rotar `SUPABASE_SERVICE_ROLE_KEY`** en Supabase Dashboard + Vercel
  Production+Preview. Además auditar otras SECDEF con anon (candidatos:
  `adjust_warehouse_stock`, `create_web_order`, `transfer_stock`,
  `get_low_stock_products`, `get_sales_summary`, `next_product_code`,
  `decrement_product_stock`, `receive_transfer_item`, `send_transfer_via_transit`;
  `place_web_order`/`public_place_order` deben quedar con anon por diseño
  del storefront público).
- **#20 Borrar `PLAN-PENDIENTES.md` viejo de la raíz** — reconciliado en main
  (llegó via cherry-pick del hotfix Wompi). Es una versión anterior; toda
  su info vigente ya está en `docs/ESTADO-PENDIENTES.md`.
- **#21 Pin deps `"latest"` en `package.json`** — reemplazar los `"latest"`
  por versiones fijas para que `pnpm install` sea reproducible y no
  re-bumpee `@supabase/supabase-js`, `react-hook-form`, `sonner`, etc.
- **Smoke test visual de prod** post-merge (venta contado, turno, cliente
  con celular obligatorio) — pendiente (§0).
- **Branch Supabase `credit-sales-phase1-validation` (`oxramdmsllprpxbhkhmi`)**
  sigue **VIVO** al cierre de esta sesión (MIGRATIONS_FAILED interno pero
  preview_project_status ACTIVE_HEALTHY, costando $0.01344/hora). Puede
  borrarse con `delete_branch` — ya no aporta valor para crédito, se puede
  crear uno nuevo cuando se valide ajustes Fase 1.

---

## 6. Precondiciones ya verificadas — NO re-correr

Ejecutados READ-ONLY contra prod en sesiones previas:

- `SELECT COUNT(*) FROM warehouses WHERE site_id IS NULL` → **0**
  (precondición del backfill de `site_id` en migración 16).
- `SELECT COUNT(*) FROM sales WHERE status='active' AND total_amount>0 AND
  payment_method IS NULL` → **0** (precondición del backfill de
  `sale_payments` en migración 15).
- `SELECT column_name FROM information_schema.columns WHERE table_name =
  'inventory_adjustments'` → 5 columnas originales (`adjustment_id`,
  `warehouse_id`, `notes`, `total_adjusted`, `adjustment_date`) —
  ninguna de Fase 1.
- Todas las 6 sedes de prod tienen exactamente 1 warehouse
  `is_primary=true` (`bodegas_primary=1`). Ver task #15 (backlog:
  enforce este invariante).

---

## 7. Task list persistente (volcada aquí por si se pierde en el clear)

Ninguna tarea abierta bloquea el clear. Estas son las que estaban en el
tracker de la sesión al momento de este dump:

| # | Estado | Título |
|---|:---:|---|
| 1 | ✅ | Confirmar proyecto prod via list_projects |
| 2 | ✅ | Conteo NULL payment_method en prod (READ-ONLY) |
| 3 | ✅ | Editar SQL: comentario p_user_id + política backfill según conteo |
| 5 | ✅ | Crear branch credit-sales-phase1-validation *(nunca se creó — Pro required)* |
| 6 | ✅ | Apply migración al branch *(no aplicado; validación quedó en local)* |
| 7 | ✅ | Correr verify_credit_integrity + verify_kardex_integrity *(local, ambas 0/delta 0)* |
| 8 | ✅ | Correr E2E de paridad + Casos A/B *(local)* |
| 9 | ✅ | Reportar (a)-(e) y pegar cuerpos RPC aplicados *(cuerpos en scratchpad de sesión)* |
| 10 | ✅ | Bloqueo: elegir vía para capturar baseline (CLI vs MCP) *(Vía B — introspección MCP)* |
| 12 | ✅ | Concatenar scripts/00-14 en baseline monolítico |
| **14** | ⏳ | **Agendar (no bloqueante): captura canónica del baseline vía db pull** |
| **15** | ⏳ | **Enforce "exactamente 1 warehouse.is_primary por sede" (app + BD)** — ver §6 |

---

## 8. Rutas rápidas para la próxima sesión

- **Specs principales**:
  - [docs/CREDIT-SALES-SPEC.md](CREDIT-SALES-SPEC.md) — Fase 1 aplicada; Fase 2/3 sigue como diseño.
  - [docs/INVENTORY-ADJUSTMENTS-SPEC.md](INVENTORY-ADJUSTMENTS-SPEC.md) — Fases 1/2/3 escritas, NO aplicadas.
- **Contexto denso del proyecto**: [CONTEXT-POS.md](../CONTEXT-POS.md) (§7
  agrega los cambios post-2026-08-04; §7.9 cierra la sesión 2026-08-14).
- **Baseline canónico versionado**:
  [supabase/migrations/20260812000000_baseline_canonical_from_prod.sql](../supabase/migrations/20260812000000_baseline_canonical_from_prod.sql)
  (fuente de verdad para bootstrap de branches Supabase). El monolítico viejo
  fue borrado en el merge de esta sesión.
- **Rama activa**: `main` en commit `9c3c93c` (merge s1-s3p0-rpc-hardening).
  La rama `s1-s3p0-rpc-hardening` sigue en origin pero ya está
  completamente mergeada — puede borrarse.
- **Proyecto Supabase prod**: `nxszaxwsrtlofqimbfig` (us-west-2, PG 17.6.1,
  plan Pro con branching disponible). Lectura y escritura desde MCP.
- **Branch Supabase de validación** (vivo, considerar borrar):
  `credit-sales-phase1-validation` (`oxramdmsllprpxbhkhmi`).
