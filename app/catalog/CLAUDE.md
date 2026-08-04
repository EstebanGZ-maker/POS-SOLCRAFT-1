# CLAUDE.md — Módulo Catálogo / Tienda pública (`app/catalog/`)

> Contexto SOLO para la tienda web pública (landing, catálogo, carrito,
> checkout, pedidos). No repite los principios rectores del `CLAUDE.md` raíz.
> **Distinto de todo lo demás**: esto no es panel interno del POS, es la
> tienda que ve el cliente final en internet.

## Qué es este módulo

Storefront público de SOLCRAFT: landing con hero 3D, catálogo navegable,
carrito, checkout con pago en línea (Wompi) o coordinado (WhatsApp / contra
entrega), y páginas de confirmación/seguimiento de pedido.

Tema visual aislado del resto del POS vía clase `.catalog-theme` (paleta
gold/black) — no reutiliza el theming del panel interno.

## Rutas

| Ruta | Qué hace |
|---|---|
| `/catalog` | Landing: hero 3D (`HeroPremium`, ver `components/catalog/hero-3d/`), destacados, líneas de producto, sedes, banda de envío |
| `/catalog/productos` | Grid del catálogo completo (`CatalogGrid`), con filtros/facets |
| `/catalog/[code]` | Ficha de producto: galería, tallas (variantes por código), disponibilidad por sede, WhatsApp |
| `/catalog/cart` | Carrito (estado vía `useCart` / `CartProvider`, client-side) |
| `/catalog/checkout` | Checkout: datos de contacto, dirección, selección de método de pago |
| `/catalog/order/[order_number]` | Confirmación y seguimiento de pedido (requiere teléfono para consultar) |
| `/catalog/payment/return` (o similar) | Retorno del checkout de Wompi, verifica y aplica la transacción |

## Server Actions / lógica de negocio

- **`lib/catalog-actions.ts`**: `getPublicCommerceConfig`, `getCatalogFacets`,
  `getPublicSites`, `listPublicCatalog`, `getPublicProduct`,
  `getProductSizes`, `placeWebOrder`, `lookupWebOrder`.
- **`lib/wompi-actions.ts`**: `createWompiCheckout`, `verifyAndApplyTransaction`
  — integración de pagos con Wompi (tarjeta, PSE, Nequi).
- **`lib/cart-context.tsx`**: estado del carrito en cliente (`useCart`,
  `CartProvider`), no persiste en servidor hasta el checkout.

## Reglas de negocio observadas

- **Caché**: la mayoría de páginas usan `revalidate = 60` — el catálogo y
  stock se sirven desde caché y se revalidan cada minuto, no en cada
  request.
- **Variantes de producto**: cada talla es un código distinto (`getProductSizes`
  agrupa por diseño y navega entre códigos-talla).
- **Disponibilidad**: un producto es "disponible" si `available_sites.length > 0`;
  se muestra explícitamente en qué sedes hay stock.
- **Métodos de pago**: `wompi` (en línea), `whatsapp` (coordinado manual),
  `cod` (contra entrega) — habilitados/deshabilitados vía
  `getPublicCommerceConfig` (`wompi_enabled`, `whatsapp_enabled`, `cod_enabled`).
- **Envío gratis**: umbral configurable (`free_shipping_over`); si el
  subtotal lo supera, `shipping_cost` se ignora.
- **Estados de pedido**: `pending_payment`, `paid`, `preparing`, `shipped`,
  `delivered`, `cancelled`.
- **Seguimiento sin login**: `lookupWebOrder(order_number, phone)` — el
  cliente consulta su pedido con número + teléfono, sin cuenta de usuario.
- **Flujo Wompi**: `placeWebOrder` crea el pedido → si el método es `wompi`,
  `createWompiCheckout` abre el checkout externo → al volver,
  `verifyAndApplyTransaction` confirma el pago y actualiza el pedido.

## Pendiente de confirmar (no está en el `CLAUDE.md` original — verificar con el equipo/código antes de asumir)

- Si un pedido web (`placeWebOrder`) impacta `stock_movements` /
  `product_stock` igual que una venta POS (`create_sale`), o si corre por un
  camino distinto. Esto es importante por el principio de "fuente única de
  verdad del inventario" del `CLAUDE.md` raíz — antes de tocar este módulo,
  confirma cómo `placeWebOrder` reserva o descuenta stock.
- Si existe una tabla `web_orders` separada de `sales`, o si convergen en la
  misma tabla con un campo de origen.

## Nota para prompts en este módulo

Este módulo no estaba mapeado en el `CLAUDE.md` original ni en `ROADMAP.md`
— sí conviene agregarlo a la hoja de ruta si va a seguir creciendo (pagos,
más métodos de envío, etc.).
