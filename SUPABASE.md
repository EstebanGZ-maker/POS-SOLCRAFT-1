# SUPABASE.md — Backend (cargar solo al tocar esquema, RPCs o datos)

## Proyecto

**Proyecto de PRODUCCIÓN**: **EstebanGZ-maker's Project**, ref
`nxszaxwsrtlofqimbfig`, región us-west-2, Postgres 17.

Este proyecto **es la única DB en uso real** (contiene ventas reales, usuarios
reales, kardex histórico). Aunque originalmente se documentó como "desarrollo",
en la práctica hace de producción. Cualquier cambio de esquema/RPC/RLS aquí
afecta el negocio en vivo — trata todas las escrituras como cambios de prod.

**Para pruebas destructivas o de migración**: usa el stack local de Supabase CLI
(`supabase start`, Docker) — copia limpia del esquema en `postgresql://
postgres:postgres@127.0.0.1:54322/postgres`, sin costos y sin riesgo. Los
preview branches de Supabase Cloud requieren plan Pro (no disponible).

## Fuente de verdad del esquema

`scripts/*.sql`:
- `00_schema.sql` — 18 tablas + índices + triggers
- `01_functions.sql` — RPCs: `create_sale`, `void_sale`,
  `adjust_warehouse_stock`, `transfer_stock`, `verify_kardex_integrity`, etc.
- `02_rls.sql`
- `03_storage.sql`
- `04_seed.sql`
- `05_merge_features.sql` — Fase 1: `user_profiles`, `stock_movements`,
  `site_counters`, bodega Tránsito, saldos de apertura, campos
  mayorista/disponibilidad.

Cualquier cambio de esquema: nueva migración vía Supabase + actualizar estos
scripts.

## RPCs principales

`create_sale`, `void_sale`, `adjust_warehouse_stock`, `transfer_stock`,
`verify_kardex_integrity`, `decrement_product_stock`, `next_product_code`,
`get_low_stock_products`, `get_sales_summary`.

## Entorno local

`pnpm install && pnpm dev` (o `npx pnpm install` si no hay pnpm). El
`.env.local` ya existe con `NEXT_PUBLIC_SUPABASE_URL` y
`NEXT_PUBLIC_SUPABASE_ANON_KEY` del proyecto de desarrollo.
`next.config.mjs` ignora errores de ESLint/TypeScript en build — no confiarse
del build como validación. Ruta de IA (`/api/analyze-product`) requiere
`AI_GATEWAY_API_KEY`; sin ella el resto de la app funciona igual.

## Usuario de desarrollo

Credenciales en `.env.local` / gestor de secretos — **no las dejes en texto
plano dentro de un `.md` versionado en el repo**, ni siquiera este. Muévelas
ahí si todavía están aquí.

## IA

`app/api/analyze-product/route.ts` usa AI SDK (`google/gemini-2.5-flash` vía
AI Gateway de Vercel) para analizar fotos/videos de prendas y extraer nombre,
tipo, talla, color, precio sugerido (COP) y cantidad. Alimenta
`components/central/ai-ingress-panel.tsx`.
