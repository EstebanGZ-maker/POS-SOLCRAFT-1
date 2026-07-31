-- ============================================================================
-- POS-SOLCRAFT — Fase 1: Roles, Kardex, Numeración de ventas
-- Ejecutar DESPUÉS de 00–04. Idempotente donde es posible.
-- ============================================================================

-- ============ 1.1  ROLES Y PERMISOS ============

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'vendedor'
        CHECK (role IN ('admin','contador','encargado','vendedor')),
    site_id UUID REFERENCES sites(site_id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_site ON user_profiles(site_id);

-- Trigger: crear perfil automáticamente al registrar usuario
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'vendedor')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Seed: perfil del usuario admin existente (admin@solcraft.dev)
INSERT INTO user_profiles (id, email, full_name, role)
SELECT id, email, 'Administrador', 'admin'
FROM auth.users
WHERE email = 'admin@solcraft.dev'
ON CONFLICT (id) DO UPDATE SET role = 'admin', full_name = 'Administrador';

-- SECURITY DEFINER helpers (used by 02_rls.sql — avoid RLS recursion)
CREATE OR REPLACE FUNCTION user_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION user_site_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT site_id FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_global_role()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin','contador')
  );
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION is_admin_or_encargado()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin','encargado')
  );
$$;

-- RLS para user_profiles → definida en 02_rls.sql

-- ============ 1.2  KARDEX — MOVIMIENTOS DE STOCK ============

CREATE TABLE IF NOT EXISTS stock_movements (
    movement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(product_id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(warehouse_id),
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'apertura','compra','venta',
        'traslado_salida','traslado_entrada',
        'transito_entrada','transito_salida',
        'ajuste','devolucion'
    )),
    quantity INTEGER NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    user_id UUID REFERENCES auth.users(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movements_product_wh
    ON stock_movements(product_id, warehouse_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_reference
    ON stock_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_movements_type
    ON stock_movements(movement_type);

-- RLS para stock_movements → definida en 02_rls.sql

-- Bodega virtual de Tránsito
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO warehouses (site_id, name, is_primary, is_system)
SELECT site_id, 'Tránsito', FALSE, TRUE
FROM sites WHERE is_central = TRUE
AND NOT EXISTS (
    SELECT 1 FROM warehouses WHERE name = 'Tránsito' AND is_system = TRUE
);

-- Saldos de apertura (migración una vez): copia saldos actuales como movimiento inicial
INSERT INTO stock_movements
    (product_id, warehouse_id, movement_type, quantity, reference_type, notes)
SELECT ps.product_id, ps.warehouse_id, 'apertura', ps.quantity,
       'migration', 'Saldo inicial al activar kardex'
FROM product_stock ps
WHERE ps.quantity <> 0
AND NOT EXISTS (
    SELECT 1 FROM stock_movements sm
    WHERE sm.product_id = ps.product_id
      AND sm.warehouse_id = ps.warehouse_id
      AND sm.movement_type = 'apertura'
      AND sm.reference_type = 'migration'
);

-- Función de verificación del invariante del kardex
CREATE OR REPLACE FUNCTION verify_kardex_integrity()
RETURNS TABLE(product_id UUID, warehouse_id UUID,
              saldo_real INTEGER, suma_kardex BIGINT, diff BIGINT)
LANGUAGE sql AS $$
    SELECT COALESCE(s.product_id, m.product_id),
           COALESCE(s.warehouse_id, m.warehouse_id),
           COALESCE(s.quantity, 0) AS saldo_real,
           COALESCE(m.total, 0)::BIGINT AS suma_kardex,
           (COALESCE(s.quantity, 0) - COALESCE(m.total, 0))::BIGINT AS diff
    FROM product_stock s
    FULL OUTER JOIN (
        SELECT sm.product_id, sm.warehouse_id, SUM(sm.quantity) AS total
        FROM stock_movements sm GROUP BY 1, 2
    ) m ON m.product_id = s.product_id AND m.warehouse_id = s.warehouse_id
    WHERE COALESCE(s.quantity, 0) <> COALESCE(m.total, 0);
$$;

-- ============ 1.3  NUMERACIÓN Y ESTADO DE VENTAS ============

ALTER TABLE sales ADD COLUMN IF NOT EXISTS numero INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Add CHECK constraint if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'sales_status_check'
    ) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_status_check
            CHECK (status IN ('active','voided'));
    END IF;
END $$;

-- Unique index: numero por sede
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_numero_site
    ON sales(site_id, numero) WHERE numero IS NOT NULL;

-- Contadores atómicos por sede
CREATE TABLE IF NOT EXISTS site_counters (
    site_id UUID PRIMARY KEY REFERENCES sites(site_id) ON DELETE CASCADE,
    last_numero INTEGER NOT NULL DEFAULT 0
);

-- Inicializar contadores para sedes existentes (solo no-centrales)
INSERT INTO site_counters (site_id, last_numero)
SELECT s.site_id, COALESCE(
    (SELECT MAX(sa.numero) FROM sales sa WHERE sa.site_id = s.site_id), 0
)
FROM sites s
WHERE NOT s.is_central
ON CONFLICT (site_id) DO NOTHING;

-- RLS para site_counters → definida en 02_rls.sql

-- ============ CAMPOS MAYORISTA (preparación Fase 2) ============

ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_wholesale BOOLEAN NOT NULL DEFAULT FALSE;

-- ============ DISPONIBILIDAD PÚBLICA ============

ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE warehouses SET is_public = TRUE WHERE is_system = FALSE AND is_public = FALSE;

-- Vista para catálogo web público (solo disponible/agotado, nunca stock numérico)
CREATE OR REPLACE VIEW public_availability AS
SELECT
  p.product_id,
  p.code,
  p.name,
  p.price,
  p.wholesale_price,
  p.description,
  p.image_url,
  s.site_id,
  s.name AS site_name,
  CASE
    WHEN COALESCE(ps.quantity, 0) > 0 THEN 'disponible'
    ELSE 'agotado'
  END AS availability
FROM products p
CROSS JOIN (
  SELECT si.site_id, si.name, w.warehouse_id
  FROM sites si
  JOIN warehouses w ON w.site_id = si.site_id
  WHERE w.is_public = TRUE
) s
LEFT JOIN product_stock ps
  ON ps.product_id = p.product_id
  AND ps.warehouse_id = s.warehouse_id
WHERE p.is_active = TRUE;

-- ============ VENTAS SUSPENDIDAS (Fase 3) ============

CREATE TABLE IF NOT EXISTS suspended_sales (
  suspended_sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(site_id),
  customer_id UUID REFERENCES customers(customer_id),
  price_list TEXT DEFAULT 'general',
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  suspended_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suspended_sales_site ON suspended_sales(site_id);

-- ============ PROMOCIONES POR PRODUCTO (Fase 3) ============

CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id UUID NOT NULL REFERENCES promotions(promotion_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);
