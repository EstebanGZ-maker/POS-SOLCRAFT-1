# Ajustes de Inventario — Spec de reescritura

> Estado: **borrador para revisión**. Decisiones abiertas al final (§10).
> No implementar hasta aprobación.
>
> Alcance: reescribir el módulo de ajustes de inventario (`createAdjustment`,
> `deleteAdjustment`, `receiveMerchandise`) como un RPC atómico, con
> numeración, costo promedio ponderado, y asiento contable coherente. No se
> rediseña el modelo de stock por sede — la fuente de verdad sigue siendo
> `stock_movements`, `product_stock` es su caché, `adjust_warehouse_stock` es
> el único vector de escritura.

---

## 1. Decisiones cerradas (no re-abrir)

1. `createAdjustment` + `deleteAdjustment` pasan a un RPC atómico **SECURITY
   DEFINER + `auth.uid()` + role check**, mismo patrón que `create_sale` /
   `void_sale` (Fase 1 credit-sales). Header + items + kardex + asiento en
   una sola transacción — o todo o nada. Elimina el `Promise.all`
   no-transaccional actual.
2. `receiveMerchandise` (Server Action wrapper) sigue apoyándose en el
   mismo RPC atómico — es el mismo evento de kardex, cambia solo el texto
   de notas y (potencialmente) el `movement_type`. **No se separa**.
3. **Numeración secuencial por ajuste**, patrón `site_counters` (misma
   estrategia que `sales.numero`). Requiere columna nueva
   `inventory_adjustments.numero`.
4. Cada ajuste con impacto contable genera fila en `accounting_entries`.
   - **Disminuciones**: `expense`, categoría "Merma / Ajuste negativo",
     `amount = SUM(cost * quantity)`.
   - **Incrementos**: el ajuste lleva un campo **`motivo`** (`compra` /
     `sobrante` / `correccion`) que determina el asiento contable. Detalle
     completo en §6.2. **PENDIENTE DE VALIDACIÓN POR CONTADOR** antes del
     apply a prod; el diseño y el código pueden escribirse ya, el apply de
     Fase 2 queda condicionado.
5. **Costo promedio ponderado (WAC)** al incrementar:
   `nuevo_costo = (stock_actual * costo_actual + entrada * costo_entrada) /
   (stock_actual + entrada)`. Se persiste en **`products.cost`** (columna
   global del catálogo — ver §5). Al disminuir, `products.cost` **no
   cambia** (ver §5 y confirmación de D2).
6. **Reversión de incrementos no restaura WAC** (D5 cerrada, opción a): al
   anular un ajuste que ya recalculó `products.cost`, el costo queda en el
   valor movido. La UI de anulación lo avisa explícitamente:
   > *"El costo promedio del producto no se revierte automáticamente al
   > anular. Si necesitas el costo anterior, corrígelo con un ajuste de
   > costo manual."*

---

## 2. Estado actual del código (verificado, no asumido)

### 2.1 Tabla `inventory_adjustments` ([scripts/00_schema.sql:184-190](../scripts/00_schema.sql))

```
adjustment_id      UUID PK DEFAULT gen_random_uuid()
warehouse_id       UUID NOT NULL FK warehouses(warehouse_id) ON DELETE CASCADE
notes              TEXT
total_adjusted     NUMERIC(14,2) NOT NULL DEFAULT 0
adjustment_date    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
```

**Faltantes** para el nuevo modelo:
- `numero INTEGER` (numeración secuencial por sede).
- `created_by UUID` (referencia a `auth.users(id)`, se llena con `auth.uid()`
  en el RPC).
- `status TEXT` (`active` | `voided`, para permitir reversión lógica sin
  perder trazabilidad).
- `updated_at TIMESTAMPTZ` (consistencia con otras tablas).
- `site_id UUID` derivable de `warehouse_id → warehouses.site_id`, pero se
  denormaliza aquí para las políticas RLS y el índice de numeración
  (analogía con `sales.site_id`). Sirve también para el `site_counters` que
  numera por sede.

### 2.2 Tabla `adjustment_items` ([scripts/00_schema.sql:192-199](../scripts/00_schema.sql))

```
adjustment_item_id  UUID PK
adjustment_id       UUID NOT NULL FK ON DELETE CASCADE
product_id          UUID NOT NULL FK
cost                NUMERIC(12,2) NOT NULL DEFAULT 0
objective           VARCHAR(12) NOT NULL CHECK IN ('incrementar','disminuir')
quantity            INTEGER NOT NULL CHECK (quantity > 0)
```

Sirve tal cual. No requiere cambios en Fase 1.

### 2.3 `createAdjustment` ([lib/inventory-actions.ts:372-424](../lib/inventory-actions.ts))

Flujo actual (**no atómico**, ya diagnosticado en detalle en un turno
anterior):

1. `INSERT inventory_adjustments`.
2. `INSERT adjustment_items` (N filas). Si falla, `DELETE` del header
   (rollback casero).
3. `Promise.all(items.map(it => supabase.rpc('adjust_warehouse_stock', …)))`.

Si el paso 3 falla parcialmente, quedan `product_stock` movidos + un
`inventory_adjustments` con ítems que **no cuadran con el kardex real**. El
detector `verify_kardex_integrity()` sí revelaría el descuadre por-cell.

**No genera asiento contable**. La deuda técnica está anotada en
[app/inventory/CLAUDE.md](../app/inventory/CLAUDE.md):
> `createAdjustment` sigue haciendo mutaciones multi-paso desde el server
> action (no atómica); migrar a RPC como se hizo con `create_sale`.

### 2.4 `deleteAdjustment` ([lib/inventory-actions.ts:426-460](../lib/inventory-actions.ts))

- `Promise.all` de `adjust_warehouse_stock` con delta invertido, luego
  `DELETE inventory_adjustments` (cascade a `adjustment_items`).
- Mismo riesgo de partial-revert que create.
- **Borra físicamente el header**: se pierde trazabilidad. Bajo el modelo
  nuevo esto se reemplaza por `status='voided'`.

### 2.5 `receiveMerchandise` ([lib/inventory-actions.ts:912-928](../lib/inventory-actions.ts))

```ts
return createAdjustment({
  warehouse_id: input.warehouse_id,
  notes: input.notes ? `[Entrada] ${input.notes}` : "[Entrada de mercancía]",
  items: input.items.map((it) => ({ ...it, objective: "incrementar" as const })),
})
```

Puro wrapper. Hereda todos los problemas del `createAdjustment` y **no
asienta nada en contabilidad**. Inconsistente con `ingressNewProduct` que sí
asienta (ver §2.6).

### 2.6 `ingressNewProduct` (referencia para el patrón contable) ([lib/inventory-actions.ts:1262-1370](../lib/inventory-actions.ts))

Crea producto **nuevo** en central. Al final:

```ts
// Kardex: movement_type = 'compra' (no 'ajuste')
await supabase.rpc("adjust_warehouse_stock", { …, p_movement_type: "compra", … })

// Contabilidad: expense por costo de adquisición
if (site_id && input.cost && qty > 0) {
  await supabase.from("accounting_entries").insert({
    site_id, entry_type: "expense",
    category: "Compra de mercancía",
    description: `Ingreso ${code} x${qty}`,
    amount: input.cost * qty,
  })
}
```

**Dos discrepancias entre `ingressNewProduct` y `receiveMerchandise`** que
hoy conviven:
- `ingressNewProduct` marca el kardex con `movement_type='compra'`;
  `receiveMerchandise` lo marca con `movement_type='ajuste'` (heredado de
  `createAdjustment`).
- `ingressNewProduct` asienta `expense`; `receiveMerchandise` no.

Ambos son entradas de mercancía. La diferencia real es "producto nuevo" vs
"producto ya existe". El impacto contable debería ser el mismo. Esta
discrepancia se resuelve en Fase 2 (§8), no en Fase 1.

### 2.7 `adjust_warehouse_stock` ([scripts/01_functions.sql:15-72](../scripts/01_functions.sql))

Atómico por-cell (`UPDATE product_stock … WHERE product_id=$1 AND
warehouse_id=$2` + `INSERT stock_movements` en la misma transacción; valida
stock ≥ 0; `RAISE EXCEPTION` en descuadre). No se toca en esta reescritura;
el RPC nuevo lo llama por ítem como hoy.

### 2.8 `site_counters` ([scripts/05_merge_features.sql:172-186](../scripts/05_merge_features.sql))

Tabla existente (`site_id, last_numero`) usada por `create_sale` para
`sales.numero`. Se **comparte** con ajustes o se crea un counter propio →
**decisión abierta D3**.

### 2.9 `accounting_entries` ([scripts/00_schema.sql:219-228](../scripts/00_schema.sql))

`site_id, entry_type ('income'|'expense'), category, description, amount>=0,
sale_id`. La FK `sale_id` no aplica para ajustes; se puede dejar `NULL` y
referenciar el ajuste vía `description`, o **añadir una FK opcional
`adjustment_id`** (decisión abierta D4).

### 2.10 RLS actual ([scripts/02_rls.sql:147-153](../scripts/02_rls.sql))

```
inventory_adjustments_read   → SELECT authenticated USING (true)
inventory_adjustments_write  → INSERT authenticated WITH CHECK is_admin_or_encargado()
inventory_adjustments_update → UPDATE authenticated USING is_admin_or_encargado()
```

Con el RPC SECURITY DEFINER, **la escritura pasa a estar cerrada** (sin
policy INSERT/UPDATE/DELETE permisiva a authenticated) — misma estrategia
que `sale_payments` en Fase 1 credit-sales. La escritura solo entra por el
RPC.

---

## 3. Modelo de datos propuesto

### 3.1 `inventory_adjustments` (ampliada) — ALTER completo de Fase 1

```sql
ALTER TABLE inventory_adjustments
  ADD COLUMN site_id     UUID REFERENCES sites(site_id) ON DELETE SET NULL,
  ADD COLUMN numero      INTEGER,
  ADD COLUMN status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','voided')),
  ADD COLUMN motivo      TEXT
    CHECK (motivo IS NULL OR motivo IN ('compra','sobrante','correccion')),
  ADD COLUMN created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill: derivar site_id desde warehouse_id para históricos.
UPDATE inventory_adjustments a
   SET site_id = w.site_id
  FROM warehouses w
 WHERE a.warehouse_id = w.warehouse_id AND a.site_id IS NULL;

-- Numeración: única por (site_id, numero) cuando numero no es NULL.
CREATE UNIQUE INDEX idx_adjustments_numero_site
  ON inventory_adjustments (site_id, numero) WHERE numero IS NOT NULL;

-- Trigger updated_at (patrón existente).
CREATE TRIGGER update_inventory_adjustments_updated_at
  BEFORE UPDATE ON inventory_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

Notas:
- **`site_id`** denormalizado desde `warehouse_id` para RLS + numeración
  por sede. Se llena en `create_adjustment` a partir del warehouse.
- **`numero`** es `NULL` en históricos (previos a la migración). El unique
  parcial permite convivencia. Fase 1 no lo llena (queda para Fase 2 cuando
  se cablee `adjustment_counters`).
- **`status='voided'`** reemplaza el `DELETE` físico actual.
  `deleteAdjustment` → `voidAdjustment` (nombre nuevo, ver §4).
- **`motivo`** (para D1): incluido en el esquema desde Fase 1 aunque el
  cableado contable se implementa en Fase 2. Así el ALTER es único y no
  rehacemos migración. Regla de negocio (validada en el RPC, no en un
  CHECK complejo): `motivo` obligatorio si el ajuste contiene items con
  `objective='incrementar'`; puede quedar NULL si el ajuste es 100%
  disminuciones o para históricos. El CHECK de tabla solo restringe los
  valores válidos, la obligatoriedad condicional vive en el RPC.
- **`created_by`** (D11 credit-sales): se llena con `auth.uid()` en el RPC.
- **`updated_at`** para consistencia con otras tablas del sistema.

### 3.2 `adjustment_items`

Sin cambios de esquema. La lógica atómica ocurre en el RPC.

### 3.3 Cambios en `site_counters`

Ver decisión abierta **D3**. Opciones:
- **(a)** Un solo counter compartido con ventas: `sales.numero` y
  `inventory_adjustments.numero` conviven en el mismo espacio numérico por
  sede. Simple pero mezcla numeraciones.
- **(b)** Counter propio para ajustes:
  ```sql
  CREATE TABLE adjustment_counters (
    site_id     UUID PRIMARY KEY REFERENCES sites(site_id),
    last_numero INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO adjustment_counters (site_id, last_numero) SELECT site_id, 0 FROM sites;
  ```

---

## 4. RPCs propuestos

Todos con `SECURITY DEFINER SET search_path = public`, `REVOKE FROM PUBLIC,
anon`, `GRANT EXECUTE TO authenticated`. Identidad siempre desde
`auth.uid()` (regla D11 credit-sales Fase 1).

### 4.1 `create_adjustment` — NUEVO

```sql
create_adjustment(
  p_warehouse_id UUID,
  p_notes        TEXT,
  p_items        JSONB   -- [{ product_id, cost, objective, quantity }]
) RETURNS UUID          -- adjustment_id
```

Lógica (una sola transacción PL/pgSQL):

1. Chequeo sesión + rol: `admin | encargado`.
2. Chequeo sede: `encargado` solo si `user_site_id()` = sede del warehouse.
3. Validar `p_items` no vacío; cada item tiene `product_id`, `quantity>0`,
   `objective in ('incrementar','disminuir')`, `cost >= 0`.
4. Resolver `v_site_id` desde `warehouse_id`. Si no encuentra warehouse →
   `RAISE`.
5. `UPDATE site_counters (o adjustment_counters, ver D3) SET last_numero =
   last_numero + 1 WHERE site_id = v_site_id RETURNING last_numero INTO
   v_numero`.
6. `INSERT inventory_adjustments (…, numero=v_numero, created_by=auth.uid(),
   status='active', total_adjusted=SUM(cost*quantity))` → `v_adj_id`.
7. `INSERT adjustment_items` en batch.
8. Por cada item:
   - Delta = `+quantity` (incrementar) o `-quantity` (disminuir).
   - `PERFORM adjust_warehouse_stock(product_id, warehouse_id, delta,
     'ajuste', 'adjustment', v_adj_id, auth.uid(), p_notes)`.
   - Si `objective='incrementar'` y `cost > 0`: recalcular WAC (ver §5) y
     `UPDATE products SET cost = nuevo_costo WHERE product_id=...`.
9. Asiento contable (ver §6 y decisión D1 para incrementos).
10. Retornar `v_adj_id`.

Cualquier `RAISE EXCEPTION` en 8, 9 o 10 revierte todo el bloque
automáticamente por ser una sola transacción.

### 4.2 `void_adjustment` — NUEVO (reemplaza `deleteAdjustment`)

```sql
void_adjustment(p_adjustment_id UUID) RETURNS VOID
```

1. Chequeo sesión + rol/sede.
2. `SELECT ... FOR UPDATE` del ajuste. `RAISE` si `status='voided'` o no
   existe.
3. `UPDATE inventory_adjustments SET status='voided'`.
4. Por cada item: `PERFORM adjust_warehouse_stock` con delta invertido,
   `movement_type='ajuste'`, `notes='Reversión ajuste #<numero>'`.
5. Reversa contable:
   - Si el ajuste original asentó `expense` → asiento `income` compensatorio
     por el mismo monto, con `description = 'Reversión ajuste #<numero>'`.
   - Si asentó `income` (caso de incrementos según D1) → `expense`
     compensatorio.
   - Si no asentó nada (D1 = no asentar incrementos) → nada.
6. **WAC en reversión**: al reversar un incremento, `products.cost` no se
   "des-recalcula" (el histórico no se puede reconstruir con simple
   fórmula). Se acepta que reversar un incremento con WAC ya recalculado
   deja el costo movido — ver decisión D5. Mitigación: la UI advierte al
   admin que el costo promedio quedó afectado por el incremento y no se
   restaura al reversar.

Nota: al ser `SECURITY DEFINER`, el UPDATE de `inventory_adjustments` bajo
RLS cerrada solo pasa por acá.

### 4.3 Wrapper de Server Action: `receiveMerchandise`

Se mantiene la firma actual. Internamente:

```ts
export async function receiveMerchandise(input: {
  warehouse_id: string
  notes?: string | null
  items: { product_id: string; cost: number; quantity: number }[]
}) {
  return createAdjustment({
    warehouse_id: input.warehouse_id,
    notes: input.notes ? `[Entrada] ${input.notes}` : "[Entrada de mercancía]",
    items: input.items.map((it) => ({ ...it, objective: "incrementar" as const })),
  })
}
```

Sin cambios de API. Lo que cambia es que `createAdjustment` internamente
llama al RPC atómico `create_adjustment` en lugar del `Promise.all` actual.

### 4.4 Eliminación de la vía Server-Action multi-paso

- `createAdjustment` (Server Action) pasa a ser un wrapper de una línea
  sobre `supabase.rpc('create_adjustment', …)`, con `requireRole` + toast
  de error si el RPC falla.
- `deleteAdjustment` se renombra a `voidAdjustment` (semántica correcta),
  wrapper de `supabase.rpc('void_adjustment', …)`.
- La UI de `/inventory/adjustments` que hoy dispara `deleteAdjustment` sigue
  funcionando; solo cambia el copy del `AlertDialog` de "Eliminar ajuste"
  a "Anular ajuste" y del toast.

---

## 5. Costo promedio ponderado (WAC)

### 5.1 Fórmula al incrementar

Para cada item con `objective='incrementar'` y `cost > 0`:

```
stock_actual = product_stock.quantity ANTES del delta   (todas las bodegas, o solo la afectada — ver D6)
costo_actual = products.cost
entrada      = item.quantity
costo_entrada = item.cost

nuevo_costo = (stock_actual * costo_actual + entrada * costo_entrada) / (stock_actual + entrada)

UPDATE products SET cost = nuevo_costo WHERE product_id = <item.product_id>
```

### 5.1.1 Orden exacto dentro del RPC (crítico — punto más delicado de Fase 2)

Por cada `v_item` con `objective='incrementar'` y `cost > 0`, dentro del
loop del RPC:

```
1. SELECT cost INTO v_cost_before
     FROM products
    WHERE product_id = v_item.product_id
     FOR UPDATE;
   -- Bloquea la fila para toda otra transacción que quiera recalcular WAC
   -- del mismo producto. Serializa el WAC concurrente.

2. SELECT COALESCE(SUM(quantity), 0) INTO v_stock_global_before
     FROM product_stock
    WHERE product_id = v_item.product_id;
   -- Suma global (D6: todas las bodegas). Se lee ANTES del delta para no
   -- doble-contar la entrada. Nota de concurrencia: una venta simultánea
   -- de este mismo producto podría bajar el stock entre este SELECT y el
   -- adjust_warehouse_stock de abajo; el error resultante en el WAC es
   -- pequeño (una venta = pocas unidades) y aceptable — el WAC es una
   -- media móvil, no un balance atómico. Si se quisiera atomicidad total,
   -- SELECT ... FOR UPDATE sobre todas las filas de product_stock del
   -- producto — pero introduce contención alta con ventas. Aceptamos el
   -- trade-off.

3. INSERT adjustment_items (...)

4. PERFORM adjust_warehouse_stock(v_item.product_id, warehouse_id, +qty,
                                 'ajuste', 'adjustment', v_adj_id, auth.uid(),
                                 p_notes);
   -- Aplica el delta atómicamente al kardex y a product_stock de la
   -- bodega afectada.

5. v_new_cost := (v_stock_global_before * v_cost_before
                 + v_item.quantity      * v_item.cost)
                / (v_stock_global_before + v_item.quantity);

6. UPDATE products SET cost = v_new_cost
    WHERE product_id = v_item.product_id;
   -- El FOR UPDATE del paso 1 se libera al COMMIT.
```

**Puntos clave**:
- **Lock ANTES del cálculo** (paso 1): evita que dos `create_adjustment`
  concurrentes sobre el mismo producto lean cada uno un `cost` distinto y
  se pisen mutuamente.
- **Stock global ANTES del delta** (paso 2 antes del 4): si se leyera
  después, el SUM incluiría el `+qty` recién aplicado, y la fórmula
  duplicaría la entrada.
- **Loop iterativo, no batch**: si el ajuste tiene 2 items del mismo
  producto, el segundo lee el `cost` YA recalculado por el primero. Cada
  item ve el estado post-item-anterior. Correcto.
- **Divisor > 0 garantizado**: `v_stock_global_before >= 0` y
  `v_item.quantity > 0` (validado antes en el loop) → nunca división por
  cero.
- **Caso `stock_global_before = 0`**: la fórmula reduce a `v_new_cost =
  cost * qty / qty = cost`. El primer ingreso del producto define el
  costo. Correcto.

Si `v_item.cost = 0` en un incremento: **no recalcular** (skip pasos 1, 2,
5, 6; solo se ejecuta el paso 4). Se asume "entrada sin costo" — no debe
diluir el costo promedio.

En disminuciones: nada del bloque WAC se ejecuta (D2). Solo el `PERFORM
adjust_warehouse_stock` con delta negativo.

### 5.2 En disminuciones

`products.cost` **NO cambia**. Es la práctica contable estándar del WAC:
las salidas se valorizan al costo promedio actual, sin recalcular. La
salida sí afecta el asiento contable (el `expense` de merma se calcula con
el `cost` vigente al momento).

**Confirmación**: sí, el WAC no cambia al disminuir. Documentado como
regla — no hay excepción prevista.

### 5.3 `products.cost` vs costo por bodega

Hoy `products.cost` es **global** (no por bodega). Consecuencia: si una
sede recibe con costo distinto, el WAC recalculado se aplica al catálogo
entero. Esto puede ser aceptable para un modelo simple (una compra afecta
el costo del modelo, no de "una unidad en una bodega específica"), o
puede ser una limitación en escenarios de distintos costos por sede.

**Decisión pragmática**: se mantiene `products.cost` global en Fase 2. Si
más adelante se necesita costo por bodega, se añade una columna en
`product_stock.cost`. Es una decisión de negocio que sale de este spec.

---

## 6. Interacción contable

### 6.1 Disminuciones (definido)

Asiento único por ajuste:
- `site_id = inventory_adjustments.site_id`
- `entry_type = 'expense'`
- `category = 'Merma / Ajuste negativo'`
- `amount = SUM(item.cost * item.quantity WHERE objective='disminuir')`
- `description = 'Ajuste #<numero> — <notes>'`

Se usa el `cost` guardado en `adjustment_items` (que el usuario ingresó al
crear el ajuste). Si el usuario deja `cost=0` en un item de disminución,
ese item no aporta al asiento (pero sí afecta el stock).

### 6.2 Incrementos por motivo (D1 cerrada — opción c)

El `motivo` del ajuste (§3.1) determina qué asiento se genera. Solo aplica
si hay items `objective='incrementar'`. Los items `disminuir` del mismo
ajuste (si los hubiera) generan además su asiento de merma (§6.1) — los
asientos se acumulan por bloque, no se compensan.

### ⚠ Gate contable de Fase 2 — punto crítico único

**El punto que probablemente cambie tras la revisión del contador es el
tratamiento de `motivo='compra'` como `expense` inmediato.** Los otros dos
son defendibles con la simplificación caja del sistema:
- `sobrante` como `income`: reconoce valor que entra al negocio sin
  contraparte de caja. Coincide con partida doble estricta.
- `correccion` sin asiento: no hay evento económico real; asentar
  duplicaría o distorsionaría.

El caso `compra` es distinto: **partida doble estricta NO impacta P&L al
comprar** (asset↑ Inventario / cash↓ o pasivo↑ Proveedores). La utilidad se
reconoce solo cuando el producto se vende (COGS). El sistema simplifica a
"gasto al comprar" porque no maneja cuentas de balance (`accounting_entries`
solo tiene `income`/`expense`). Consecuencias potenciales que el contador
debe revisar:

1. **Doble reconocimiento del costo**: si mañana se añade COGS al vender
   (via `create_sale` asentando el costo como `expense`), el mismo peso
   contaría dos veces (una al comprar, otra al vender). Hoy `create_sale`
   NO asienta COGS, así que no hay doble conteo — pero es una trampa
   escondida para el futuro.
2. **Distorsión temporal de P&L**: un mes con compra grande y ventas
   normales muestra pérdida ficticia; el mes siguiente sin compras muestra
   utilidad inflada. La P&L no refleja rentabilidad real por periodo.
3. **Base fiscal**: para declaración de renta / IVA, el "costo de ventas"
   colombiano suele calcularse por método de inventarios (WAC, PEPS, etc.),
   no por "compras del periodo". El contador puede necesitar un asiento
   distinto o una re-clasificación al cerrar mes.

**Opciones alternativas si el contador rechaza `compra` como `expense`
inmediato**:

- **(a1)** No asentar nada al comprar; añadir cuenta de balance
  "Inventario" y asentar `expense` como COGS al vender (requiere ampliar
  `accounting_entries` con `entry_type='asset'` y cablear el COGS en
  `create_sale`). Cambio grande — otro spec.
- **(a2)** Asentar `compra` como movimiento neutral P&L (nueva categoría
  `entry_type='asset_purchase'` u otra) que los reportes puedan aislar.
  Cambio medio — otro spec.
- **(a3)** Mantener el `expense` de este spec, pero cerrar mes con un
  asiento manual de reclasificación (compras no vendidas → inventario).
  Sin cambio de código; procedimiento del contador.

**Este spec propone la simplificación actual** (`compra` → `expense`
inmediato) porque es coherente con el sistema, `ingressNewProduct` ya la
usa, y es lo que el contador probablemente esperaba antes de este análisis.
Si tras la revisión pide (a1)/(a2)/(a3), se abre spec separado. **Fase 2
no se aplica a prod hasta este OK.**

Documentar la respuesta del contador en el header de la migración final
de Fase 2, con fecha y quién validó.

---

Detalle de los 3 asientos:

| `motivo` | `entry_type` | `category` (en `accounting_entries`) | `amount` | Efecto P&L | Justificación |
|---|:---:|---|:---:|:---:|---|
| **`compra`** | `expense` | `"Compra de mercancía"` | `SUM(cost * quantity)` de items incrementar | **−** utilidad | Recepción de mercancía al proveedor. Bajo el modelo base-caja simplificado del sistema (income/expense = P&L directo), la salida de efectivo por la compra se reconoce como gasto operativo. **Nota contable pura**: en partida doble estricta sería *Débito Inventario / Crédito Caja o Proveedores* (asset↑ + cash↓ o pasivo↑), sin impacto directo en P&L; la utilidad se reconoce cuando el producto se vende. La app usa la simplificación de "gasto en el momento de la compra" para no requerir cuentas de balance. **A validar con contador.** |
| **`sobrante`** | `income` | `"Sobrante de inventario"` | `SUM(cost * quantity)` de items incrementar | **+** utilidad | Aparecen unidades que no estaban registradas (conteo físico > sistema). No hubo egreso de caja, pero el valor de las unidades encontradas debe reflejarse como ingreso no operacional para que la P&L cuadre con el aumento de inventario. **En partida doble**: *Débito Inventario / Crédito Ingresos por sobrantes*. Coincide con el modelo simplificado. |
| **`correccion`** | *(ninguno)* | *(N/A)* | *(N/A)* | **0** | Rectificación de dato del sistema sin evento económico real (p. ej. error de captura histórico). El kardex se ajusta (`movement_type='ajuste'`) pero contabilidad no se toca — asentar duplicaría o distorsionaría un hecho ya (mal) reconocido en otro lado. La UI debe requerir un texto en `notes` que justifique la corrección para auditoría. |

**Kardex**: los tres motivos usan `movement_type='ajuste'` en Fase 2 para
mantener un único filtro simple del kardex por tipo. **Alternativa (fuera de
alcance)**: mapear `compra`→`'compra'` en el kardex, alineando con
`ingressNewProduct`. Si el contador lo pide para reportes, se evalúa.

**Descripción del asiento**: `'Ajuste #<numero> (<motivo>) — <notes>'` para
trazabilidad textual, más `adjustment_id` FK si se aprueba D4.

**Regla de validación en `create_adjustment`**:
- Si el ajuste tiene al menos un item `objective='incrementar'` → `motivo`
  es obligatorio y debe ser uno de los 3 valores.
- Si el ajuste es 100% disminuciones → `motivo` debe ser NULL
  (`RAISE EXCEPTION` si se envía).
- Si el motivo es `correccion` → no asentar en `accounting_entries` los
  incrementos (los items disminución del mismo ajuste sí asientan `expense`
  de merma según §6.1).

### 6.3 Referencia al ajuste desde `accounting_entries`

**Decisión abierta D4**: añadir columna `adjustment_id UUID REFERENCES
inventory_adjustments(adjustment_id) ON DELETE SET NULL` a
`accounting_entries` (analogía con `sale_id`). Ventajas: trazabilidad
directa, permite filtrar reportes contables por ajuste. Alternativa: dejar
solo el texto en `description` con el `numero`.

---

## 7. Numeración

- Formato: `#<numero>` visible en UI (`Ajuste #142`).
- Único por sede — el mismo numero puede repetirse en otra sede
  (consistente con `sales.numero`).
- Se genera atómicamente dentro del RPC vía `adjustment_counters` (D3):
  ```sql
  UPDATE adjustment_counters
     SET last_numero = last_numero + 1
   WHERE site_id = v_site_id
   RETURNING last_numero INTO v_numero;
  ```
- **Backfill de históricos: NO se hace** (decisión: opción **b** del brief).
  Motivos:
  - Los ajustes históricos ya vivían sin numero; ninguna referencia
    externa depende de un numero retroactivo.
  - Numerar por `ROW_NUMBER() OVER (PARTITION BY site_id ORDER BY
    adjustment_date)` reorganizaría los IDs de forma arbitraria si dos
    ajustes tienen el mismo timestamp, sin ganancia de auditoría.
  - Los reportes muestran "—" para históricos y `#N` para los nuevos.
    Impacto UX mínimo.
  - Si más adelante se necesita, se hace en una tarea separada con orden
    determinístico (por `created_at, adjustment_id`) y actualización
    coordinada de `adjustment_counters.last_numero = MAX(numero)` por
    sede. **No es parte de Fase 2A.**

---

## 8. Fases

### Fase 1 — RPC atómico + esquema completo, sin cambio observable

**Objetivo**: eliminar el bug de partial-write y dejar el esquema listo
para Fase 2 sin migraciones extra; el usuario no ve nada distinto.

- **`ALTER inventory_adjustments` completo** (§3.1): agrega `site_id`,
  `numero`, `status`, **`motivo`**, `created_by`, `updated_at`. `numero` y
  `motivo` quedan `NULL` en Fase 1 (no se llenan aún); se cablean en Fase
  2 sin necesidad de otra migración. Esto cierra el requisito "esquema
  completo desde Fase 1" del brief.
- **`CREATE UNIQUE INDEX idx_adjustments_numero_site`** (parcial, WHERE
  numero IS NOT NULL) — inerte hasta que Fase 2 empiece a numerar.
- **Backfill de `site_id`** para históricos (§3.1).
- **Trigger `update_inventory_adjustments_updated_at`** (patrón existente).
- **RPC `create_adjustment`** (sin numeración, sin recalcular WAC, sin
  asiento, sin usar `motivo`). Solo mueve stock atómicamente + llena
  header + items + `created_by=auth.uid()` + `site_id` derivado.
- **RPC `void_adjustment`** (sin reversa contable). Marca `status='voided'`
  + reversa stock atómicamente.
- Server Actions `createAdjustment` / `deleteAdjustment` /
  `receiveMerchandise` pasan a delegar al RPC. Firma pública no cambia.
- **RLS** de `inventory_adjustments` y `adjustment_items`: **quitar
  policies de INSERT/UPDATE**, dejar solo `SELECT`. Escritura exclusiva
  vía RPC (patrón credit-sales Fase 1).
- Test E2E: crear ajuste con N items, forzar fallo en uno (p.ej. producto
  inexistente) → verificar rollback total (0 filas de header, 0 items, 0
  movements para ese ajuste). Test complementario: crear ajuste normal →
  verificar `SUM(stock_movements) = product_stock` por-cell.

### Fase 2 — Numeración + WAC + asiento contable

- Esquema **ya listo** desde Fase 1 (§3.1). Fase 2 solo cablea la lógica
  a las columnas `numero` y `motivo` que ya existen inertes. No hay
  `ALTER` de tabla adicional.
- `adjustment_counters` (D3).
- RPC `create_adjustment`:
  - Incorpora `UPDATE adjustment_counters ... RETURNING numero`.
  - Recalcula WAC en `products.cost` para items incrementar con cost>0.
  - Genera `accounting_entries` según §6 (disminuciones=expense; incrementos
    según D1).
- RPC `void_adjustment` genera asiento compensatorio.
- Alinear `ingressNewProduct` para consumir el mismo RPC
  `create_adjustment` (elimina la duplicación §2.6). Trivial: crea el
  producto y luego llama al RPC con un solo item incremento — mismo asiento,
  mismo kardex.
- E2E:
  - Ajuste con incremento → WAC recalculado → asiento correcto.
  - Ajuste con disminución → `expense` por merma.
  - Void → asiento reverso correcto.
  - Numeración: dos ajustes consecutivos en misma sede → 1, 2.
  - Numeración: paralelo en dos sedes → cada una empieza en 1.

### Fase 3 — UI: detalle, edición

- Página `/inventory/adjustments/[adjustment_id]` (detalle read-only con
  header + items + botón "Anular" si `status='active'`).
- **Editar ajuste**: ver **decisión abierta D7**. Recomendación: **no
  permitir editar**, el modelo trata cada ajuste como inmutable; para
  corregir se anula y se crea uno nuevo (analogía con ventas).
- Consumer de `getAdjustmentById` (ya existe, hoy código muerto — ver
  diagnóstico previo).
- Filtros por sede, rango de fechas, `status`.

---

## 9. RLS

- `inventory_adjustments`:
  - `SELECT`: `authenticated USING (true)` (patrón actual).
  - `INSERT/UPDATE/DELETE`: **cerradas** (sin policy). Escritura vía RPC
    SECURITY DEFINER.
- `adjustment_items`: idem.
- `adjustment_counters` (si se crea): `SELECT` + escritura cerrada.

---

## 10. Decisiones abiertas

### D1 — Tratamiento contable de incrementos — **CERRADA: opción (c) motivos**

Resolución: 3 motivos (`compra`, `sobrante`, `correccion`) con asiento
propio. Ver tabla completa en §6.2. Columna `motivo` va en el ALTER de
Fase 1 aunque el cableado contable se implemente en Fase 2.

**⚠ Pendiente de validación por contador** antes del apply a prod de Fase
2. El diseño y el código pueden escribirse ya.

Devolución de cliente **no** es motivo de ajuste — se maneja por
`void_sale`.

### D2 — Costo promedio en disminuciones (confirmar regla)

Confirmar que `products.cost` **no cambia** al disminuir. Es la regla WAC
estándar; solo lo marco como decisión abierta porque el brief lo listó
para confirmación explícita.

**Recomendación**: confirmado.

### D3 — Numeración: compartir `site_counters` con ventas o counter propio

- **(a) Compartir `site_counters`**: `sales.numero` y
  `inventory_adjustments.numero` conviven en el mismo espacio (una venta
  puede ser #142 y el siguiente ajuste ser #143 en la misma sede). Simple.
  Rompe la expectativa de "los ajustes también empiezan en 1".
- **(b) Crear `adjustment_counters`**: cada tipo con su propio secuencial.
  Más natural para el usuario. Requiere una tabla nueva pero es trivial.

**Recomendación**: **(b)**, alineado con la práctica de ERPs (numeraciones
por tipo de documento). Fase 2.

### D4 — Referencia `adjustment_id` en `accounting_entries`

Añadir columna FK o dejar solo texto en `description`.

**Recomendación**: **añadir la FK** por trazabilidad y facilidad de
reportes. Cambio menor en Fase 2.

### D5 — WAC en reversión de incrementos — **CERRADA: opción (a)**

Resolución: al anular un incremento que ya recalculó `products.cost`, el
costo **no se revierte**. La UI de anulación muestra:

> *"El costo promedio del producto no se revierte automáticamente al
> anular. Si necesitas el costo anterior, corrígelo con un ajuste de costo
> manual."*

Persistir un `product_cost_history` (opción b) queda fuera de alcance;
puede evaluarse si aparece un caso de negocio real que lo justifique.

### D6 — WAC: `stock_actual` = de la bodega afectada o de todas

Al recalcular WAC, ¿el "stock actual" es solo la bodega donde entra la
mercancía o el total del negocio?

- **(a) Total global**: `SUM(product_stock.quantity)` sobre todas las
  bodegas. Consistente con `products.cost` siendo global.
- **(b) Solo bodega afectada**: `product_stock.quantity` de esa bodega.
  Cambio local, pero se aplica al `products.cost` global — inconsistente
  semánticamente.

**Recomendación**: **(a) global**, coherente con `products.cost` global.
Fase 2.

### D7 — Editar ajuste vs solo reversar

- **(a) Solo reversar** (recomendado): un ajuste creado es inmutable. Para
  corregir, se anula y se crea uno nuevo. Analogía con `void_sale`.
  Trazabilidad completa en el kardex.
- **(b) Permitir editar** el ajuste mientras esté `active`. Requiere
  reversar los movimientos originales y aplicar los nuevos dentro de una
  sola transacción (mismo RPC pero con `p_adjustment_id` para editar).
  Complejidad extra sin ganancia clara.

**Recomendación**: **(a)**. Fase 3 UI no incluye botón "Editar".

### D8 — Migrar `ingressNewProduct` en Fase 2

Cuando el RPC atómico esté con contabilidad, ¿se refactoriza
`ingressNewProduct` para consumirlo? Elimina la duplicación §2.6 pero
requiere touching el flow de "crear producto nuevo".

**Recomendación**: **sí**, es parte de Fase 2. Sin esto, quedamos con dos
lógicas de entrada de mercancía divergentes (una que asienta, otra que
no).

---

## 10.1 Decisiones nuevas surgidas al escribir Fase 2 (DN1/DN2/DN3)

**DN1 — WAC continúa desde valor movido tras void.** Cuando `void_adjustment`
deja `products.cost=X` (movido, no revertido por D5) y luego se crea un
nuevo incremento del mismo producto con `cost=Y`, el nuevo WAC se calcula
sobre X como base. Semánticamente correcto (el promedio "continúa" desde
donde estaba). Es (a) del D5 llevado a la práctica. Sin cambio de
comportamiento; documentado en el RPC de Fase 2C.

**DN2 — `movement_type='ajuste'` uniforme post-Fase 2D.** Tras migrar
`ingressNewProduct` al RPC común (2D), toda entrada de mercancía queda
como `movement_type='ajuste'` en el kardex; la distinción compra vs ajuste
migra a `inventory_adjustments.motivo`. Análisis completo del impacto en
[scripts/17d_adjustments_unify_entries.md](../scripts/17d_adjustments_unify_entries.md)
(auditoría de lectores, granularidad perdida, recuperación vía join,
costo residual UI del filtro "Compra" del kardex — mitigado con copy
"Compra (histórico)" en Fase 3). Aceptable: la info no se pierde, ningún
consumidor runtime hoy filtra por `movement_type='compra'` (grep
exhaustivo lo confirma), y gana consistencia.

**DN3 — `adjustment_counters` seed on-the-fly.** El seed inicial de 2A
crea 1 fila por sede existente, pero sedes creadas DESPUÉS del apply de
2A no tendrían fila. El RPC de Fase 2A hace `INSERT ... ON CONFLICT` como
fallback si el UPDATE del counter no retorna filas (sede nueva sin
counter → crear on-the-fly con `last_numero=1`). Probado en T1 de
[scripts/17_validation_phase2.sql](../scripts/17_validation_phase2.sql).
Sin cambio requerido.

---

## 11. Fuera de alcance

- Ajustes multi-bodega en un solo documento (hoy `warehouse_id` es
  singular; no cambiar).
- Costo por bodega (`product_stock.cost`) — mantener `products.cost`
  global.
- Historial de WAC en `product_cost_history` (D5(b)).
- Reversión de reversión (unvoid): un ajuste `voided` no se puede
  "reactivar", si se necesita hay que crear un ajuste nuevo.
- **Motivos para disminuciones**: hoy toda disminución es "merma"
  implícita. Podría extenderse a motivos (`merma` / `daño` / `robo` /
  `correccion`) por simetría con incrementos. No pedido en este spec —
  candidato natural a extensión posterior si el contador lo requiere.
- **Mapear `compra` a `movement_type='compra'` en el kardex** (en lugar
  de `'ajuste'`), alineando con `ingressNewProduct`. Cambio de reporte,
  no de correctitud. Evaluar si el contador pide separar en reportes de
  kardex.
