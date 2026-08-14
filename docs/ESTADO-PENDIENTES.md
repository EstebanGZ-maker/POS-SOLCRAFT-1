# ESTADO-PENDIENTES.md

> **Propósito**: dump de estado para que una instancia nueva de Claude sin
> memoria pueda retomar sin perder nada. Última actualización: 2026-08-11
> (sesión en curso, antes de `/clear`). Todo el trabajo referenciado abajo ya
> está commiteado en la rama `s1-s3p0-rpc-hardening` (commit `5fb37fd`),
> pusheado a origin.

---

## 0. LEE ESTO PRIMERO — 3 puntos que NO se pueden perder

### ⚠ DEPENDENCIA CRÍTICA #1 — filtros revertidos por incompatibilidad de esquema

En [lib/inventory-actions.ts](../lib/inventory-actions.ts) hay **dos** filtros
`.eq("status", "active")` que están **revertidos con un `TODO`** porque la
columna `status` no existe en prod hasta que se aplique la migración
[scripts/16_inventory_adjustments_phase1.sql](../scripts/16_inventory_adjustments_phase1.sql).

**Al aplicar la migración 16 a prod, en el MISMO commit se DEBEN re-agregar:**

- `getAdjustments()` — busca `TODO(fase-1-ajustes)` inmediatamente antes de
  `.order("adjustment_date", ...)`. Agregar la línea `.eq("status", "active")`.
- `getCentralPurchases()` — busca el segundo `TODO(fase-1-ajustes)`. Mismo
  ajuste.

**Sin este paso**, después del apply de 16, los ajustes anulados aparecerán
como activos en la lista `/inventory/adjustments` y en el reporte
`getCentralPurchases()`. **Comprobar los TODOs con `grep -n "TODO(fase-1-ajustes)"
lib/inventory-actions.ts`**.

### ⚠ DEPENDENCIA CRÍTICA #2 — Fase 3 UI de ajustes ya está deployable, pero el botón "Anular" necesita Fase 1

La página nueva `app/inventory/adjustments/[adjustment_id]/page.tsx` degrada
limpiamente en el esquema actual de prod (sin `status`, `numero`, `motivo`,
etc.). El botón "Anular" solo aparece cuando `status='active'`; como el campo
no existe hoy, no se muestra. Cuando exista → se muestra. El wrapper
`voidAdjustment` en `inventory-actions.ts` mapea el error de Postgres `42883`
(función `void_adjustment` no existe) a un mensaje amigable — no muestra
stacktraces.

### ⚠ GATE CONTADOR VIVO — Fase 2C de ajustes no se aplica a prod sin visto bueno

`scripts/17c_adjustments_contabilidad.sql` introduce el tratamiento contable
por motivo. El asiento `motivo='compra' → expense inmediato "Compra de
mercancía"` es una simplificación que impacta P&L al comprar cuando partida
doble estricta NO lo haría. **El contador debe validar** antes del apply a
prod. Detalles en [docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2 "Gate contable"](INVENTORY-ADJUSTMENTS-SPEC.md).
Si el contador rechaza → hay 3 alternativas listadas en el spec (a1/a2/a3);
elegir una y reescribir 17c.

---

## 1. Cola de trabajo escrito-pero-no-aplicado

Todo está commiteado en la rama y validado con lo que se pudo (local WSL/PG18
para ajustes Fase 1; ejecución en Postgres puro para lógica). **Nada aplicado
a prod** — el apply real de todo lo que toca kardex/contabilidad se hace
contra un **branch Supabase Pro** (bloqueado hoy porque el plan es Free).

### 1.1 Crédito (fiado) — Fase 1

- **Spec**: [docs/CREDIT-SALES-SPEC.md](CREDIT-SALES-SPEC.md) (§1–§10, ~730
  líneas). Decisiones D1–D14 cerradas.
- **Migración**: [scripts/15_credit_sales_phase1.sql](../scripts/15_credit_sales_phase1.sql).
  Contenido: `sales += is_on_account, amount_paid, balance_due (STORED)`;
  nueva `sale_payments`; `customers += allows_credit, is_walk_in`; nueva
  `customer_credits` (solo emisión); backfill obligatorio de
  `sale_payments` para ventas históricas; `verify_credit_integrity()`;
  RPCs `create_sale` (SECDEF + rol/sede), `close_shift` (consume
  `get_shift_balance`), **nuevo `get_shift_balance`** (única fuente del
  arqueo, elimina M12), `void_sale` con regla asimétrica Casos A/B/C.
- **Validación**: [scripts/15_validation_phase1.sql](../scripts/15_validation_phase1.sql).
  Bootstrap auth stub + escenario end-to-end con paridad
  `close_shift ↔ get_shift_balance`, Caso A cross-turno, Caso B fiado,
  verify_credit_integrity=0. Pasa en WSL/PG18 local.
- **Fase 2/3**: definidas en el spec (`register_payment`, UI abonos, CxC,
  UX creación inline de cliente al fiar, `apply_customer_credit`).
  Pendientes de arrancar.

### 1.2 Ajustes de inventario — Fase 1

- **Spec**: [docs/INVENTORY-ADJUSTMENTS-SPEC.md](INVENTORY-ADJUSTMENTS-SPEC.md)
  (§1–§11, ~800 líneas). Decisiones D1–D8 + DN1/DN2/DN3 cerradas.
- **Migración**: [scripts/16_inventory_adjustments_phase1.sql](../scripts/16_inventory_adjustments_phase1.sql).
  Contenido: ALTER completo `inventory_adjustments += site_id, numero,
  status, motivo, created_by, updated_at` (columnas nuevas listas para
  Fase 2 sin migración adicional); backfill `site_id`; índice único parcial
  `(site_id, numero)` inerte hasta 2A; RLS de escritura CERRADA; RPCs
  atómicos SECDEF `create_adjustment(warehouse_id, notes, items)` y
  `void_adjustment(adjustment_id)`.
- **Validación**: [scripts/16_validation_phase1.sql](../scripts/16_validation_phase1.sql).
  8 tests (T1..T8) — atomicidad, rollback total ante fallo parcial,
  void revierte stock, rol/sede rechazan, kardex delta=0. Pasa en local.

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

## 3. Orden de apply obligatorio

Cuando se habilite Supabase Pro (o se decida otra vía para validar contra
esquema real):

1. **Crear branch Supabase** (nombre sugerido: `all-phases-validation`).
2. **Aplicar en orden estricto** contra el branch:
   - `scripts/15_credit_sales_phase1.sql` — crédito Fase 1.
   - `scripts/16_inventory_adjustments_phase1.sql` — ajustes Fase 1.
   - `scripts/17a_adjustments_numeracion.sql` — ajustes 2A.
   - `scripts/17b_adjustments_wac.sql` — ajustes 2B.
   - `scripts/17c_adjustments_contabilidad.sql` — ajustes 2C (GATE
     CONTADOR).
   - 2D es solo código TS — no hay SQL, se hace en un mismo PR junto con
     2C.
3. **Correr validaciones en orden**:
   - `scripts/15_validation_phase1.sql` (crédito) → esperar
     `FASE 1 VALIDACIÓN: OK`.
   - `scripts/16_validation_phase1.sql` (ajustes 1) → esperar T1..T8 OK.
   - `scripts/17_validation_phase2.sql` (ajustes 2A+2B+2C) → esperar
     T1..T8 OK.
   - `verify_kardex_integrity()`, `verify_credit_integrity()`,
     `verify_adjustment_accounting_integrity()` → 0 filas cada una.
4. **Recién con branch verde + OK contador** → aplicar a prod
   secuencialmente, cada uno con su gate humano:
   - Crédito Fase 1 (sin contador porque es cash-in, matemática).
   - Ajustes Fase 1 (bajo riesgo, solo atomicidad — reemplazar código
     Server Actions al mismo tiempo, sin funcionalidad nueva visible al
     usuario).
   - Ajustes 2A (solo numeración).
   - Ajustes 2B (WAC, requiere revisar que ningún reporte externo
     dependa de `products.cost` inmediato).
   - Ajustes 2C + 2D (deploy conjunto obligatorio; SQL cambia firma
     `create_adjustment` con `p_motivo`, TS wrappers deben pasarlo).
     **Requiere OK explícito del contador**.
5. **Re-agregar los filtros `.eq("status","active")`** en el commit que
   aplique la migración 16 (ver §0 arriba, DEPENDENCIA CRÍTICA #1).

**Toda la cadena depende de Pro** hoy porque el proyecto Supabase
`nxszaxwsrtlofqimbfig` está en Free plan (`create_branch` responde
`PaymentRequiredException`).

---

## 4. Gates humanos (no dependen de Pro)

| Gate | Qué revisar | Bloquea |
|---|---|---|
| **Contador — `compra → expense` inmediato** | Ver [INVENTORY-ADJUSTMENTS-SPEC.md §6.2](INVENTORY-ADJUSTMENTS-SPEC.md) subsección "Gate contable". El asiento propuesto simplifica partida doble; si rechaza, hay 3 alternativas (a1/a2/a3). Documentar la respuesta en el commit que aplique 17c. | Fase 2C apply a prod |
| **Contador — DN2 `movement_type='ajuste'` uniforme** | Confirmar que aceptamos perder la distinción compra/ajuste en `stock_movements` (queda en `inventory_adjustments.motivo`). Análisis en [scripts/17d_adjustments_unify_entries.md](../scripts/17d_adjustments_unify_entries.md). | Fase 2D apply |

---

## 5. Pendientes atados a Pro (backlog)

- **Validar en branch real** las Fases 1 de crédito, 1 de ajustes, y 2A/2B/2C
  de ajustes. Local WSL+PG18 valida lógica, no esquema Supabase real (RLS,
  extensiones auth, roles Supabase). Requiere Pro para `create_branch`.
- **Task #14 — capturar el drift canónico**: `supabase db pull` (o
  introspección MCP exhaustiva) para versionar los objetos que hoy viven
  solo en prod vía Studio (M11/M14: `web_orders`, `payment_events`,
  `online_orders`, `product_images`, `user_sites`, `customer_accounts`,
  `business_settings`, RPCs Wompi, `admin_create_user`,
  `admin_reset_password`, `fulfill_web_order`, `update_online_order_status`,
  `public_catalog_*`). Ver también el
  [supabase/migrations/20260807042453_baseline_monolithic.sql](../supabase/migrations/20260807042453_baseline_monolithic.sql)
  y los stubs de drift documentados en la migración monolítica.
- **Backups + no-pausado** en Supabase antes de la primera venta real (Pro
  ofrece PITR). Hoy sin backup automático.

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
  - [docs/CREDIT-SALES-SPEC.md](CREDIT-SALES-SPEC.md)
  - [docs/INVENTORY-ADJUSTMENTS-SPEC.md](INVENTORY-ADJUSTMENTS-SPEC.md)
- **Contexto denso del proyecto**: [CONTEXT-POS.md](../CONTEXT-POS.md) (§7
  agrega los cambios post-2026-08-04 relevantes de estas sesiones).
- **Rama activa**: `s1-s3p0-rpc-hardening` (commit head `5fb37fd`).
- **Proyecto Supabase prod**: `nxszaxwsrtlofqimbfig` (us-west-2, PG
  17.6.1). Solo lectura desde MCP.
- **DB local para validación**: WSL Ubuntu 26.04 + PostgreSQL 18.4 + stubs
  (`scratchpad/00_stubs.sql`) + baseline monolítico + migraciones 15/16/17.
