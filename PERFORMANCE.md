# Presupuesto y patrones de rendimiento — POS-SOLCRAFT

## Objetivo

- **LCP < 1000ms en cada ruta**, con caché fría, dev server (`pnpm dev`).
- Medición canónica: `node scripts/measure-perf.mjs`. Una ruta solo "pasa" si el
  script la reporta como `pass`. No confiar en impresiones subjetivas.
- El dev server debe estar corriendo antes de medir: `pnpm dev`.

## Reglas para el agente al optimizar

1. Atacar **la ruta más lenta primero** (campo `slowest` en `perf-results.json`).
2. Trabajar **una ruta por iteración**: cargar en contexto solo el componente de esa
   ruta, su server action y las queries relacionadas. No releer todos los módulos.
3. Tras cada cambio, re-medir **solo esa ruta**: `node scripts/measure-perf.mjs --route <path>`.
4. No romper los tests existentes ni la lógica de negocio (bloqueo de sobreventa,
   stock por bodega, venta atómica, turnos de caja).
5. Si una ruta no baja del presupuesto tras 3 intentos, **documentar el cuello de
   botella y pasar a la siguiente** (evita quemar tokens en un caso difícil).

## Diagnóstico primero (no optimizar a ciegas)

- ¿El cuello está en el front o en el back? El script separa `lcp` de `total`.
  Si `total` >> `lcp`, sospecha del backend/DB, no del bundle.
- Front: revisar tamaño de chunks, waterfalls de carga, componentes pesados.
- Back: envolver el server action sospechoso con `console.time`; sacar la query
  y correr `EXPLAIN ANALYZE` en Postgres (Supabase SQL Editor o MCP).

---

## Frontend — Next.js 15 + React 19

- **Code-splitting por ruta.** Next.js App Router lo hace automáticamente por
  `page.tsx`. Verificar que no se importan módulos pesados en el layout raíz.
- **Dynamic import de librerías pesadas.** Charts (recharts en dashboard/contabilidad),
  generación de códigos de barra (jsbarcode) solo deben cargarse cuando se usan:
  `const Recharts = dynamic(() => import('recharts'), { ssr: false })` o import
  dinámico dentro del handler.
- **Evitar barrel imports** (`import { x } from '../utils'` que re-exporta todo):
  rompen el tree-shaking. Importar del archivo concreto.
- **Virtualización de tablas largas.** Inventario (bodega central) y Ventas pueden
  tener cientos de filas. Usar `@tanstack/react-virtual` o `react-window` en vez
  de renderizar todas las filas.
- **Cache de datos con SWR.** Datos de referencia estables (sedes, categorías,
  listas de precios) → `staleTime` / `dedupingInterval` alto en vez de refetch
  en cada navegación.
- **Debounce en búsquedas** de inventario/POS (300ms) para no disparar una
  request por tecla.
- **Imágenes de producto** (beachwear): thumbnails en WebP, `loading="lazy"`,
  `width`/`height` fijos para evitar layout shift.

## Backend — Server Actions + Supabase

- **Eliminar N+1.** Traslados y Ventas suelen tener joins ocultos (item → producto →
  sede). Usar `.select('*, sale_items(*, products(*))') ` en lugar de queries por fila.
- **Nunca `select('*')`** en listados grandes: seleccionar solo las columnas que la UI
  muestra.
- **Paginación** en inventario/ventas para evitar traer miles de registros.
- **Cachear datos de referencia** en el server action con `unstable_cache` de Next.js
  o headers de cache: sedes, categorías, listas de precios.
- **No bloquear el event loop** generando reportes contables pesados: paginar el
  cálculo o usar RPCs de Postgres para el procesamiento.

## Base de datos — PostgreSQL (Supabase)

- **Índices en foreign keys y columnas de filtro frecuente**: `site_id`, `product_id`,
  `warehouse_id`, `created_at`. Muchos LCP altos en contabilidad son un seq scan
  que un índice resuelve.
- **Índices compuestos** que cubran el `WHERE` + `ORDER BY` típico
  (ej. `(site_id, created_at DESC)` para ventas por sede).
- **`EXPLAIN ANALYZE`** en las queries de contabilidad y reportes antes de tocar nada.
  Buscar `Seq Scan` y `Sort` costosos.
- **Vistas materializadas** para reportes consolidados si se recalculan en cada carga.
- **Índices parciales** para registros activos (`WHERE is_active = true`).

## Orden de ataque sugerido

Casi siempre el mayor retorno está en este orden:
1. Índices/queries de Postgres en rutas `heavy` (contabilidad, bodega central).
2. Dynamic imports de librerías pesadas (recharts, jsbarcode).
3. Virtualización de tablas y cache de datos de referencia.
4. Reducir waterfalls de datos (server actions que llaman en secuencia).
