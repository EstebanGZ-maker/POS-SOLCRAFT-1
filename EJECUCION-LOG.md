# Log de ejecución — testing/correcciones/optimización

> Cambios aplicados a la DB de producción (`nxszaxwsrtlofqimbfig`) el 31/07–01/08/2026.
> Todos versionados en `scripts/`. `verify_kardex_integrity()` = 0 antes y después de cada paso.

## Rendimiento (queries)

| Migración | Qué hizo | Verificación |
|---|---|---|
| `08_perf_fk_indexes.sql` | 24 índices de cobertura en foreign keys (stock_movements, sales, transfer_items, pos_shifts, accounting_entries, …) | Advisor `unindexed_foreign_keys`: **24 → 0** |
| `11_...` (P2/P3) | RLS de lectura envuelta en `(select auth.<fn>())` + políticas ALL separadas en INSERT/UPDATE/DELETE en `user_profiles`, `user_sites`, `customer_accounts` | 1 sola política SELECT por tabla; sin re-evaluación por fila |

## Seguridad

| Migración | Qué hizo | Verificación |
|---|---|---|
| `09_security_revoke_anon_sensitive_fns.sql` | Revocó EXECUTE de `anon`/PUBLIC en `admin_create_user`, `admin_reset_password`, `fulfill_web_order`, `update_online_order_status`, `handle_new_user`. Se conserva `authenticated` (la app las llama con sesión; validan rol internamente) | anon ya no alcanza las funciones vía `/rest/v1/rpc` |
| `10_security_fix_function_search_path.sql` | `search_path` fijo en todas las funciones que no lo tenían | Advisor `Function Search Path Mutable`: **34 → 0** |

## Bug corregido (Módulo A)

| Migración | Bug | Fix |
|---|---|---|
| `12_fix_low_stock_use_product_stock.sql` | `get_low_stock_products` leía `products.stock_quantity` (columna legacy congelada en 0), no `product_stock` (fuente real). Devolvía bajo stock falso | Reescrita para agregar stock real por bodega de venta. Ahora devuelve 23/29/29 correctamente |

## Pruebas empíricas del núcleo de venta (no destructivas, auto-rollback)

Ejecutadas directo contra `create_sale` sobre datos reales, revertidas al terminar:

- **Bloqueo de sobreventa:** pedir 21 de 20 disponibles → `Stock insuficiente: disponible 20, solicitado 21`. ✅
- **Venta atómica + kardex:** vender 2 → stock 20→18, exactamente **1** movimiento `venta` de −2, luego rollback. ✅
- **Concurrencia:** el `UPDATE product_stock ... WHERE quantity + delta >= 0` de `adjust_warehouse_stock` toma lock de fila; dos ventas simultáneas de la última unidad → la segunda espera y falla limpio. ✅ (revisión de código)

## Deuda/minas detectadas (pendientes, requieren cambio de write-path con tests)

1. `products.stock_quantity` es una columna legacy desincronizada del kardex. Alimenta solo código muerto (`getDashboardStats`, componente `DashboardStats`, y el fallback `decrement_product_stock` de `create_sale` cuando `warehouse_id` es NULL). Recomendado: eliminar el fallback y la columna tras cubrir con tests.
2. **S1 — RLS de escritura "always true"** en tablas de dinero/inventario (`sales`, `sale_items`, `stock_movements`, `transfers`, `pos_shifts`, …): sigue pendiente. Se abordará con la suite E2E montada primero (decisión acordada).
3. `getSales()`/`getSaleDetails()` usan `select('*')` con joins anidados y sin paginación → optimización de Módulo A/B.

## Pendiente (requiere app local corriendo)

- Scaffolding Playwright + baseline `measure-perf.mjs`.
- Suite E2E de venta/stock → y recién entonces aplicar S1 (RLS escritura) con rollback.
