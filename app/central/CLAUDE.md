# CLAUDE.md — Módulo Bodega Central (`app/central/`)

> Contexto SOLO para ingreso de mercancía y traslados a sedes. No repite los
> principios rectores del `CLAUDE.md` raíz.

## Rutas de este módulo

| Ruta | Qué hace |
|---|---|
| `/central` | Ingreso de mercancía (manual o con IA) y envíos masivos a sedes (`createBulkTransfer`) |
| `/central/transfers` | Historial de traslados |

## Reglas de negocio

- **Ingreso de mercancía** (`ingressNewProduct`): genera código único
  secuencial `PREFIJO-TALLA-PRECIOmiles-NN` vía RPC `next_product_code`
  (ej. `CA-M-95-00`). Crea producto + precio en lista default + stock en
  bodega central + gasto contable "Compra de mercancía". El código sirve
  también de barcode.
- **Ingreso con IA**: `components/central/ai-ingress-panel.tsx` usa
  `app/api/analyze-product/route.ts` (AI SDK, `google/gemini-2.5-flash` vía
  AI Gateway de Vercel) para analizar fotos/videos de prendas y extraer
  nombre, tipo, talla, color, precio sugerido (COP) y cantidad. Requiere
  `AI_GATEWAY_API_KEY` (ver `SUPABASE.md`); sin ella el resto de la app
  funciona igual.
- **Traslados** (`createBulkTransfer`): envío desde una bodega a varias
  sedes a la vez, estado `completed` inmediato vía RPC `transfer_stock`.
  **Aún no tiene estados intermedios** (pendiente/en tránsito/recibido con
  faltantes) — es la Fase 2 pendiente en `ROADMAP.md`.

## Deuda técnica específica de este módulo

`createBulkTransfer` sigue siendo una mutación multi-paso no atómica desde
el server action; migrar a RPC como se hizo con `create_sale`.
