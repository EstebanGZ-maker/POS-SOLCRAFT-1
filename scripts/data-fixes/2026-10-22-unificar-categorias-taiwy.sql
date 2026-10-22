-- Data fix: unificar categorías duplicadas en Taiwy Sport (aapchdjwpqhwsquffnxn).
-- Fecha: 2026-10-22
-- Motivo: duplicados generados antes del merge 19ea1d7 (Select de categorías con whitelist).
--         Reasignar productos de la variante duplicada a la canónica y retirar la vacía.
-- Pares (canónica <- duplicada):
--   Uniformes Futbol (170d39a7-46f0-4046-b596-b670aa8dd0d3) <- Uniforme Futbol (931b6d97-eef8-4eec-abf4-d89f378f2bce)  esperado: 38 productos movidos (38 activos)
-- FK única a categories: products.category_id (verificado 2026-10-22).
-- Idempotente: si la duplicada ya no existe, UPDATE/DELETE no afectan filas; el DO no falla.
-- NO aplicar sin OK de Esteban. Registrar una fila por instancia en §"Registro de intervenciones manuales".

BEGIN;

-- Par 1: Uniformes Futbol <- Uniforme Futbol
UPDATE products
   SET category_id = '170d39a7-46f0-4046-b596-b670aa8dd0d3',
       updated_at = now()
 WHERE category_id = '931b6d97-eef8-4eec-abf4-d89f378f2bce';

DO $$
DECLARE
  v_restantes integer;
BEGIN
  SELECT COUNT(*) INTO v_restantes
    FROM products
   WHERE category_id = '931b6d97-eef8-4eec-abf4-d89f378f2bce';
  IF v_restantes <> 0 THEN
    RAISE EXCEPTION 'Abort: quedan % productos en Uniforme Futbol (931b6d97...) tras el UPDATE', v_restantes;
  END IF;
END $$;

DELETE FROM categories
 WHERE category_id = '931b6d97-eef8-4eec-abf4-d89f378f2bce'
   AND NOT EXISTS (SELECT 1 FROM products WHERE category_id = '931b6d97-eef8-4eec-abf4-d89f378f2bce');

COMMIT;
