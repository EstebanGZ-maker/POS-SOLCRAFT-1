-- Migración: cerrar escrituras directas sobre tablas de ventas y afines.
-- Fecha: 2026-10-23
-- Motivo: la política `sale_items_update` tenía `USING (true)` para
--         `authenticated`, de modo que cualquier usuario con sesión (incluido
--         `vendedor`) podía modificar ítems de ventas ya registradas por
--         PostgREST, salteando `create_sale` / `void_sale`. El diagnóstico
--         confirmó que ninguna ruta de la app escribe directo sobre esas
--         tablas: toda escritura pasa por RPCs SECURITY DEFINER de owner
--         `postgres` (BYPASSRLS). Cerramos las políticas abiertas y dejamos
--         solo los RPCs como camino de escritura.
--
-- RPCs SECURITY DEFINER que siguen escribiendo (dueño postgres, sin FORCE RLS):
--   sales / sale_items   → create_sale, void_sale
--   sale_payments        → register_payment
--   customer_credits     → apply_customer_credit
--   cash_movements       → add_cash_movement
--   pos_shifts           → open_shift, close_shift
--   accounting_entries   → create_sale / void_sale / void_adjustment /
--                          create_adjustment (asientos auto por venta y por
--                          ajuste) + createAccountingEntry (asiento manual
--                          por admin|contador, único camino que sigue vía
--                          PostgREST con `accounting_entries_write` endurecida)
--   site_counters        → create_sale (next numero); INSERT por alta de sede
--                          sigue vía `counters_insert_authenticated` con
--                          `WITH CHECK (is_admin())` (no se toca).
--
-- Scope: solo DROP de políticas abiertas + reemplazo de `accounting_entries_write`
--        con WITH CHECK estricto. No se agrega política DELETE a ninguna tabla
--        (regla 6: nada se borra ni se sobrescribe sin rastro — las anulaciones
--        son por `status='voided'`, no por `DELETE`).
--
-- Idempotente: todos los DROP usan `IF EXISTS`; el CREATE va precedido por su
--              DROP correspondiente. Aplicar varias veces no cambia el estado.

-- 10 políticas abiertas que se cierran (ninguna la usa la app).
DROP POLICY IF EXISTS sales_write                      ON public.sales;
DROP POLICY IF EXISTS sales_update                     ON public.sales;
DROP POLICY IF EXISTS sale_items_write                 ON public.sale_items;
DROP POLICY IF EXISTS sale_items_update                ON public.sale_items;
DROP POLICY IF EXISTS cash_movements_write             ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_update            ON public.cash_movements;
DROP POLICY IF EXISTS pos_shifts_write                 ON public.pos_shifts;
DROP POLICY IF EXISTS pos_shifts_update                ON public.pos_shifts;
DROP POLICY IF EXISTS accounting_entries_update        ON public.accounting_entries;
DROP POLICY IF EXISTS counters_update_authenticated    ON public.site_counters;

-- Endurecer el INSERT a `accounting_entries` (único write directo que la app
-- hace fuera de un RPC, desde `createAccountingEntry` que exige admin|contador):
--   - rol admin o contador (nunca vendedor ni encargado),
--   - sale_id NULL (los asientos de ventas los crea `create_sale` SECDEF),
--   - adjustment_id NULL (los asientos de ajustes los crea `create_adjustment`
--     / `void_adjustment` SECDEF).
DROP POLICY IF EXISTS accounting_entries_write ON public.accounting_entries;
CREATE POLICY accounting_entries_write
  ON public.accounting_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_role() IN ('admin', 'contador')
    AND sale_id IS NULL
    AND adjustment_id IS NULL
  );
