-- ============================================================================
-- POS-SOLCRAFT — Datos iniciales (idempotente)
-- ============================================================================

-- Lista de precios por defecto
INSERT INTO price_lists (name, is_default)
SELECT 'General', TRUE
WHERE NOT EXISTS (SELECT 1 FROM price_lists WHERE is_default);

-- Bodega Central (distribución)
INSERT INTO sites (name, code, is_central, address)
SELECT 'Bodega Central', 'CENTRAL', TRUE, NULL
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE is_central);

-- 5 sedes de venta reales
INSERT INTO sites (name, code, is_central, address) VALUES
    ('El Carmen Hombres', 'ECH', FALSE, NULL),
    ('El Carmen Damas',   'ECD', FALSE, NULL),
    ('La Ceja',           'LCJ', FALSE, NULL),
    ('Rionegro',          'RNG', FALSE, NULL),
    ('Marinilla',         'MRN', FALSE, NULL)
ON CONFLICT DO NOTHING;

-- Cada sede tiene una bodega primaria (transparente para el usuario)
INSERT INTO warehouses (site_id, name, is_primary)
SELECT s.site_id, 'Principal', TRUE
FROM sites s
WHERE NOT EXISTS (
    SELECT 1 FROM warehouses w WHERE w.site_id = s.site_id AND w.is_primary
);

-- Cliente por defecto del POS (paridad Alegra: "Consumidor final")
INSERT INTO customers (name)
SELECT 'Consumidor final'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = 'Consumidor final');

-- Categorías base para almacén de ropa
INSERT INTO categories (name) VALUES
    ('Camisas'), ('Pantalones'), ('Vestidos'), ('Calzado'), ('Accesorios')
ON CONFLICT (name) DO NOTHING;

-- Productos demo (con código único estilo ingreso de mercancía)
INSERT INTO products (name, code, barcode, type_prefix, category_id, unit, cost, price, size)
SELECT 'Camisa manga larga a cuadros', 'CA-M-95-00', 'CA-M-95-00', 'CA',
       (SELECT category_id FROM categories WHERE name = 'Camisas'), 'Unidad', 45000, 95000, 'M'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE code = 'CA-M-95-00');

INSERT INTO products (name, code, barcode, type_prefix, category_id, unit, cost, price, size)
SELECT 'Pantalón jean clásico', 'PA-32-120-00', 'PA-32-120-00', 'PA',
       (SELECT category_id FROM categories WHERE name = 'Pantalones'), 'Unidad', 60000, 120000, '32'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE code = 'PA-32-120-00');

INSERT INTO products (name, code, barcode, type_prefix, category_id, unit, cost, price, size)
SELECT 'Vestido de baño enterizo', 'VE-S-85-00', 'VE-S-85-00', 'VE',
       (SELECT category_id FROM categories WHERE name = 'Vestidos'), 'Unidad', 38000, 85000, 'S'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE code = 'VE-S-85-00');

-- Precio de los demo en la lista por defecto
INSERT INTO product_prices (product_id, price_list_id, price)
SELECT p.product_id, (SELECT price_list_id FROM price_lists WHERE is_default), p.price
FROM products p
WHERE p.code IN ('CA-M-95-00', 'PA-32-120-00', 'VE-S-85-00')
ON CONFLICT (product_id, price_list_id) DO NOTHING;

-- Stock demo: 100 unidades de cada producto en Bodega Central
-- Las sedes de venta empiezan sin stock (se abastecen por transferencia)
INSERT INTO product_stock (product_id, warehouse_id, quantity)
SELECT p.product_id, w.warehouse_id, 100
FROM products p
CROSS JOIN warehouses w
JOIN sites s ON s.site_id = w.site_id
WHERE p.code IN ('CA-M-95-00', 'PA-32-120-00', 'VE-S-85-00')
  AND s.is_central AND w.is_primary
ON CONFLICT (product_id, warehouse_id) DO NOTHING;
