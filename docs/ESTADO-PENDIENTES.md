# ESTADO-PENDIENTES.md

> **Propósito**: dump de estado para que una instancia nueva de Claude sin
> memoria pueda retomar sin perder nada. Última actualización: **2026-08-16**
> (MoneyInput con formateo en vivo desplegado a prod — 18 sitios migrados
> a separador de miles COP).

---

## 0. LEE ESTO PRIMERO — estado tras sesión 2026-08-16 (MoneyInput)

**Estado de ramas**: ninguna rama de trabajo abierta. `main` en `e711ccb`
con MoneyInput mergeado (merge s7). Ramas `s2-adjustments-phase1`,
`s3-credit-fiar-ui`, `s4-inventory-products-scope`, `s5-credit-phase3-ui`,
`s6-money-input-format`, `s7-money-input-live-format` borradas de origin
tras cada merge respectivo.

**Prod (`nxszaxwsrtlofqimbfig`)**: kardex OK (verify_kardex_integrity=0),
credit OK (verify_credit_integrity=0). Sirviendo `dpl_2uvmVse1yQm6cQ66vMaHii6s5k1D`
(sha `e711ccb`, target=production) tras el merge de MoneyInput.
`GET /api/wompi/webhook` responde `{ok:true, configured:false, endpoint:"wompi/webhook"}`
HTTP 200. Runtime logs 15 min post-deploy: 0 errors/warnings/fatal.

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

### ⚠ GATE CONTADOR VIVO — Fase 2C de ajustes no se aplica a prod sin visto bueno

`scripts/17c_adjustments_contabilidad.sql` introduce el tratamiento contable
por motivo. El asiento `motivo='compra' → expense inmediato "Compra de
mercancía"` es una simplificación que impacta P&L al comprar cuando partida
doble estricta NO lo haría. **El contador debe validar** antes del apply a
prod. Detalles en [docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2 "Gate contable"](INVENTORY-ADJUSTMENTS-SPEC.md).
Si el contador rechaza → hay 3 alternativas listadas en el spec (a1/a2/a3);
elegir una y reescribir 17c.

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

### 1.2.1 Fase 2A/2B/2C/2D — pendientes (sin cambio)

### 1.3 Ajustes — Fase 2 (sub-faseada por riesgo)

Cada sub-fase se aplica independiente (excepto 2C+2D que van juntas).

- **2A · Numeración** (🟢 bajo) —
  [scripts/17a_adjustments_numeracion.sql](../scripts/17a_adjustments_numeracion.sql).
  Crea `adjustment_counters` (patrón `site_counters`); `create_adjustment`
  numera atómicamente por sede. Sin cambio de firma.
- **2B · WAC** (🟡 medio) —
  [scripts/17b_adjustments_wac.sql](../scripts/17b_adjustments_wac.sql).
  `create_adjustment` recalcula `products.cost` en items `incrementar` con
  cost>0. Orden crítico documentado en spec §5.1.1 (LOCK products →
  READ stock BEFORE → adjust → recalc). Loop iterativo para que items 2+
  del mismo producto vean el cost recién recalculado.
- **2C · Contabilidad con motivos** (🔴 alto — **GATE CONTADOR**) —
  [scripts/17c_adjustments_contabilidad.sql](../scripts/17c_adjustments_contabilidad.sql).
  ALTER `accounting_entries += adjustment_id` FK; `create_adjustment` con
  firma nueva `+ p_motivo TEXT DEFAULT NULL`; asientos por motivo (compra
  → expense, sobrante → income, correccion → sin asiento); disminuciones
  → expense "Merma"; `void_adjustment` v2c compensa asientos originales
  (income↔expense inverso) — **NO revierte WAC (D5)**. Nueva función
  `verify_adjustment_accounting_integrity()`. Validaciones: motivo
  obligatorio si hay incrementos, NULL si es 100% disminuciones,
  correccion exige notes.
- **2D · Unificar entradas** (🟡 medio, solo TS) —
  [scripts/17d_adjustments_unify_entries.md](../scripts/17d_adjustments_unify_entries.md).
  No hay SQL. Migra `ingressNewProduct` y `receiveMerchandise` a
  `create_adjustment` con `motivo='compra'`. Post-2D toda entrada de
  mercancía queda como `movement_type='ajuste'` en kardex; distinción vive
  en `inventory_adjustments.motivo` (análisis completo de DN2 en ese
  archivo).
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

## 3. Orden de apply — actualizado post 2026-08-14

**Ya aplicado a prod**: script 14 (REVOKE Wompi, sesión 2026-08-14), script
15 (crédito Fase 1, sesión 2026-08-14), script 16 (ajustes Fase 1, sesión
2026-08-15).

**Pendiente por aplicar a prod (en orden)**:
1. **Ajustes 2A** (`scripts/17a`) — solo numeración.
2. **Ajustes 2B** (`scripts/17b`) — WAC. Revisar antes que ningún reporte
   externo dependa de `products.cost` inmediato.
3. **Ajustes 2C + 2D** (`scripts/17c` + refactor TS de `ingressNewProduct`/
   `receiveMerchandise` a `create_adjustment` con `motivo='compra'`). Deploy
   conjunto obligatorio (SQL cambia firma `create_adjustment` con `p_motivo`,
   TS wrappers deben pasarlo). **Requiere OK explícito del contador.**

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
| **Contador — `compra → expense` inmediato** | Ver [INVENTORY-ADJUSTMENTS-SPEC.md §6.2](INVENTORY-ADJUSTMENTS-SPEC.md) subsección "Gate contable". El asiento propuesto simplifica partida doble; si rechaza, hay 3 alternativas (a1/a2/a3). Documentar la respuesta en el commit que aplique 17c. | Fase 2C apply a prod |
| **Contador — DN2 `movement_type='ajuste'` uniforme** | Confirmar que aceptamos perder la distinción compra/ajuste en `stock_movements` (queda en `inventory_adjustments.motivo`). Análisis en [scripts/17d_adjustments_unify_entries.md](../scripts/17d_adjustments_unify_entries.md). | Fase 2D apply |

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
