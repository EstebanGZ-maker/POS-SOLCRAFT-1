-- Seed mínimo para pruebas locales del paso 1 de S1.
-- No pertenece a prod: solo se aplica en el docker local de Supabase CLI.

BEGIN;

-- Sitios: A y B de venta + un central para tránsito
INSERT INTO sites (site_id, name, code, is_central) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Sede A Preview', 'SEDEA', FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Sede B Preview', 'SEDEB', FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Central Preview', 'CENTRAL', TRUE)
  ON CONFLICT (site_id) DO NOTHING;

-- Warehouses: uno por sede de venta + un tránsito virtual central
INSERT INTO warehouses (warehouse_id, site_id, name, is_primary, is_system) VALUES
  ('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Bodega Sede A', TRUE, FALSE),
  ('aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Bodega Sede B', TRUE, FALSE),
  ('aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'Tránsito',      FALSE, TRUE)
  ON CONFLICT (warehouse_id) DO NOTHING;

-- Counter por sede (para numeración de ventas)
INSERT INTO site_counters (site_id, last_numero) VALUES
  ('11111111-1111-1111-1111-111111111111', 0),
  ('22222222-2222-2222-2222-222222222222', 0),
  ('33333333-3333-3333-3333-333333333333', 0)
  ON CONFLICT (site_id) DO NOTHING;

-- Producto único con stock en Sede A
INSERT INTO products (product_id, name, code, price, is_service, is_active, stock_quantity) VALUES
  ('bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Camiseta QA', 'CA-QA-01', 50000, FALSE, TRUE, 100)
  ON CONFLICT (product_id) DO NOTHING;

INSERT INTO product_stock (product_id, warehouse_id, quantity) VALUES
  ('bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100)
  ON CONFLICT (product_id, warehouse_id) DO NOTHING;

-- Movimiento inicial de kardex para que el invariante se mantenga (saldo = SUM(movements))
INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, notes)
  SELECT 'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
         'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         'apertura', 100, 'Seed inicial QA'
  WHERE NOT EXISTS (
    SELECT 1 FROM stock_movements
    WHERE product_id = 'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND warehouse_id = 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );

-- Cliente default para pruebas de venta
INSERT INTO customers (customer_id, name) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Walk-in QA')
  ON CONFLICT (customer_id) DO NOTHING;

COMMIT;

-- Verify kardex integrity
SELECT * FROM verify_kardex_integrity();

-- NOTA: el turno de caja abierto en Sede A (precondición de pos-sale.spec.ts)
-- se abre en `scripts/seed-users-local.mjs`, después de crear los users, vía
-- el nuevo RPC `open_shift` autenticado como admin. Ese path no se puede
-- reproducir desde SQL puro porque `open_shift` es SECURITY DEFINER y exige
-- `auth.uid()` no nulo — necesita un JWT válido.
