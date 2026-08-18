# Ventas a crédito (fiado / a cuenta) — Spec

> Estado: **spec cerrado, pendiente OK final**. Todas las decisiones D1–D8
> están resueltas al pie del documento. La implementación se hace en 3 fases
> (§8) y arranca solo tras aprobación.
>
> Alcance: ventas a cuenta con abonos parciales, cuentas por cobrar, y su
> impacto en caja / contabilidad. Base **caja** (el ingreso se reconoce
> cuando entra la plata, no al fiar).
>
> **Vocabulario.** El flag de negocio se llama **`is_on_account`** (fiado),
> nunca `is_credit`, para no colisionar con `classifyMethod()`
> ([lib/shift-actions.ts:33](../lib/shift-actions.ts)) que ya usa `"credit"`
> para tarjeta de crédito (plata inmediata) — semánticamente lo opuesto.

---

## 1. Decisiones de negocio cerradas

1. Fiar no altera el kardex. Mercancía sale igual que en venta de contado
   (`adjust_warehouse_stock` con `movement_type='venta'`), stock nunca
   negativo. Solo la plata queda debiendo.
2. **Sin límite de crédito** por cliente.
3. Cualquier vendedor puede fiar; el RPC valida sesión + acceso a sede
   internamente.
4. **Caja**: un crédito aporta al arqueo **solo lo realmente recibido en
   efectivo** dentro del turno (abono inicial y/o abonos posteriores). El
   saldo pendiente NO entra al `expected_cash`.
5. Anulación de un crédito con abonos ya pagados → lo pagado pasa a **saldo a
   favor del cliente** (`customer_credits`).
6. **Contabilidad base caja**: se asienta `income` por cada entrada real de
   dinero, no por el total facturado.

---

## 2. Estado del código actual (verificado, no asumido)

### 2.1 `sales`

Definida en [scripts/00_schema.sql:158](../scripts/00_schema.sql) +
[scripts/05_merge_features.sql:152](../scripts/05_merge_features.sql):
`sale_id, customer_id, sale_date, total_amount, payment_method,
amount_received, seller, notes, site_id, warehouse_id, shift_id, numero,
status ('active'|'voided')`. Sin campos de crédito.

### 2.2 `create_sale` ([scripts/01_functions.sql:145](../scripts/01_functions.sql))

- **NO es `SECURITY DEFINER`**, sin chequeo de rol/sede — depende de RLS +
  wrapper. Diferente del patrón nuevo de `open_shift` / `close_shift`.
- Asienta `accounting_entries` `entry_type='income'` con
  `amount = p_total_amount` **siempre**. Correcto hoy porque toda venta es de
  contado; deja de serlo con fiado.

### 2.3 `close_shift` ([scripts/13_shifts_to_secdef_rpc.sql:127](../scripts/13_shifts_to_secdef_rpc.sql))

Suma `SUM(sales.total_amount)` filtrando por `payment_method ILIKE
'%efectivo%'`. Dos problemas heredados:

- **M12** (documentado en [PLAN-PENDIENTES.md:450](../PLAN-PENDIENTES.md)): no
  filtra por `status='active'`; ventas anuladas del turno cuentan igual.
- **Suma `total_amount`**, no lo recibido. Una venta a crédito de 100k con
  abono cash de 20k sumaría 100k → arqueo roto.

### 2.4 `void_sale` ([scripts/01_functions.sql:239](../scripts/01_functions.sql))

Marca `voided`, devuelve stock, asienta `expense = total_amount`. Bajo el
modelo nuevo debe reversar solo `sales.amount_paid` (§4.4).

### 2.5 `accounting_entries` ([scripts/00_schema.sql:219](../scripts/00_schema.sql))

`entry_type CHECK IN ('income','expense')`, `amount NUMERIC(14,2) CHECK >= 0`,
`sale_id` opcional. Sirve tal cual; con fiado habrá N asientos por venta.

### 2.6 `buildBalance()` ([lib/shift-actions.ts:59](../lib/shift-actions.ts))

Balance en vivo del POS. Mismo M12 y mismo bug estructural (SUM `total_amount`
en vez de recibido). Requiere el mismo cambio que `close_shift`, o divergen.

### 2.7 Walk-in

Sembrado por nombre en [scripts/04_seed.sql:32](../scripts/04_seed.sql)
(`'Consumidor final'`). El POS lo detecta también por nombre
([app/pos/page.tsx:220](../app/pos/page.tsx)). Para bloquear fiado al anónimo
necesitamos marcador determinístico → columna `allows_credit` (§3.3).

### 2.8 Ausencia de trabajos previos

Grep negativo para `credit/fiado/balance_due/amount_paid/sale_payment` en el
repo (los matches son medios de pago tarjeta, no fiado). Terreno virgen.

---

## 3. Modelo de datos

### 3.1 `sales` (ampliada)

```sql
ALTER TABLE sales
  ADD COLUMN is_on_account BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN amount_paid   NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0),
  ADD COLUMN balance_due   NUMERIC(12,2) GENERATED ALWAYS AS
    (total_amount - amount_paid) STORED;

ALTER TABLE sales
  ADD CONSTRAINT sales_amount_paid_within_total
  CHECK (amount_paid <= total_amount);
```

- Contado: `is_on_account=false`, `amount_paid=total_amount`, `balance_due=0`.
- A cuenta: `is_on_account=true`, `amount_paid ∈ [0, total_amount]`,
  `balance_due>0` mientras haya saldo.

Índice para CxC:

```sql
CREATE INDEX idx_sales_on_account_open
  ON sales (customer_id, sale_date)
  WHERE is_on_account = TRUE AND balance_due > 0 AND status = 'active';
```

### 3.2 `sale_payments` (nueva — ledger de abonos)

Patrón `stock_movements → product_stock`: la tabla es la **fuente de verdad**,
`sales.amount_paid` es caché derivado.

```sql
CREATE TABLE sale_payments (
    payment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id        UUID NOT NULL REFERENCES sales(sale_id) ON DELETE RESTRICT,
    amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(60) NOT NULL,
    shift_id       UUID REFERENCES pos_shifts(shift_id) ON DELETE SET NULL,
    site_id        UUID NOT NULL REFERENCES sites(site_id) ON DELETE RESTRICT,
    received_by    TEXT,
    notes          TEXT,
    status         TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','voided')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sale_payments_sale  ON sale_payments (sale_id);
CREATE INDEX idx_sale_payments_site  ON sale_payments (site_id, created_at);
CREATE INDEX idx_sale_payments_shift ON sale_payments (shift_id);
```

**Invariante:** para toda venta activa,
`SUM(sale_payments.amount WHERE status='active') = sales.amount_paid`.
Verificable con `verify_credit_integrity()` (análogo a
`verify_kardex_integrity()`).

`shift_id` es nullable porque un abono podría registrarse fuera de un turno
del POS (p. ej. desde `/customers`). En Fase 2 evaluamos si obligarlo (ver
§9 D9 nuevo).

### 3.3 `customers.allows_credit` + `customers.is_walk_in`

```sql
ALTER TABLE customers
  ADD COLUMN allows_credit BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN is_walk_in    BOOLEAN NOT NULL DEFAULT FALSE;

-- Marcador determinístico del walk-in: se ubica UNA vez por nombre y ahí
-- muere el match por texto. Todo lo demás usa is_walk_in.
UPDATE customers
   SET is_walk_in    = TRUE,
       allows_credit = FALSE
 WHERE name = 'Consumidor final';

-- Solo puede haber uno.
CREATE UNIQUE INDEX one_walk_in_customer ON customers (is_walk_in) WHERE is_walk_in;

-- Regla de negocio de datos: el walk-in nunca puede fiar.
ALTER TABLE customers
  ADD CONSTRAINT walk_in_never_allows_credit
  CHECK (NOT (is_walk_in AND allows_credit));
```

- Clientes nuevos nacen `allows_credit=TRUE`, `is_walk_in=FALSE`.
- El walk-in se identifica por `is_walk_in=TRUE` a partir de esta migración —
  el `WHERE name = 'Consumidor final'` corre **una sola vez** en el UPDATE de
  la migración. Nada en runtime lo detecta por nombre.
- El seed [scripts/04_seed.sql:32](../scripts/04_seed.sql) se ajusta para
  crear al walk-in ya con ambos flags (defensa en profundidad para entornos
  vírgenes).
- **[app/pos/page.tsx:220](../app/pos/page.tsx)** se actualiza para hallar el
  walk-in vía `customers.is_walk_in`, no por match del nombre. Cambio
  incluido en Fase 1.
- **Verificación post-migración (obligatoria, `RAISE EXCEPTION` si falla,
  aborta la transacción):**

  ```sql
  DO $$
  DECLARE v_count INT;
  BEGIN
      SELECT COUNT(*) INTO v_count
      FROM customers WHERE is_walk_in = TRUE AND allows_credit = FALSE;
      IF v_count <> 1 THEN
          RAISE EXCEPTION
            'Fase 1 aborta: se esperaba exactamente 1 walk-in con allows_credit=false, se encontraron %.', v_count;
      END IF;
  END $$;
  ```

  Cierra D12 en Fase 1.

### 3.4 `customer_credits` (nueva — Fase 1, solo emisión)

Ledger de saldo a favor del cliente. En Fase 1 solo se **emiten** entradas
(desde `void_sale` cuando hay `amount_paid > 0`). La **aplicación** a compras
futuras es Fase 3.

```sql
CREATE TABLE customer_credits (
    credit_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id    UUID NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    amount         NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
    source_type    TEXT NOT NULL CHECK (source_type IN ('void_sale','manual_adjustment','redemption')),
    source_sale_id UUID REFERENCES sales(sale_id) ON DELETE SET NULL,
    site_id        UUID NOT NULL REFERENCES sites(site_id) ON DELETE RESTRICT,
    notes          TEXT,
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_credits_customer ON customer_credits (customer_id, created_at);
```

- Emisión (`void_sale` → saldo a favor) inserta `amount > 0`, `source_type =
  'void_sale'`.
- Fase 3: redenciones insertarán `amount < 0`, `source_type = 'redemption'`.
- **Saldo a favor** = `SUM(amount)` por cliente. `CHECK (amount <> 0)` es
  intencional (permite signos opuestos según el tipo).

### 3.5 Vistas derivadas (no materializadas)

- **Saldo por cliente**: `SUM(sales.balance_due)` con `is_on_account, active,
  balance_due>0`.
- **Saldo a favor**: `SUM(customer_credits.amount)` por cliente.
- **CxC total del negocio**: `SUM(sales.balance_due)` global.

---

## 4. RPCs

Todas las nuevas y las migradas van con:

```sql
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

+ `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated`. Patrón
idéntico a [scripts/13_shifts_to_secdef_rpc.sql](../scripts/13_shifts_to_secdef_rpc.sql).

### 4.1 `create_sale` — MODIFICADO (**resolución D1**)

Pasa a `SECURITY DEFINER` con chequeo de rol/sede interno (como `open_shift`).
Nuevos parámetros:

- `p_is_on_account BOOLEAN DEFAULT FALSE`
- `p_initial_payment NUMERIC DEFAULT NULL`

Semántica:

| Caso | Efecto |
|---|---|
| `p_is_on_account = FALSE` | Igual que hoy. `amount_paid = total_amount`. Inserta **una** fila en `sale_payments` con `amount = total_amount` y `payment_method = p_payment_method`. Asienta `income` por `total_amount`. |
| `p_is_on_account = TRUE`, `p_initial_payment > 0` | `amount_paid = p_initial_payment`. Inserta fila en `sale_payments` con `amount = p_initial_payment` y `payment_method = p_payment_method` (el método del abono inicial). Asienta `income` **por `p_initial_payment` únicamente**. |
| `p_is_on_account = TRUE`, `p_initial_payment = 0` o NULL | `amount_paid = 0`. No inserta `sale_payments`. No asienta `income`. |

Validaciones nuevas:

- `p_is_on_account = TRUE` → cliente identificado con `allows_credit = TRUE`.
  Rechaza al walk-in (`is_walk_in=true`) y a cualquier cliente marcado
  `allows_credit=false`.
- `p_initial_payment IS NOT NULL` → debe cumplir
  `0 <= p_initial_payment <= p_total_amount`.
- Chequeo de rol/sede: `admin|encargado|vendedor`; `encargado|vendedor` solo
  si `p_site_id = user_site_id()`.
- **Identidad**: `p_user_id` queda en la firma solo por compat y se
  **ignora**. El kardex se escribe con `auth.uid()`. Ver D11.

**Etiqueta vs cálculo (matiz D8 — CRÍTICO):** `sales.payment_method` para
ventas a cuenta se guarda como **`'crédito'`** solo como etiqueta de display.
Ninguna lógica de caja, contabilidad ni reporte puede **jamás** decidir "es
venta a cuenta" leyendo `payment_method` (ni por igualdad ni por ILIKE). El
único origen de verdad es **`sales.is_on_account`**. Regla mecánica: si un
query hace `ILIKE '%crédito%'` sobre `payment_method` para clasificar una
venta, es un bug de la misma clase que D3. Enforcement: comentario en el
header del RPC + assertion en E2E de Fase 1 que crea una venta de contado con
`payment_method='Crédito Visa'` y verifica que `expected_cash` la cuenta
como cash-in-shift correctamente (o sea que la clasificación no se ensucia
con el texto).

### 4.2 `register_payment` — NUEVO (Fase 2)

```sql
register_payment(
    p_sale_id        UUID,
    p_amount         NUMERIC,
    p_payment_method TEXT,
    p_shift_id       UUID DEFAULT NULL,
    p_notes          TEXT DEFAULT NULL
) RETURNS JSONB  -- { payment_id, new_amount_paid, new_balance_due }
```

**No hay `p_received_by`**: se deriva de `auth.uid()` (nombre resuelto vía
`user_profiles`). Ver D11.

Lógica:

1. Chequeo sesión + rol + sede (contra `sales.site_id`).
2. `SELECT ... FOR UPDATE` de `sales` (evita carrera entre dos abonos).
3. Validar `status='active'`, `p_amount > 0`, `p_amount <= balance_due`.
4. **Guarda D9**: si `p_payment_method ILIKE '%efectivo%'` (o `'%cash%'`) y
   `p_shift_id IS NULL`, `RAISE EXCEPTION` — un abono cash **debe** ir contra
   un turno para no escaparse del arqueo. Si `p_shift_id` viene, se valida
   que sea un turno `open` de la misma sede que `sales.site_id`.
5. `INSERT sale_payments(sale_id, amount, payment_method, shift_id, site_id,
   received_by, notes)`.
6. `UPDATE sales SET amount_paid = amount_paid + p_amount`.
7. `INSERT accounting_entries` `income`, `category='Abono crédito'`,
   `amount=p_amount`, `sale_id=p_sale_id`.
8. Retornar JSON con estado nuevo.

### 4.3 `close_shift` — REESCRITO

Único cambio funcional (el resto del RPC queda igual):

```sql
-- ANTES (S1-paso1):
SELECT COALESCE(SUM(total_amount), 0) INTO v_cash_sales
FROM sales
WHERE shift_id = p_shift_id
  AND (payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%');

-- NUEVO:
SELECT COALESCE(SUM(amount), 0) INTO v_cash_sales
FROM sale_payments
WHERE shift_id = p_shift_id
  AND status = 'active'
  AND (payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%');
```

Con esto:

- Ventas de contado en efectivo → aportan `total_amount` (porque `create_sale`
  inserta su `sale_payments`).
- Ventas a cuenta → aportan solo el abono inicial en efectivo del turno.
- Abonos posteriores en efectivo → aportan si su `shift_id` = turno actual.
- **Resuelve M12** gratis: `status='active'` sobre `sale_payments` excluye los
  abonos de ventas anuladas.

### 4.4 `void_sale` — AJUSTADO (regla asimétrica contado vs fiado)

Reglas dependientes del tipo de venta:

**Caso A — Venta de contado (`is_on_account = FALSE`)** — regla **uniforme
intra y entre turnos**:

1. `sales.status='voided'`.
2. Devolver stock vía `adjust_warehouse_stock`.
3. **`sale_payments` NO se tocan** — quedan `status='active'`. Motivo: el
   `expected_cash` del turno original ya es un snapshot (D5); marcarlos
   `voided` no afecta ese snapshot y crea inconsistencia entre turnos.
4. Asiento `expense` por `v_sale.amount_paid` (= `total_amount` en contado).
5. **Refund de efectivo en el turno actual** (el que anula):
   - Calcular `v_cash_refund = SUM(amount) FROM sale_payments WHERE sale_id =
     p_sale_id AND status='active' AND payment_method ILIKE '%efectivo%' OR
     '%cash%'`.
   - Si `v_cash_refund > 0`:
     - Localizar el turno abierto de la sede (`SELECT shift_id FROM
       pos_shifts WHERE site_id = v_sale.site_id AND status='open'`). La
       unicidad está garantizada por el índice `one_open_shift_per_site`.
     - Si no hay turno abierto → `RAISE EXCEPTION` "Para anular una venta con
       cobros en efectivo debes tener un turno abierto".
     - `INSERT cash_movements (shift_id=turno_actual, type='refund',
       amount=v_cash_refund, description='Refund anulación venta #<numero>')`.
   - Si `v_cash_refund = 0` (venta contado no-cash, p. ej. tarjeta): no hay
     movimiento de caja; el `expense` en P&L cubre la contabilidad.
6. **NO** se emite `customer_credits` (fue contado, no hay saldo pendiente).

**Efecto neto en `expected_cash`:**

- **Intraturno**: `sale_payments` cash sigue sumando (+cash), `cash_movements`
  refund resta (−cash). Neto = 0. Correcto: la plata salió del cajón.
- **Cross-turno**: turno original conserva su snapshot (el cash sí entró); el
  turno que anula sufre el `refund` (−cash) que refleja la salida física de
  plata al cliente. Correcto en ambas fotos.

**Caso B — Venta a cuenta (`is_on_account = TRUE`) con `amount_paid > 0`**:

1. `sales.status='voided'`.
2. Devolver stock.
3. **`sale_payments` NO se tocan** — siguen `status='active'`. Motivo: la
   plata de los abonos **no se devuelve** al cliente, se convierte en saldo
   a favor. El cash sigue físicamente en la caja del negocio; el arqueo no
   debe bajar. Esta es la asimetría deliberada con el Caso A.
4. Asiento `expense` por `v_sale.amount_paid`.
5. `INSERT customer_credits` con `amount = v_sale.amount_paid`,
   `source_type='void_sale'`, `source_sale_id = p_sale_id` — saldo a favor
   emitido.
6. **NO** se inserta `cash_movement`.

**Caso C — Venta a cuenta con `amount_paid = 0`**:

1. `sales.status='voided'`.
2. Devolver stock.
3. Nada más — no hay plata que reversar, no hay saldo a favor.

**Invariantes que se preservan tras el void**:

- `SUM(sale_payments.amount WHERE status='active') = sales.amount_paid` sigue
  cierto en los 3 casos (Caso A: ambos lados quedan a 0 efectivamente porque
  todos los pagos van a `voided` — el invariante se lee "para ventas con
  pagos activos"; Caso B: nada cambió; Caso C: no había pagos).
- La venta anulada deja de aparecer en CxC porque las vistas filtran
  `status='active'`.
- `balance_due` sigue calculado como `total - amount_paid`; en Caso B queda
  el mismo número que antes de anular, pero es inerte porque `status` no
  matchea los reportes de CxC.

### 4.5 `get_shift_balance` — NUEVO (**resolución D10**, Fase 1)

Elimina la duplicación estructural entre `close_shift` (SQL) y
`buildBalance()` (TS). Ambos consumen este RPC.

```sql
get_shift_balance(p_shift_id UUID) RETURNS JSONB
-- {
--   shift_id, initial_cash,
--   cash_in_shift,          -- sale_payments cash del turno, status='active'
--   non_cash_in_shift,      -- sale_payments no-cash del turno, status='active'
--   cash_movements_income,  -- cash_movements type='income'
--   cash_movements_expense, -- cash_movements type='expense'
--   cash_movements_refund,  -- cash_movements type='refund'
--   expected_cash           -- initial + cash_in_shift + income - expense - refund
-- }
```

Detalles:

- `SECURITY DEFINER` + rol/sede (`admin|encargado|vendedor`;
  `encargado|vendedor` solo si el shift pertenece a su sede).
- Todo el SUM sale de `sale_payments` con `status='active'` — jamás de
  `sales.total_amount`. La clasificación cash/no-cash es por
  `payment_method ILIKE '%efectivo%' OR '%cash%'` sobre `sale_payments`.
- `close_shift` internamente llama `get_shift_balance()` y usa el
  `expected_cash` retornado (no recalcula).
- `buildBalance()` en TS **se elimina**; `getCurrentShift()` pasa a llamar
  `supabase.rpc('get_shift_balance', { p_shift_id })` y transforma el JSON
  al tipo `ShiftBalance` existente.

Beneficio: cambios futuros (D9, enum de métodos, otro filtro) se hacen en un
solo lugar. Cierra la puerta a un M12 futuro.

---

## 5. Interacción con caja

| Evento | Efecto en `expected_cash` |
|---|---|
| Venta contado en efectivo | +total |
| Venta contado tarjeta/transferencia | 0 |
| Venta a cuenta con abono inicial en efectivo | +abono |
| Venta a cuenta sin abono | 0 |
| Abono posterior en efectivo, mismo turno | +abono |
| Abono posterior en efectivo, otro turno | 0 en este; +abono en el suyo |
| Anulación de venta **contado** en efectivo, mismo turno | Neto **0** — `sale_payments` sigue sumando (+cash), `cash_movement refund` resta (−cash) |
| Anulación de venta **contado** en efectivo, otro turno | Turno original: **sin cambio** (snapshot D5); turno que anula: **−cash** vía `cash_movement refund` |
| Anulación de venta **a cuenta** con abonos cash | **0** — la plata no se devuelve, se convierte en saldo a favor; `sale_payments` no se tocan (§4.4 Caso B) |

---

## 6. Interacción con contabilidad (base caja + COGS al vender)

> **✅ APLICADO A PROD 2026-08-18**: método contable actualizado por
> decisión del contador (release triple 2C v2 + COGS + 2D, merge
> `892f647`, deploy `dpl_5FZTwJNSPUVyCrngvbTeDvpCPvkk`). `create_sale`
> ahora persiste `sale_items.unit_cost` desde `products.cost` al momento
> de la venta y emite 1 asiento agregado `expense "Costo de mercancía
> vendida"` por venta (además del income). `void_sale` reversa el COGS
> desde `sale_items.unit_cost` (no `products.cost` vivo, para reverso
> exacto). Detalle completo en
> [docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.4](INVENTORY-ADJUSTMENTS-SPEC.md).
>
> **Implicación crítica para `register_payment`**: NO genera COGS
> adicional al procesar abonos — el COGS se registró completo en
> `create_sale` al momento de la venta, independientemente de si es
> contado o crédito. Los abonos solo tocan `income` (patrón actual).
> Al implementar cambios futuros a `register_payment`, respetar esta
> regla.

- **`create_sale` contado**: 2 asientos — 1 `income` "Ventas POS" por
  `total_amount` + 1 `expense` "Costo de mercancía vendida" por
  `SUM(quantity × unit_cost)` de items no-servicio.
- **`create_sale` a cuenta con abono inicial**: 2 asientos — 1 `income`
  "Abono inicial crédito" por `p_initial_payment` + 1 `expense` COGS
  por costo total vendido (no proporcional al abono).
- **`create_sale` a cuenta sin abono**: 1 asiento — solo `expense` COGS
  por costo total. Sin income (venta reconoce al momento de cobrar).
  Consecuencia contable: en base caja pura, la venta a crédito sin
  abono aparece como pérdida periódica que se compensa cuando llegue
  el pago vía `register_payment`.
- **`register_payment`**: 1 asiento `income` por `p_amount`,
  `category='Abono crédito'`. **Nunca COGS** (ya se registró en
  `create_sale`).
- **`void_sale`**:
  - Reversa de COGS: SIEMPRE se emite `income "Reversión Costo de
    mercancía vendida"` por el monto original si `SUM(unit_cost)` > 0.
    Independiente del `amount_paid` (aplica también al Caso C).
  - Caso A (contado, `amount_paid > 0`): + 1 asiento `expense` por
    `amount_paid`.
  - Caso B (a cuenta, `amount_paid > 0`): + 1 asiento `expense` por
    `amount_paid` + 1 `customer_credits` por el mismo monto.
  - Caso C (`amount_paid = 0`): solo la reversa de COGS.
  - Ventas históricas con `unit_cost=NULL` (pre-2026-08-18): NO tienen
    reversa de COGS (no había COGS que revertir en el asiento original).
- **`apply_customer_credit`** (Fase 3, redención): **1 asiento `income`** por
  el monto aplicado + 1 `customer_credits` con `amount = -aplicado`
  (`source_type='redemption'`). El income es necesario para restablecer la
  simetría con el `expense` que se hizo al anular; sin él la P&L pierde
  visibilidad del cash real (traza en §6.1).

Se mantiene `accounting_entries.sale_id` como ancla; ahora habrá N asientos
por venta a cuenta.

### 6.1 Ciclo completo del saldo a favor — traza numérica

Escenario: venta a cuenta de **100k**, cliente hace abono inicial 20k cash y
un abono posterior 30k cash (mismo turno), luego la venta se anula. En Fase 3
el cliente vuelve y compra por **80k** (30k cash + 50k redimido de saldo a
favor).

| # | Evento | `income` | `expense` | `customer_credits` Δ | Cash real Δ |
|---|---|---:|---:|---:|---:|
| 1 | Abono inicial 20k cash | +20 | | | +20 |
| 2 | Abono posterior 30k cash | +30 | | | +30 |
| 3 | `void_sale` (Caso B) | | −50 | +50 | 0 |
| 4 | Nueva venta 80k: 30k cash | +30 | | | +30 |
| 4 | Nueva venta 80k: 50k redimido | +50 | | −50 | 0 |
| | **NETO** | **+130** | **−50** | **0** | **+80** |
| | | P&L neto = **+80** ✓ | | Saldo cliente = **0** ✓ | Cash total = **+80** ✓ |

**Comprobación de consistencia:**

- P&L neto (**+80**) = Cash real recibido en todo el ciclo (**+80**).
  Correcto: el negocio ganó 80k en valor (los 20+30 originales que quedaron
  en caja + los 30 nuevos; los 50 de mercancía de la nueva venta se pagaron
  con el crédito emitido, que a su vez venía del cash retenido de la venta
  anulada).
- Saldo del cliente en `customer_credits` termina en **0**: se emitieron 50
  al anular, se redimieron 50 al comprar de nuevo.
- **No hay doble conteo**: el income del paso 4-redimido (+50) no cuenta plata
  nueva; cuenta el cash que ya había entrado en los pasos 1–2 y que fue
  "reservado" contablemente por el expense del paso 3. Sin ese income la
  P&L neta quedaría en +30, divergiendo 50k del cash real.

**Si el cliente nunca redime** (venta 4 no ocurre): P&L neta = 0, cash real
= +50 en caja, saldo a favor pasivo = 50 en el balance del cliente. También
consistente — el negocio tiene 50k físicos que debe al cliente.

**Si void_sale se hace sobre venta con `amount_paid = 0`** (Caso C): ningún
asiento, ningún crédito emitido, nada que redimir. Trivialmente consistente.

---

## 7. RLS

- **`sale_payments`**: RLS habilitada.
  - `SELECT`: mismo patrón de `sales` (usuarios de la sede + admin/contador
    globales).
  - `INSERT/UPDATE/DELETE`: **cerrada a `authenticated`** (sin policy
    permisiva `WITH CHECK (true)`). Escritura solo vía `SECURITY DEFINER` de
    `create_sale` / `register_payment` / `void_sale`.
- **`customer_credits`**: RLS habilitada.
  - `SELECT`: sede + admin/contador globales.
  - `INSERT/UPDATE/DELETE`: cerrada. Escritura solo desde `void_sale` (Fase 1)
    y `apply_customer_credit` (Fase 3).
- **`sales`**: RLS existente sirve; nuevos campos no cambian quién ve qué.
- **`customers`**: `allows_credit` no afecta RLS (todos los usuarios que ya
  ven el cliente ven el flag).

---

## 8. Fases

### Fase 1 — Core riesgoso (una migración, una transacción)

**Objetivo**: se puede fiar y el arqueo cuadra.

Contenido:

1. `ALTER sales` (§3.1).
2. `CREATE sale_payments` + índices + RLS (§3.2, §7).
3. `ALTER customers ADD allows_credit, is_walk_in` + índice único + CHECK +
   marcar walk-in por nombre (**una vez, en el UPDATE de la migración**) +
   `RAISE EXCEPTION` si no queda exactamente 1 walk-in con
   `allows_credit=false` (§3.3, cierra D12).
4. `CREATE customer_credits` + índices + RLS (§3.4, §7).
5. **Backfill obligatorio** (**resolución D6**): por cada `sales` histórica
   `status='active'`:
   - `UPDATE sales SET amount_paid = total_amount`.
   - `INSERT INTO sale_payments (sale_id, amount, payment_method, shift_id,
     site_id, received_by, notes, created_at)` con `amount=total_amount`,
     `payment_method=sales.payment_method`, `shift_id=sales.shift_id`,
     `site_id=sales.site_id`, `received_by=sales.seller`,
     `notes='Backfill Fase 1 fiado'`, `created_at=sales.sale_date`.
   - Ventas `status='voided'`: `amount_paid=0`, no se insertan
     `sale_payments` (consistente con el modelo nuevo — no hubo cobro
     retenido bajo el modelo pre-fiado).
6. `CREATE OR REPLACE` de `create_sale` → SECDEF + rol/sede + params a cuenta
   + ignora `p_user_id` (usa `auth.uid()`) (§4.1, D11).
7. `CREATE OR REPLACE` de `close_shift` → llama `get_shift_balance` (§4.3,
   §4.5). Resuelve M12.
8. `CREATE OR REPLACE` de `void_sale` → SECDEF + rol/sede + regla asimétrica
   contado/fiado + emitir `customer_credits` en Caso B (§4.4).
9. **NUEVO RPC** `get_shift_balance` (§4.5, cierra D10).
10. Reemplazo de `buildBalance()` en
    [lib/shift-actions.ts](../lib/shift-actions.ts) por llamada al RPC nuevo.
11. Ajuste de [app/pos/page.tsx:220](../app/pos/page.tsx) para hallar walk-in
    vía `is_walk_in=true` en vez de match por nombre.
12. Ajuste del seed [scripts/04_seed.sql](../scripts/04_seed.sql) para el
    walk-in con `is_walk_in=true, allows_credit=false`.
13. `verify_credit_integrity()` (análogo a `verify_kardex_integrity()`):
    - assert `SUM(sale_payments.amount WHERE status='active') =
      sales.amount_paid` para toda `sales.status='active'`.
    - assert `sales.balance_due >= 0`.
    - retorna filas donde el invariante no se cumple.

**Validación local antes de aplicar a prod:**

- La migración se corre contra una base **limpia** (branch de Supabase o DB
  local), sobre el snapshot del esquema+seed del repo.
- Post-migración se ejecuta `verify_credit_integrity()` y
  `verify_kardex_integrity()`; ambas deben retornar 0 filas.
- Se corre la suite E2E completa.
- Se envía el SQL final aquí para OK antes de aplicar a prod.

E2E de Fase 1:

- `credit-sale-shift.spec.ts`: venta a cuenta con abono inicial cash →
  `expected_cash` refleja solo el abono.
- `shift-void-parity.spec.ts` (heredado de M12): venta contado cash +
  anulación intraturno → `difference = 0`.
- `void-emits-credit.spec.ts`: crear crédito con abono, anular, verificar
  fila en `customer_credits` y que `expected_cash` **no** baja (Caso B).
- `payment-method-label-not-classifier.spec.ts` (D8): crear venta contado
  con `payment_method='Crédito Visa'` → verificar que
  `get_shift_balance().cash_in_shift` NO la incluye como cash (porque
  clasifica por el método real, no por texto ambiguo, y `is_on_account=false`
  con método distinto de efectivo/cash → no-cash).
- `walk-in-cannot-be-on-account.spec.ts` (D2/D12): intentar `create_sale
  is_on_account=true` con `customer_id` del walk-in → `RAISE EXCEPTION`.
- `close-shift-vs-buildBalance-parity.spec.ts` (D10): sobre el mismo turno
  con datos mixtos, verificar que el JSON del RPC `get_shift_balance` y el
  `expected_cash` guardado por `close_shift` producen el mismo número.

### Fase 2 — Abonos + UI + CxC

> **Nota de nomenclatura (2026-08-16)**: Fase 2 se partió en dos bloques
> por scope de deploy:
>
> - **Fase 2A "mínimo fiar POS" — YA DEPLOYED** (commit `344bbd2`):
>   solo habilitación del botón "Fiar (crédito)" en el diálogo del POS.
>   Consume `create_sale` v2 (que ya acepta `p_is_on_account` +
>   `p_initial_payment` desde Fase 1). Cierra deuda D10: `buildBalance()`
>   TS reemplazada por llamada al RPC `get_shift_balance`. Fix crítico:
>   `total_sales` pasa a ser "recibido" (no facturado) para no inflar el
>   arqueo con saldo no cobrado de fiados.
> - **Fase 2B — PENDIENTE** (este bloque, próxima sesión): todo lo de
>   abajo. Coloquialmente lo llamamos "Fase 3" en las conversaciones
>   recientes pero técnicamente es la Fase 2 completa según este spec.
>   Precondición nueva: endurecer `create_sale` v2 con validación
>   `p_shift_id NOT NULL` cuando abono cash (mismo patrón D9); hoy vive
>   solo cliente-side.

- RPC `register_payment` (§4.2) + Server Action wrapper.
- UI abono en `/pos` (dialog "Registrar abono" desde una venta a cuenta del
  turno actual) y en `/customers/[id]` (historial de ventas + botón abono).
- **UX creación inline de cliente al fiar** (§8.1) — hoy solo hay tooltip
  informativo en el dialog; falta CTA "Crear cliente nuevo →" que abra el
  `NewContactDialog` existente (ya nace con `allows_credit=true`).
- Página `/receivables` (CxC): ventas con `is_on_account AND balance_due > 0`,
  agrupadas por cliente, con edad de saldo. Columnas: Total facturado /
  Total abonado / Por cobrar. Botón "Registrar abono" por fila.
- Deuda menor a cerrar en el mismo bloque: migrar walk-in detection en
  `app/pos/page.tsx:240-241` de match por nombre a `is_walk_in=true`
  (spec Fase 1 §8.11 pendiente).
- E2E: abono parcial → abono final → `balance_due = 0`; N asientos en
  contabilidad; UI muestra Total / Cobrado / Por cobrar por venta.

#### 8.1 UX de creación inline de cliente (crítico)

Si el cajero elige "fiar" y el cliente actualmente seleccionado no cumple
(walk-in, `allows_credit=false`, o no hay cliente), el flujo **NO** debe ser
un dead-end. Debe:

1. Ofrecer inline el mismo `NewContactDialog`
   ([components/pos/new-contact-dialog.tsx](../components/pos/new-contact-dialog.tsx))
   ya usado para alta de cliente, con **celular obligatorio** (la validación
   `phoneCORequired` de la feature anterior).
2. El cliente creado nace con `allows_credit = true` (default de la columna).
3. Al guardar, `onCreated(customer)` lo selecciona automáticamente en la
   venta en curso — ya existe ese hook.
4. La venta continúa sin perder el carrito.

Copy sugerido cuando el cliente actual no aplica: *"Para fiar necesitas un
cliente identificado. Crear cliente nuevo →"* con el botón que abre el
dialog. No mostrar el mensaje si ya hay un cliente apto.

### Fase 3 — Redención de saldo a favor

**Precondición bloqueante (D14):** `apply_customer_credit` **debe** asentar
`income` por el monto aplicado, aunque no entre plata nueva. Sin ese asiento
la P&L queda 1:1 debajo del cash real total del ciclo (traza en §6.1). No es
una "nota", es un requisito de corrección contable — sin esto la Fase 3 no
puede considerarse cerrada.

- Extender `customer_credits`: entradas negativas (`amount < 0`,
  `source_type='redemption'`).
- RPC `apply_customer_credit(p_sale_id, p_credit_amount)` que:
  - Chequea saldo disponible del cliente
    (`SUM(customer_credits.amount) >= p_credit_amount`).
  - Inserta `sale_payments` con `payment_method='credito_favor'` por el
    monto (mismo shift_id de la venta destino, o el turno abierto de la sede
    si es abono posterior).
  - Inserta `customer_credits` con `amount = -p_credit_amount`,
    `source_type='redemption'`.
  - Actualiza `sales.amount_paid`.
  - **Asienta `income` por el monto aplicado** (`category='Redención saldo a
    favor'`) — bloqueante D14.
- UI: al cobrar una venta, si el cliente tiene saldo a favor, sugerirlo
  primero.

---

## 9. Resolución de decisiones abiertas + conflictos nuevos

### Resueltas (del spec anterior)

| # | Resolución |
|---|---|
| **D1** | `create_sale` pasa a `SECURITY DEFINER` con rol/sede interno (§4.1). |
| **D2** | Se agrega `customers.allows_credit BOOLEAN DEFAULT TRUE`; walk-in queda `FALSE` (§3.3). |
| **D3** | Rename `is_credit` → `is_on_account` en todo el spec/código para evitar colisión con `classifyMethod()` que ya usa `"credit"` para tarjeta. |
| **D4** | `customer_credits` se adelanta a Fase 1 (solo emisión desde `void_sale`); la redención queda en Fase 3 (§3.4, §4.4, §8). |
| **D5** | Aceptado: anulación en turno distinto al del abono deja el `expense` en la fecha de anulación (base caja) y el saldo a favor queda registrado; el turno original ya cerrado no se recalcula. |
| **D6** | Backfill de `sale_payments` histórico es parte obligatoria de la migración de Fase 1 (§8 punto 5). |
| **D7** | `payment_method` sigue siendo texto libre con match ILIKE — fuera de alcance de este spec (candidato a enum en otra iteración). |
| **D8** | Para ventas a cuenta, `sales.payment_method='crédito'` **solo como etiqueta de display**. Ningún cálculo de caja / contabilidad / reporte puede leer `payment_method` para decidir "es venta a cuenta"; el único origen es `sales.is_on_account`. Enforcement por comentario en el RPC + E2E `payment-method-label-not-classifier.spec.ts` (§8). |
| **D9** | Rechazo en Fase 1: `register_payment` (y cualquier RPC futuro que inserte `sale_payments`) `RAISE EXCEPTION` si `payment_method` es cash y `shift_id` es NULL. Cierra la puerta a abonos cash que se escapen del arqueo desde el día 1 (§4.2). |
| **D10** | Se unifica **en Fase 1**: nuevo RPC `get_shift_balance` (§4.5) es única fuente de verdad; `close_shift` y `buildBalance()` (que se elimina) lo consumen. E2E de paridad obligatorio (`close-shift-vs-buildBalance-parity.spec.ts`). |
| **D11** | **Regla general**: toda RPC `SECURITY DEFINER` deriva la identidad de `auth.uid()`, nunca de un parámetro del cliente. Aplica a `create_sale` (`p_user_id` en firma solo por compat, se ignora), `register_payment` (`received_by` derivado de `auth.uid()` — se removió el parámetro), y a todo RPC futuro. `stock_movements.user_id` pasa a ser `auth.uid()` desde `create_sale`. |
| **D12** | Se resuelve con marcador determinístico: `customers.is_walk_in BOOLEAN` + índice único parcial + CHECK que impide `is_walk_in AND allows_credit`. La migración: (a) hace el `UPDATE ... WHERE name='Consumidor final'` una única vez para bootstrappear el flag, (b) aborta con `RAISE EXCEPTION` si no queda exactamente 1 walk-in con `allows_credit=false`. El POS (§8 paso 11) y el seed pasan a usar `is_walk_in`; el match por nombre desaparece del runtime (§3.3). |

### Conflictos nuevos detectados al aplicar las resoluciones

**D13 — Asimetría contable void_sale contado vs a cuenta.**
La regla de §4.4 hace que la anulación de contado en efectivo baje el
`expected_cash` (vía `sale_payments status='voided'`), mientras que anular
una venta a cuenta con abonos cash **no** lo baja (los `sale_payments` siguen
`active`). Es coherente con la realidad física — en contado la plata se
devuelve al cliente, en a cuenta se retiene como saldo a favor — pero exige
que la UI de void_sale sea muy explícita sobre esa asimetría al usuario:
"esta venta a cuenta tenía abonos por $X; se emitirán como saldo a favor
del cliente" (no "se devolverán $X al cliente"). Fuera de alcance de la
migración pero debe ser parte de la UI de anulación en Fase 2/3.

**D14 — Redención debe generar income (Fase 3).** **PRECONDICIÓN BLOQUEANTE**
de Fase 3, no una nota. `apply_customer_credit` debe asentar `income` por el
monto aplicado; sin eso la P&L queda debajo del cash real (traza §6.1). El
RPC de Fase 3 no se acepta si omite este asiento. Documentado en §8 Fase 3
como bloqueante.

---

## 10. Fuera de alcance

- Notificaciones/recordatorios de saldo vencido.
- Intereses de mora.
- Límite de crédito por cliente (descartado — §1).
- Pagos parciales al catálogo web (`web_orders`) — flujo separado con Wompi.
