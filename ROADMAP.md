# ROADMAP.md — Deudas técnicas y hoja de ruta (cargar solo al planear features)

## Deudas técnicas conocidas (priorizar)

1. ~~`createSale` no atómico~~ **Resuelto (16/07/2026)** vía RPC `create_sale`.
2. **Promociones no se aplican en el POS** (solo CRUD).
3. ~~RLS permisiva~~ **Parcial (Fase 1)**: roles en `user_profiles`, guards en
   `role-guard.ts`, RLS de `user_profiles` lista. RLS granular por rol para
   las demás tablas: pendiente.
4. **Duplicación products/actions**: `app/products/page.tsx` +
   `lib/actions.ts` coexisten con `app/inventory/products` +
   `lib/inventory-actions.ts`; `products.stock_quantity` global coexiste con
   `product_stock` por bodega. Consolidar.
5. `createAdjustment` y `createBulkTransfer` siguen siendo mutaciones
   multi-paso no atómicas; migrar a RPCs como se hizo con la venta.
6. ~~Sin numeración consecutiva~~ **Resuelto (Fase 1)** vía `site_counters`.
   Recibo imprimible: pendiente (Fase 3).
7. Traslados sin estados (pendiente/en tránsito/recibido con faltantes):
   pendiente Fase 2.
8. Sin facturación electrónica DIAN (reservar campos al diseñarla).

## Hoja de ruta (paridad Alegra POS)

Mejorar módulo a módulo sin perder funcionalidad, comparando contra Alegra:
Productos, Códigos de barras, POS (pestañas en paralelo, ventas suspendidas,
recibo imprimible, descuentos, pagos mixtos), Caja, Inventario, Facturación,
Clientes, Promociones (aplicarlas en POS), Cambios y Devoluciones, Compras,
Reportes, Usuarios y Permisos, Múltiples Sucursales.

Ya replicado: favoritos, filtro por categorías, badges de stock, cliente
rápido, diálogo de cobro, turnos de caja.
