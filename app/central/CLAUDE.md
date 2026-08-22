# CLAUDE.md — Módulo Bodega Central (`app/central/`)

> Contexto SOLO para ingreso de mercancía y traslados a sedes. No repite los
> principios rectores del `CLAUDE.md` raíz.

## Rutas de este módulo

| Ruta | Qué hace |
|---|---|
| `/central` | Ingreso de mercancía (manual o con IA) y envíos masivos a sedes (`createBulkTransfer`) |
| `/central/transfers` | Historial de traslados con dashboard por estado, filtros/búsqueda, alerta admin de fantasmas |
| `/central/transfers/[transfer_id]` | Detalle de traslado con acciones por estado |
| `/transfers/send` | Envío individual con opción "guardar como pendiente" vs "despachar ahora" |
| `/transfers/receive` | Recepción con detección de faltantes → estado `recibido_con_pendiente` |
| `/transfers/reconcile` | Cierre de faltantes (found_qty>0 = hallado, found_qty=0 = pérdida total, ambos vía `reconcile_transfer`) |

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
- **Traslados** (`createBulkTransfer`): ciclo completo de 5 estados vigente
  desde s16-s19 (2026-08-21). `transfers.status` acepta `pendiente`,
  `en_transito`, `recibido`, `recibido_con_pendiente`, `cancelado`.
  Fuente única TS: `lib/transfer-status.ts`. RPCs vivos:
  `send_transfer_via_transit`, `receive_transfer`, `receive_transfer_item`,
  `reconcile_transfer`. Server actions TS: `createBulkTransfer(opts.as_pending)`,
  `dispatchPendingTransfer`, `cancelTransfer` (semántica por estado),
  `adminCloseGhostTransfer` (admin-only para huérfanos).

## Deuda técnica específica de este módulo

`createBulkTransfer` no es atómico: hace INSERT transfer + INSERT items +
Promise.all de RPCs de stock sin transacción envolvente. Mitigación TS
vigente desde s18: DELETE compensatorio si algún RPC del loop falla.
Cubre el 99% pero no es transacción real. Fix definitivo pendiente: RPC
SQL `create_bulk_transfer_atomic` con FOR UPDATE + rollback real.
Revisar en el mismo cambio si `dispatchPendingTransfer` (s17) tiene el
mismo patrón vulnerable en su loop de despacho — probablemente sí.
