# CLAUDE.md — POS-SOLCRAFT (raíz)

> Este archivo se carga en CADA sesión. Debe contener solo lo que es verdad en
> cualquier módulo. Todo lo específico de un módulo vive en su propio
> `CLAUDE.md` (ver "Mapa del proyecto" abajo) y se carga solo cuando trabajas ahí.

## Qué es este proyecto

Sistema **POS Multisede** para un almacén de ropa en Colombia (marca Taiwy).
Una **bodega central** recibe mercancía y la despacha a sedes de venta; cada
sede vende por POS con turnos de caja.

**Directriz principal: el POS debe parecerse lo más posible a Alegra POS.**
Al mejorar un módulo, compara contra el equivalente de Alegra antes de diseñar.
(Hoja de ruta completa de paridad → `@ROADMAP.md`, cárgalo solo si vas a planear
features nuevas, no para tareas puntuales.)

## Principios rectores (no negociables, aplican a todo el código)

1. **`stock_movements` es la única fuente de verdad del inventario.**
   `product_stock` es un caché derivado. Ninguna operación toca el saldo sin
   escribir su movimiento en la MISMA transacción.
2. **Invariante del kardex:** para todo (producto, bodega),
   `SUM(stock_movements.quantity) = saldo actual` (incluye bodega virtual
   Tránsito). Verificar con `SELECT * FROM verify_kardex_integrity()`.
3. **El servidor decide el precio, nunca el cliente.** El frontend propone;
   el RPC recalcula/valida contra el catálogo.
4. **El catálogo de productos es único, propiedad de la bodega central.**
   Un código = un modelo (no una prenda física). El código es inmutable.
5. **Toda operación con impacto en dinero o inventario corre en transacción**
   con lock cuando hay concurrencia.

## Roles y permisos

4 roles: `admin` (global), `contador` (global), `encargado` (por sede),
`vendedor` (por sede). Tabla `user_profiles` (`role` + `site_id`; admin/contador
tienen `site_id = NULL`). Seguridad: JWT + RLS + `role-guard.ts` como defensa
en profundidad.

## Stack

Next.js 15 (App Router) + React 19 + TypeScript, generado/sincronizado con
v0.dev, desplegado en Vercel. UI: Tailwind + shadcn/ui + lucide-react.
Backend: **Supabase** (Postgres + Auth + Storage), sin API propia — toda la
lógica vive en Server Actions (`lib/*-actions.ts}`).
Detalles de conexión, esquema y RPCs → `@SUPABASE.md` (cárgalo al tocar backend).

## Convenciones

- UI y mensajes al usuario **en español**; código/identificadores en inglés
  (snake_case en tablas y columnas).
- Server Actions devuelven `{ success: boolean, message: string, ... }`.
- Tras mutaciones: `revalidatePath()` de las rutas afectadas.
- Moneda: COP, formateo en `lib/format.ts` / `formatCurrency`.
- Componentes de dominio en `components/<módulo>/`; primitivas shadcn en
  `components/ui/` (no modificarlas salvo necesidad real).

## Mapa del proyecto (contexto por módulo — NO se carga automáticamente)

Cada carpeta tiene su propio `CLAUDE.md` con las reglas de negocio de ESE
módulo. Referéncialo explícitamente cuando trabajes ahí, así el modelo no
carga reglas de POS cuando estás en Contabilidad.

| Módulo | Ruta | Contexto específico |
|---|---|---|
| POS / ventas | `app/pos/` | `app/pos/CLAUDE.md` |
| Inventario / productos | `app/inventory/` | `app/inventory/CLAUDE.md` |
| Bodega central / traslados | `app/central/` | `app/central/CLAUDE.md` |
| Caja / turnos | `lib/shift-actions.ts` | ver `app/pos/CLAUDE.md` (turnos vive ahí) |
| Contabilidad | `app/accounting/` | `app/accounting/CLAUDE.md` |
| Usuarios / roles | `app/users/` | usa las reglas de "Roles y permisos" de este archivo, no necesita CLAUDE.md propio |
| Catálogo / tienda pública | `app/catalog/` | `app/catalog/CLAUDE.md` — storefront público (landing, carrito, checkout, pagos), distinto del panel interno |

## Documentos que se cargan bajo demanda (no siempre)

- `@SUPABASE.md` — esquema, RPCs, cómo correr scripts, conexión de desarrollo.
- `@ROADMAP.md` — deudas técnicas + hoja de ruta de paridad con Alegra.
- `@PERFORMANCE.md` — presupuestos y patrones de optimización.

## Cómo trabajar en este repo (resumen — flujo completo en `FLUJO-TRABAJO.md`)

- Nueva tarea = nueva sesión (`/clear`) si cambias de módulo.
- Referencia el `CLAUDE.md` del módulo explícitamente al empezar, no dejes que
  Claude explore el repo para encontrarlo.
- No cargues `@ROADMAP.md` ni `@SUPABASE.md` salvo que la tarea lo requiera.
