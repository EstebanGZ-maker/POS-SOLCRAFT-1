-- =====================================================================
-- products.barcode: agregar UNIQUE constraint.
--
-- Requerido para el importador masivo de productos (s22), donde barcode
-- se valida con el mismo rigor que code (Referencia): duplicado dentro del
-- archivo o ya existente en DB → rechazo de fila.
--
-- Sin este constraint, el importador tendría que confiar en su propia
-- validación en memoria, lo cual es frágil ante importaciones concurrentes.
-- Con el constraint, el propio Postgres es la última línea de defensa.
--
-- NULL se sigue permitiendo múltiples veces (comportamiento default de
-- UNIQUE en Postgres) — productos sin código de barras coexisten sin
-- problema.
--
-- El índice btree existente (idx_products_barcode) NO se elimina, aunque
-- queda redundante con el índice implícito del UNIQUE. Decisión explícita:
-- sin urgencia de performance que lo justifique.
-- =====================================================================

-- 1. Sanity check: pre-condición confirmada por Esteban (sin duplicados).
--    Si esta suposición fuera falsa, el ALTER va a fallar con un mensaje
--    de constraint violation menos útil. Este bloque falla la migración
--    antes con un mensaje claro y el conteo de duplicados a resolver.
DO $$
DECLARE
  v_dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT barcode
    FROM public.products
    WHERE barcode IS NOT NULL
    GROUP BY barcode
    HAVING COUNT(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'No se puede aplicar UNIQUE en products.barcode: hay % barcode(s) duplicado(s) en la tabla. Deduplicar antes de correr esta migración.',
      v_dupes;
  END IF;
END $$;

-- 2. Agregar el UNIQUE constraint.
ALTER TABLE public.products
  ADD CONSTRAINT products_barcode_key UNIQUE (barcode);
