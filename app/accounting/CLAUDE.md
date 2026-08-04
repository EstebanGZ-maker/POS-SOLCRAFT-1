# CLAUDE.md — Módulo Contabilidad (`app/accounting/`)

> Contexto SOLO para movimientos contables y reportes. No repite los
> principios rectores del `CLAUDE.md` raíz.

## Rutas de este módulo

| Ruta | Qué hace |
|---|---|
| `/accounting` | Movimientos contables (ingresos/gastos por sede) y reportes |
| `/sales` | Historial de ventas |

## Reglas de negocio

- Toda venta registra automáticamente un ingreso en `accounting_entries` con
  categoría "Ventas POS" (ver `app/pos/CLAUDE.md` para el detalle de
  `create_sale`).
- Todo ingreso de mercancía registra automáticamente un gasto contable
  "Compra de mercancía" (ver `app/central/CLAUDE.md`).
- Turnos de caja (`lib/shift-actions.ts`, documentado en
  `app/pos/CLAUDE.md`) generan `cash_movements` que alimentan el cierre de
  caja: efectivo esperado = base inicial + ventas en efectivo + ingresos
  manuales − egresos − reembolsos.

## Nota

Este módulo es principalmente consumidor de eventos generados por POS y
Bodega Central — si vas a depurar un descuadre contable, probablemente
también necesites `app/pos/CLAUDE.md` o `app/central/CLAUDE.md` según el
origen del movimiento.
