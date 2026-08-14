# Fase 2D — Unificar caminos de entrada de mercancía (D8)

**No hay SQL en esta sub-fase** — todos los cambios viven en TypeScript
(Server Actions). Se lista aquí para trazabilidad como si fuese una
migración más.

## Estado previo a 2D (3 caminos divergentes)

| Camino | Ubicación actual | Kardex | Contabilidad |
|---|---|:---:|:---:|
| `receiveMerchandise({warehouse_id, notes, items})` | [lib/inventory-actions.ts:912](../lib/inventory-actions.ts) | `adjust_warehouse_stock` con `movement_type='ajuste'` (vía `createAdjustment`) | **Ninguna** (Fase 1 heredada) |
| `ingressNewProduct(...)` | [lib/inventory-actions.ts:1262](../lib/inventory-actions.ts) | `adjust_warehouse_stock` con `movement_type='compra'` | `expense` "Compra de mercancía" (INSERT directo a `accounting_entries`) |
| `createAdjustment({warehouse_id, notes, items})` con items incrementar | [lib/inventory-actions.ts:372](../lib/inventory-actions.ts) | `adjust_warehouse_stock` con `movement_type='ajuste'` | **Ninguna** hoy; Fase 2C genera según `motivo` |

Discrepancias:
1. `ingressNewProduct` asienta expense; los otros dos no.
2. `ingressNewProduct` marca kardex como `'compra'`; los otros como
   `'ajuste'`.
3. `receiveMerchandise` no acepta `motivo` — semánticamente siempre es
   compra pero no lo declara.

## Estado tras 2D (1 camino canónico)

**Toda entrada de mercancía va por `create_adjustment` con `motivo='compra'`**.

### Cambios en `lib/inventory-actions.ts`

**`receiveMerchandise`**: pasa a inyectar `motivo='compra'` en la llamada a
`createAdjustment`. Sin cambio de firma pública:

```ts
export async function receiveMerchandise(input: {
  warehouse_id: string
  notes?: string | null
  items: { product_id: string; cost: number; quantity: number }[]
}) {
  return createAdjustment({
    warehouse_id: input.warehouse_id,
    notes: input.notes ? `[Entrada] ${input.notes}` : "[Entrada de mercancía]",
    motivo: "compra",  // NUEVO — antes no se pasaba
    items: input.items.map((it) => ({ ...it, objective: "incrementar" as const })),
  })
}
```

**`createAdjustment`** (Server Action wrapper del RPC): agrega `motivo` al
input y lo pasa a `supabase.rpc('create_adjustment', {..., p_motivo})`.

**`ingressNewProduct`**: elimina el bloque de `INSERT accounting_entries`
propio y el `adjust_warehouse_stock` directo. Tras crear el producto,
llama a `createAdjustment` con un solo item incrementar y
`motivo='compra'`:

```ts
// (después de crear el producto + precio)
if (qty > 0) {
  const res = await createAdjustment({
    warehouse_id,
    notes: `Ingreso inicial ${code} x${qty}`,
    motivo: "compra",
    items: [{
      product_id: product.product_id,
      cost: input.cost ?? 0,
      objective: "incrementar" as const,
      quantity: qty,
    }],
  })
  if (!res.success) return res
}
```

Al pasar por `create_adjustment`:
- Kardex: `movement_type='ajuste'` (no más `'compra'`).
- Contabilidad: `expense` "Compra de mercancía" con `adjustment_id`
  (trazabilidad D4).
- WAC: recalculado si aplica.
- Numeración: recibe su `numero`.

### Comportamiento contable canónico post-2D

**Todo ingreso de mercancía a bodega** (nuevo producto vía
`ingressNewProduct`, entrada a producto existente vía `receiveMerchandise`,
o ajuste manual con `motivo='compra'` desde el UI) produce:
- 1 fila en `inventory_adjustments` con `motivo='compra'`, `numero`,
  `status='active'`.
- N filas en `adjustment_items` (una por producto).
- N filas en `stock_movements` con `movement_type='ajuste'`,
  `reference_type='adjustment'`.
- Recálculo de `products.cost` por WAC.
- 1 fila en `accounting_entries` con `entry_type='expense'`,
  `category='Compra de mercancía'`, `amount=SUM(cost*qty)`,
  `adjustment_id`.

### Análisis DN2 — desaparición de `movement_type='compra'`

**Resultado del grep** (`movement_type.*compra` / `'compra'` en
`**/*.{ts,tsx,mjs,js,sql}`), separado por rol:

**Escritores runtime de `movement_type='compra'`** — solo 1:
- [lib/inventory-actions.ts:1349](../lib/inventory-actions.ts) —
  `ingressNewProduct` pasa `p_movement_type: "compra"` a
  `adjust_warehouse_stock`. **Se elimina al migrar a `create_adjustment`
  en 2D**. Después de 2D, ningún camino de la app escribe `'compra'` en
  `stock_movements`. La CHECK constraint del enum
  (`scripts/05_merge_features.sql:85`) mantiene `'compra'` como valor
  válido — no la quitamos, así que los históricos siguen consultables y
  cualquier RPC futuro que escriba directo tampoco falla.

**Lectores/consumidores que distinguen `'compra'`** — auditoría por
superficie:

| Superficie | Uso | ¿Se rompe / engaña post-2D? |
|---|---|---|
| [app/inventory/kardex/page.tsx:25](../app/inventory/kardex/page.tsx) `TYPE_LABELS.compra = "Compra"` | Label del badge del tipo en la fila del kardex | No se rompe. Los históricos con `movement_type='compra'` siguen renderizándose con el label "Compra". Los NUEVOS ingresos aparecerán con label "Ajuste". |
| [app/inventory/kardex/page.tsx:37](../app/inventory/kardex/page.tsx) `TYPE_COLORS.compra = "bg-blue-..."` | Color del badge | No se rompe (mismo caso). |
| [app/inventory/kardex/page.tsx:186-196](../app/inventory/kardex/page.tsx) Selector de tipo (`Object.entries(TYPE_LABELS)`) | Filtro dropdown "Compra" en la UI de kardex | ⚠ **Se vuelve engañoso**: filtrar "Compra" muestra SOLO los históricos (pre-2D). Los ingresos nuevos aparecen bajo el filtro "Ajuste". |
| `lib/kardex-actions.ts:82-83` — filtro genérico por `movement_type` | Infraestructura; no hardcodea `'compra'` | No se rompe. |
| `getCentralPurchases()` — [lib/inventory-actions.ts:1416](../lib/inventory-actions.ts) | Reporte de "entradas a bodega central" | **No se rompe**: filtra por `inventory_adjustments.notes ILIKE '%[Entrada]%'` (que `receiveMerchandise` sigue prefijando), no por `movement_type`. |
| Dashboard, analytics, otros reportes | grep exhaustivo | **Ninguno filtra por `movement_type='compra'`**. |

**Distinción compra-vs-ajuste post-2D — cómo recuperarla**:

La info NO se pierde; migra de `stock_movements.movement_type` a
`inventory_adjustments.motivo`. Query equivalente para "movements de
compra":

```sql
SELECT sm.*
  FROM stock_movements sm
  JOIN inventory_adjustments a ON a.adjustment_id = sm.reference_id
 WHERE sm.reference_type = 'adjustment'
   AND sm.movement_type = 'ajuste'
   AND a.motivo = 'compra';
```

Costo: 1 join adicional para reportes que segmenten por motivo.
Aceptable — solo lo pagan analytics/reports, no la lectura común del
kardex (que sigue rindiendo el kardex completo sin filtro).

**Granularidad que se pierde en `stock_movements` (documentado
explícitamente)**:

Antes de 2D, el `movement_type` del kardex distinguía directamente:
- `'compra'` = ingreso por compra a proveedor (vía `ingressNewProduct`).
- `'ajuste'` = corrección/sobrante/merma (vía `createAdjustment`).

Después de 2D, **compra y ajuste se vuelven indistinguibles dentro de
`stock_movements`**: ambos son `movement_type='ajuste'` con
`reference_type='adjustment'`. El motivo real vive en
`inventory_adjustments.motivo`; requiere join para separarlos.

**Confirmación de aceptabilidad**: sí, aceptable, por 3 razones:
1. **La info no se pierde**, solo cambia de tabla (motivo vs
   movement_type). La distinción es recuperable con 1 join sobre una FK
   ya indexada (`stock_movements.reference_id` + índice existente
   `idx_movements_reference`).
2. **Ningún consumidor runtime hoy depende** de la distinción a nivel
   kardex plano (grep exhaustivo confirma: `getCentralPurchases` va por
   `notes`, dashboards no la usan, `kardex-actions` es genérico).
3. **Ganancia de consistencia**: un solo `movement_type` para todos los
   ajustes convierte el kardex en un ledger simple ("esto se movió por
   adjustment #X — mira #X para saber por qué"). El motivo separa
   semánticamente en la tabla que lo puede explicar completo
   (cost, notes, motivo, created_by, numero), no en un enum plano.

**Costo residual — filtro "Compra" en `/inventory/kardex`**:

El único punto de fricción UX es que la opción "Compra" del selector de
tipo del kardex mostrará SOLO ingresos pre-2D después del deploy. No es
un bug funcional, pero puede confundir a un usuario que espere ver ahí
sus compras recientes. **No se corrige en 2D**. Se maneja en Fase 3
(UI de detalle del ajuste): al abrir un movimiento de kardex con
`reference_type='adjustment'`, la UI navega al detalle del ajuste, donde
el motivo (`compra`/`sobrante`/`correccion`) se muestra explícito. El
usuario ve la naturaleza real de la entrada allí, no necesita filtrar
por ella en el kardex.

Alternativa opcional para Fase 3 (fuera de alcance de 2D): en
`TYPE_LABELS`, cambiar la etiqueta "Compra" a "Compra (histórico)" o
esconder la opción del selector si no queremos mostrarla. Decisión de UX
para cuando exista la vista de detalle. **No es blocker de 2D.**

### Fuera de alcance (mencionado en spec §11 como candidato futuro)

Mapear `motivo='compra'` a `movement_type='compra'` en el RPC en lugar
de `'ajuste'`. Recuperaría la separación de reportes de kardex, sin
tocar TypeScript. Solo si el contador lo pide.

## Orden de deploy (2D vs 2C)

2D **depende** de que la firma nueva de `create_adjustment` con `p_motivo`
esté aplicada (esa es 2C). Por lo tanto:

- Aplicar SQL: 2A → 2B → 2C (gate contador) → nada más SQL en 2D.
- Aplicar TS: los cambios de 2D (`receiveMerchandise`, `ingressNewProduct`,
  `createAdjustment` wrapper) deben ir en el mismo PR que 2C, para que
  el UI y los backend calls no queden en un estado intermedio inválido
  (RPC pidiendo motivo, callers sin pasarlo).

**Consecuencia**: 2C y 2D forman un solo release en la práctica, aunque
son sub-fases separadas en el diseño.
