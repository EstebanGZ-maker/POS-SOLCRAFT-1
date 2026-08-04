# CLAUDE.md — Módulo Inventario (`app/inventory/`)

> Contexto SOLO para productos, stock, bodegas, listas de precio, promociones,
> ajustes y kardex. No repite los principios rectores del `CLAUDE.md` raíz.

## Rutas de este módulo

| Ruta | Qué hace |
|---|---|
| `/inventory/products` | Productos y servicios (form completo: foto, código, impuestos) |
| `/inventory/barcodes` | Códigos de barras / etiquetas (jsbarcode) |
| `/inventory/value` | Valor de inventario (cantidad × costo por bodega) |
| `/inventory/adjustments` | Ajustes de inventario (incrementar/disminuir, con reversión al borrar) |
| `/inventory/warehouses` | Bodegas por sede |
| `/inventory/price-lists` | Listas de precios (default + adicionales, precio por producto) |
| `/inventory/promotions` | Promociones (% descuento, vigencia, por sede) — CRUD listo, **aún no se aplican en el POS** |
| `/inventory/management` | Categorías y gestión general |
| `/inventory/kardex` | Kardex de inventario (movimientos por producto/bodega/fecha) |

## Reglas de negocio

- **Stock por bodega**: `product_stock` (producto × bodega). Es un caché
  derivado — la fuente de verdad es `stock_movements` (ver principios
  rectores en el `CLAUDE.md` raíz). Los servicios (`is_service`) no manejan
  stock.
- **Kardex**: `stock_movements` es append-only, registra todo cambio de
  stock con tipo, referencia y usuario. Bodega virtual "Tránsito"
  (`is_system=true`) para mercancía en movimiento. Verificación de
  integridad: `SELECT * FROM verify_kardex_integrity()`.
- **Ajustes**: `receiveMerchandise` reutiliza los ajustes como entradas
  (`[Entrada]` en notas); borrar un ajuste revierte el stock.
- Productos con ventas no se eliminan: se desactivan (`deleteProductSafe`).

## Deuda técnica específica de este módulo

**Duplicación products/actions**: `app/products/page.tsx` + acciones viejas
de producto en `lib/actions.ts` coexisten con `app/inventory/products` +
`lib/inventory-actions.ts`; `products.stock_quantity` global coexiste con
`product_stock` por bodega. Consolidar (ver `ROADMAP.md` para prioridad).

`createAdjustment` sigue haciendo mutaciones multi-paso desde el server
action (no atómica); migrar a RPC como se hizo con `create_sale`.
