-- Data fix: unificar categorías duplicadas en Solcraft (nxszaxwsrtlofqimbfig).
-- Fecha: 2026-10-22
-- Motivo: duplicados generados antes del merge 19ea1d7 (Select de categorías con whitelist).
--         Reasignar productos de la variante duplicada a la canónica y retirar la vacía.
-- Pares (canónica <- duplicada):
--   Camisetas    (6426c37b-4234-41be-8654-748316fceee2) <- CAMISETAS   (2859e636-e4e1-413d-bda2-dd0b8576b8b1)  esperado: 9 productos movidos (0 activos + 9 inactivos)
--   PANTALONETAS (1e3748cf-71d3-4bf7-b169-47f2d0b559d1) <- PANTALONETA (94343ace-3cf4-4ac1-8139-a0f5c4386078)  esperado: 1 producto  movido  (1 activo)
-- FK única a categories: products.category_id (verificado 2026-10-22).
-- Idempotente: si la duplicada ya no existe, UPDATE/DELETE no afectan filas; el DO no falla.
-- NO aplicar sin OK de Esteban. Registrar una fila por instancia en §"Registro de intervenciones manuales".

BEGIN;

-- Par 1: Camisetas <- CAMISETAS
UPDATE products
   SET category_id = '6426c37b-4234-41be-8654-748316fceee2',
       updated_at = now()
 WHERE category_id = '2859e636-e4e1-413d-bda2-dd0b8576b8b1';

DO $$
DECLARE
  v_restantes integer;
BEGIN
  SELECT COUNT(*) INTO v_restantes
    FROM products
   WHERE category_id = '2859e636-e4e1-413d-bda2-dd0b8576b8b1';
  IF v_restantes <> 0 THEN
    RAISE EXCEPTION 'Abort: quedan % productos en CAMISETAS (2859e636...) tras el UPDATE', v_restantes;
  END IF;
END $$;

DELETE FROM categories
 WHERE category_id = '2859e636-e4e1-413d-bda2-dd0b8576b8b1'
   AND NOT EXISTS (SELECT 1 FROM products WHERE category_id = '2859e636-e4e1-413d-bda2-dd0b8576b8b1');

-- Par 2: PANTALONETAS <- PANTALONETA
UPDATE products
   SET category_id = '1e3748cf-71d3-4bf7-b169-47f2d0b559d1',
       updated_at = now()
 WHERE category_id = '94343ace-3cf4-4ac1-8139-a0f5c4386078';

DO $$
DECLARE
  v_restantes integer;
BEGIN
  SELECT COUNT(*) INTO v_restantes
    FROM products
   WHERE category_id = '94343ace-3cf4-4ac1-8139-a0f5c4386078';
  IF v_restantes <> 0 THEN
    RAISE EXCEPTION 'Abort: quedan % productos en PANTALONETA (94343ace...) tras el UPDATE', v_restantes;
  END IF;
END $$;

DELETE FROM categories
 WHERE category_id = '94343ace-3cf4-4ac1-8139-a0f5c4386078'
   AND NOT EXISTS (SELECT 1 FROM products WHERE category_id = '94343ace-3cf4-4ac1-8139-a0f5c4386078');

COMMIT;
