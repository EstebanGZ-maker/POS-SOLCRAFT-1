-- Migración: products.code inmutable cuando hay movimientos o ventas.
-- Fecha: 2026-10-23
-- Motivo: invariante del CLAUDE.md raíz — "Un código = un modelo. El código es
--         inmutable." Caso real detectado: `PU-12P-1-00` → `PU-00-000` en
--         celulares-carmen aunque el producto tenía movimientos y una venta.
-- Scope: trigger BEFORE UPDATE OF code ON products. Si OLD.code IS DISTINCT
--        FROM NEW.code y existe algún stock_movement o sale_item apuntando al
--        producto, lanza excepción. La UI y saveProduct ya bloquean el caso en
--        capas más arriba; este trigger es defensa en profundidad para
--        cualquier otra ruta (SQL manual, futuras RPCs, otro cliente).
-- Permisos: función SECURITY DEFINER + SET search_path. Motivo: el EXISTS
--           sobre stock_movements y sale_items no debe depender del RLS del
--           caller — el plan multi-tenant va a restringir visibilidad por sede
--           y el trigger necesita ver TODAS las filas del producto para
--           decidir. REVOKE EXECUTE a PUBLIC/anon/authenticated al final:
--           nadie debe invocar la función directamente (solo el trigger).
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE
--              TRIGGER.
-- NO afecta: INSERT, UPDATE de otras columnas (OF code → se dispara solo si
--            code aparece en el SET), productos sin ningún movimiento ni venta
--            (que son los que la UI permite corregir).

CREATE OR REPLACE FUNCTION public.enforce_product_code_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.code IS DISTINCT FROM NEW.code THEN
    IF EXISTS (SELECT 1 FROM stock_movements WHERE product_id = OLD.product_id)
       OR EXISTS (SELECT 1 FROM sale_items WHERE product_id = OLD.product_id)
    THEN
      RAISE EXCEPTION
        'El código del producto % no se puede cambiar: ya tiene movimientos o ventas.',
        OLD.code
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_enforce_product_code_immutable ON public.products;
CREATE TRIGGER trg_enforce_product_code_immutable
  BEFORE UPDATE OF code ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_code_immutable();

REVOKE EXECUTE ON FUNCTION public.enforce_product_code_immutable() FROM PUBLIC, anon, authenticated;
