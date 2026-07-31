-- ============================================================================
-- POS-SOLCRAFT — Esquema completo (fuente de verdad)
-- Derivado del código en lib/*-actions.ts. Idempotente (IF NOT EXISTS).
-- Orden de ejecución: 00_schema → 01_functions → 02_rls → 03_storage → 04_seed
-- ============================================================================

-- ============ CATÁLOGO ============

CREATE TABLE IF NOT EXISTS categories (
    category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(60) UNIQUE,              -- código único legible: CA-M-95-00
    barcode VARCHAR(120),                 -- por defecto igual a code
    type_prefix VARCHAR(4),               -- CA, PA, VE, ...
    description TEXT,
    category_id UUID REFERENCES categories(category_id) ON DELETE SET NULL,
    unit VARCHAR(40) NOT NULL DEFAULT 'Unidad',
    cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    is_service BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    size VARCHAR(20),
    image_url TEXT,
    stock_quantity INTEGER NOT NULL DEFAULT 0, -- stock global legacy; el real es product_stock
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ SEDES Y BODEGAS ============

CREATE TABLE IF NOT EXISTS sites (
    site_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    is_central BOOLEAN NOT NULL DEFAULT FALSE,
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo puede existir UNA sede central (regla heredada del proyecto anterior)
CREATE UNIQUE INDEX IF NOT EXISTS one_central_site ON sites (is_central) WHERE is_central;

CREATE TABLE IF NOT EXISTS warehouses (
    warehouse_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola bodega principal por sede
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_warehouse_per_site
    ON warehouses (site_id) WHERE is_primary;

-- Stock por producto × bodega (el POS descuenta de aquí)
CREATE TABLE IF NOT EXISTS product_stock (
    product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    min_quantity INTEGER,
    max_quantity INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (product_id, warehouse_id)
);

-- ============ PRECIOS Y PROMOCIONES ============

CREATE TABLE IF NOT EXISTS price_lists (
    price_list_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola lista por defecto
CREATE UNIQUE INDEX IF NOT EXISTS one_default_price_list
    ON price_lists (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS product_prices (
    product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    price_list_id UUID NOT NULL REFERENCES price_lists(price_list_id) ON DELETE CASCADE,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    PRIMARY KEY (product_id, price_list_id)
);

CREATE TABLE IF NOT EXISTS promotions (
    promotion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    description TEXT,
    discount_percent NUMERIC(5, 2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    site_id UUID REFERENCES sites(site_id) ON DELETE SET NULL, -- NULL = todas las sedes
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ CLIENTES ============

CREATE TABLE IF NOT EXISTS customers (
    customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(30),
    id_type VARCHAR(30),        -- CC, NIT, CE, ...
    id_number VARCHAR(40),
    first_name VARCHAR(80),
    second_name VARCHAR(80),
    last_names VARCHAR(160),
    city_state VARCHAR(160),
    address TEXT,
    postal_code VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ VENTAS ============

CREATE TABLE IF NOT EXISTS pos_shifts (
    shift_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number BIGINT GENERATED BY DEFAULT AS IDENTITY,
    site_id UUID NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    warehouse_id UUID REFERENCES warehouses(warehouse_id) ON DELETE SET NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    initial_cash NUMERIC(12, 2) NOT NULL DEFAULT 0,
    bank_base VARCHAR(120),
    opened_by TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    closed_by TEXT,
    counted_cash NUMERIC(12, 2),
    expected_cash NUMERIC(12, 2),
    difference NUMERIC(12, 2),
    notes TEXT
);

-- Un solo turno abierto por sede
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift_per_site
    ON pos_shifts (site_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS cash_movements (
    movement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES pos_shifts(shift_id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense', 'refund')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
    sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    sale_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(60),
    amount_received NUMERIC(12, 2),
    seller TEXT,
    notes TEXT,
    site_id UUID REFERENCES sites(site_id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(warehouse_id) ON DELETE SET NULL,
    shift_id UUID REFERENCES pos_shifts(shift_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
    sale_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ INVENTARIO: AJUSTES Y TRASLADOS ============

CREATE TABLE IF NOT EXISTS inventory_adjustments (
    adjustment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
    notes TEXT,
    total_adjusted NUMERIC(14, 2) NOT NULL DEFAULT 0,
    adjustment_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adjustment_items (
    adjustment_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_id UUID NOT NULL REFERENCES inventory_adjustments(adjustment_id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    objective VARCHAR(12) NOT NULL CHECK (objective IN ('incrementar', 'disminuir')),
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS transfers (
    transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_warehouse_id UUID NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    to_warehouse_id UUID NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    transfer_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transfer_items (
    transfer_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);

-- ============ CONTABILIDAD ============

CREATE TABLE IF NOT EXISTS accounting_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('income', 'expense')),
    category VARCHAR(120),
    description TEXT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    sale_id UUID REFERENCES sales(sale_id) ON DELETE SET NULL,
    entry_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ ÍNDICES ============

CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_product_stock_warehouse ON product_stock (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_site ON warehouses (site_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_site_date ON sales (site_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales (shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements (shift_id);
CREATE INDEX IF NOT EXISTS idx_accounting_site_date ON accounting_entries (site_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_adjustments_warehouse ON inventory_adjustments (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers (from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers (to_warehouse_id);

-- ============ TRIGGER updated_at ============

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_stock_updated_at ON product_stock;
CREATE TRIGGER update_product_stock_updated_at BEFORE UPDATE ON product_stock
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
