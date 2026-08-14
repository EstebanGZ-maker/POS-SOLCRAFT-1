# CLAUDE.md — Módulo POS (`app/pos/`)

> Contexto SOLO para el módulo de punto de venta y turnos de caja. No repite
> los principios rectores del `CLAUDE.md` raíz — ese ya está cargado.

## Qué hace este módulo

Grid de productos con stock de la bodega de la sede activa, favoritos, filtro
por categorías, búsqueda, carrito con edición de línea, cliente rápido
("Nuevo contacto"), diálogo de pago, turnos de caja (abrir/cerrar/movimientos).

## Reglas de negocio

- **Venta** (`createSale` en `lib/actions.ts`): inserta `sales` + `sale_items`
  vía RPC `create_sale` (transacción atómica: venta + stock + asiento
  contable). Descuenta stock vía `adjust_warehouse_stock` (valida stock ≥ 0,
  error en español si falta). Escribe kardex, asigna `numero` secuencial vía
  `site_counters`, registra ingreso en `accounting_entries` ("Ventas POS").
  `sales.status` = `active` | `voided`. Anulación vía RPC `void_sale`.
- **Turnos de caja** (`lib/shift-actions.ts`): un turno abierto por sede.
  Efectivo esperado = base inicial + ventas en efectivo + ingresos manuales
  − egresos − reembolsos (`cash_movements`). Al cerrar: contado, esperado y
  diferencia.
- Servicios (`is_service`) no manejan stock.
- Cliente por defecto: "Walk-in Customer" → pendiente renombrar a
  "Consumidor final" (paridad Alegra).

## Pendientes de este módulo (paridad Alegra)

Pestañas de venta en paralelo, ventas suspendidas, lista de precio
seleccionable en el cobro, recibo imprimible, descuentos por línea y
globales, pagos mixtos, numeraciones de factura.

Ya replicado: favoritos, filtro por categorías, badges de stock, cliente
rápido, diálogo de cobro con métodos de pago, turnos de caja.
