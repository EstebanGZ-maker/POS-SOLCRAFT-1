-- Baseline monolítico. Orden: 00, 01, 05, 02, 03, 04, 06, 13b (drift stub), 08, [09 SKIPPED — refs drift funcs], 10, 11, 12, 13, 14.

-- === scripts/00_schema.sql ===

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

-- === scripts/01_functions.sql ===

-- ============================================================================
-- POS-SOLCRAFT — Funciones RPC
-- Todas las mutaciones multi-tabla críticas viven aquí para ser atómicas.
-- Principio: todo cambio de stock = INSERT en stock_movements en la misma TX.
-- ============================================================================

-- Drop old overloads to avoid ambiguous function calls
DROP FUNCTION IF EXISTS adjust_warehouse_stock(UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS transfer_stock(UUID, UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS create_sale(UUID, NUMERIC, JSONB, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, UUID);

-- Ajusta stock de un producto en una bodega (delta positivo o negativo).
-- Valida que el stock nunca quede negativo (evita sobreventa).
-- Escribe un movimiento en el kardex si se proveen los parámetros de kardex.
CREATE OR REPLACE FUNCTION adjust_warehouse_stock(
    p_product_id UUID,
    p_warehouse_id UUID,
    p_delta INTEGER,
    p_movement_type TEXT DEFAULT NULL,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_qty INTEGER;
    v_avail INTEGER;
    v_name TEXT;
BEGIN
    UPDATE product_stock
    SET quantity = quantity + p_delta, updated_at = NOW()
    WHERE product_id = p_product_id
      AND warehouse_id = p_warehouse_id
      AND quantity + p_delta >= 0
    RETURNING quantity INTO v_qty;

    IF FOUND THEN
        IF p_movement_type IS NOT NULL THEN
            INSERT INTO stock_movements
                (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, user_id, notes)
            VALUES
                (p_product_id, p_warehouse_id, p_movement_type, p_delta, p_reference_type, p_reference_id, p_user_id, p_notes);
        END IF;
        RETURN v_qty;
    END IF;

    SELECT quantity INTO v_avail
    FROM product_stock
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;

    IF v_avail IS NOT NULL OR p_delta < 0 THEN
        SELECT name INTO v_name FROM products WHERE product_id = p_product_id;
        RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %.',
            COALESCE(v_name, p_product_id::TEXT), COALESCE(v_avail, 0), -p_delta;
    END IF;

    INSERT INTO product_stock AS ps (product_id, warehouse_id, quantity)
    VALUES (p_product_id, p_warehouse_id, p_delta)
    ON CONFLICT (product_id, warehouse_id)
    DO UPDATE SET quantity = ps.quantity + EXCLUDED.quantity, updated_at = NOW()
    RETURNING ps.quantity INTO v_qty;

    IF p_movement_type IS NOT NULL THEN
        INSERT INTO stock_movements
            (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, user_id, notes)
        VALUES
            (p_product_id, p_warehouse_id, p_movement_type, p_delta, p_reference_type, p_reference_id, p_user_id, p_notes);
    END IF;

    RETURN v_qty;
END;
$$ LANGUAGE plpgsql;

-- Traslada stock entre bodegas de forma atómica con kardex.
CREATE OR REPLACE FUNCTION transfer_stock(
    p_product_id UUID,
    p_from UUID,
    p_to UUID,
    p_quantity INTEGER,
    p_reference_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'La cantidad a trasladar debe ser mayor que cero.';
    END IF;
    IF p_from = p_to THEN
        RAISE EXCEPTION 'La bodega origen y destino no pueden ser la misma.';
    END IF;
    PERFORM adjust_warehouse_stock(
        p_product_id, p_from, -p_quantity,
        'traslado_salida', 'transfer', p_reference_id, p_user_id
    );
    PERFORM adjust_warehouse_stock(
        p_product_id, p_to, p_quantity,
        'traslado_entrada', 'transfer', p_reference_id, p_user_id
    );
END;
$$ LANGUAGE plpgsql;

-- Descuento sobre el stock global legacy (products.stock_quantity).
-- Solo se usa como respaldo cuando la venta no tiene bodega asociada.
CREATE OR REPLACE FUNCTION decrement_product_stock(
    p_product_id UUID,
    p_quantity INTEGER
) RETURNS VOID AS $$
BEGIN
    UPDATE products
    SET stock_quantity = stock_quantity - p_quantity,
        updated_at = NOW()
    WHERE product_id = p_product_id
      AND stock_quantity >= p_quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para el producto %.', p_product_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Genera el siguiente código único de producto: PREFIJO-TALLA-PRECIOmiles-NN
CREATE OR REPLACE FUNCTION next_product_code(
    p_prefix TEXT,
    p_size TEXT,
    p_price_thousands INTEGER
) RETURNS TEXT AS $$
DECLARE
    v_base TEXT;
    v_next INTEGER;
BEGIN
    v_base := UPPER(TRIM(p_prefix)) || '-' || UPPER(TRIM(p_size)) || '-' || p_price_thousands::TEXT;
    SELECT COALESCE(MAX(NULLIF(SPLIT_PART(code, '-', 4), '')::INTEGER), -1) + 1
    INTO v_next
    FROM products
    WHERE code LIKE v_base || '-%'
      AND SPLIT_PART(code, '-', 4) ~ '^[0-9]+$';
    RETURN v_base || '-' || LPAD(v_next::TEXT, 2, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Venta atómica: sales + sale_items + kardex + numeración + asiento contable
-- p_items: [{ "product_id": uuid, "quantity": int, "unit_price": numeric }]
-- Devuelve el sale_id creado.
-- ============================================================================
CREATE OR REPLACE FUNCTION create_sale(
    p_customer_id UUID,
    p_total_amount NUMERIC,
    p_items JSONB,
    p_payment_method TEXT DEFAULT NULL,
    p_amount_received NUMERIC DEFAULT NULL,
    p_seller TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_site_id UUID DEFAULT NULL,
    p_warehouse_id UUID DEFAULT NULL,
    p_shift_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_sale_id UUID;
    v_item RECORD;
    v_is_service BOOLEAN;
    v_numero INTEGER;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La venta no tiene productos.';
    END IF;
    IF p_total_amount < 0 THEN
        RAISE EXCEPTION 'El total de la venta no puede ser negativo.';
    END IF;

    -- Numeración atómica por sede
    IF p_site_id IS NOT NULL THEN
        UPDATE site_counters
        SET last_numero = last_numero + 1
        WHERE site_id = p_site_id
        RETURNING last_numero INTO v_numero;
    END IF;

    INSERT INTO sales (
        customer_id, total_amount, payment_method, amount_received,
        seller, notes, site_id, warehouse_id, shift_id, numero, status
    ) VALUES (
        p_customer_id, p_total_amount, p_payment_method, p_amount_received,
        p_seller, p_notes, p_site_id, p_warehouse_id, p_shift_id, v_numero, 'active'
    ) RETURNING sale_id INTO v_sale_id;

    FOR v_item IN
        SELECT
            (i ->> 'product_id')::UUID   AS product_id,
            (i ->> 'quantity')::INTEGER  AS quantity,
            (i ->> 'unit_price')::NUMERIC AS unit_price
        FROM jsonb_array_elements(p_items) AS i
    LOOP
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Cantidad inválida en la venta.';
        END IF;

        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
        VALUES (v_sale_id, v_item.product_id, v_item.quantity, COALESCE(v_item.unit_price, 0));

        SELECT is_service INTO v_is_service
        FROM products WHERE product_id = v_item.product_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'El producto % no existe.', v_item.product_id;
        END IF;

        IF NOT v_is_service THEN
            IF p_warehouse_id IS NOT NULL THEN
                PERFORM adjust_warehouse_stock(
                    v_item.product_id, p_warehouse_id, -v_item.quantity,
                    'venta', 'sale', v_sale_id, p_user_id
                );
            ELSE
                PERFORM decrement_product_stock(v_item.product_id, v_item.quantity);
            END IF;
        END IF;
    END LOOP;

    IF p_site_id IS NOT NULL THEN
        INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            p_site_id,
            'income',
            'Ventas POS',
            'Venta #' || COALESCE(v_numero::TEXT, LEFT(v_sale_id::TEXT, 8)) ||
                COALESCE(' - ' || p_payment_method, ''),
            p_total_amount,
            v_sale_id
        );
    END IF;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Anulación de venta: revierte stock, kardex, y asiento contable.
-- ============================================================================
CREATE OR REPLACE FUNCTION void_sale(
    p_sale_id UUID,
    p_user_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_sale RECORD;
    v_item RECORD;
    v_is_service BOOLEAN;
BEGIN
    SELECT sale_id, site_id, warehouse_id, total_amount, status, numero
    INTO v_sale
    FROM sales WHERE sale_id = p_sale_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venta no encontrada.';
    END IF;
    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION 'La venta ya está anulada.';
    END IF;

    UPDATE sales SET status = 'voided' WHERE sale_id = p_sale_id;

    FOR v_item IN
        SELECT si.product_id, si.quantity
        FROM sale_items si WHERE si.sale_id = p_sale_id
    LOOP
        SELECT is_service INTO v_is_service
        FROM products WHERE product_id = v_item.product_id;

        IF NOT v_is_service AND v_sale.warehouse_id IS NOT NULL THEN
            PERFORM adjust_warehouse_stock(
                v_item.product_id, v_sale.warehouse_id, v_item.quantity,
                'devolucion', 'sale', p_sale_id, p_user_id,
                'Anulación de venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8))
            );
        END IF;
    END LOOP;

    IF v_sale.site_id IS NOT NULL THEN
        INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            v_sale.site_id,
            'expense',
            'Anulación venta',
            'Anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
            v_sale.total_amount,
            p_sale_id
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============ CONSULTAS DE APOYO ============

CREATE OR REPLACE FUNCTION get_low_stock_products(threshold INTEGER DEFAULT 10)
RETURNS TABLE (
    product_id UUID,
    name VARCHAR(255),
    stock_quantity INTEGER,
    price NUMERIC(12, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.product_id, p.name, p.stock_quantity, p.price
    FROM products p
    WHERE p.stock_quantity <= threshold
    ORDER BY p.stock_quantity ASC, p.name ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_sales_summary(
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ
) RETURNS TABLE (
    total_sales BIGINT,
    total_amount NUMERIC,
    avg_sale_amount NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT,
        COALESCE(SUM(s.total_amount), 0),
        COALESCE(AVG(s.total_amount), 0)
    FROM sales s
    WHERE s.sale_date >= start_date AND s.sale_date <= end_date
      AND s.status = 'active';
END;
$$ LANGUAGE plpgsql;

-- === scripts/05_merge_features.sql ===

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

-- === scripts/02_rls.sql ===

-- ============================================================================
-- POS-SOLCRAFT — Row Level Security (role-based)
-- Helper functions: user_role(), user_site_id(), is_global_role(),
--   is_admin(), is_admin_or_encargado()  (SECURITY DEFINER, in 05_merge_features.sql)
-- ============================================================================

-- Enable RLS on all tables
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'categories', 'products', 'sites', 'warehouses', 'product_stock',
        'price_lists', 'product_prices', 'promotions', 'customers',
        'pos_shifts', 'cash_movements', 'sales', 'sale_items',
        'inventory_adjustments', 'adjustment_items', 'transfers',
        'transfer_items', 'accounting_entries', 'stock_movements',
        'site_counters', 'user_profiles', 'suspended_sales',
        'promotion_products'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- ============================================================
-- user_profiles — own row + admin full access
-- ============================================================
CREATE POLICY "users_read_own" ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());
CREATE POLICY "users_admin_write" ON user_profiles FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- Catalog tables — all read, admin/encargado write, admin-only delete
-- ============================================================

-- categories
CREATE POLICY "categories_read" ON categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_write" ON categories FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "categories_update" ON categories FOR UPDATE TO authenticated USING (is_admin_or_encargado());
CREATE POLICY "categories_delete" ON categories FOR DELETE TO authenticated USING (is_admin());

-- products
CREATE POLICY "products_read" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write" ON products FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "products_update" ON products FOR UPDATE TO authenticated USING (is_admin_or_encargado());
CREATE POLICY "products_delete" ON products FOR DELETE TO authenticated USING (is_admin());

-- price_lists
CREATE POLICY "price_lists_read" ON price_lists FOR SELECT TO authenticated USING (true);
CREATE POLICY "price_lists_write" ON price_lists FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "price_lists_update" ON price_lists FOR UPDATE TO authenticated USING (is_admin_or_encargado());
CREATE POLICY "price_lists_delete" ON price_lists FOR DELETE TO authenticated USING (is_admin_or_encargado());

-- product_prices
CREATE POLICY "product_prices_read" ON product_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "product_prices_write" ON product_prices FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "product_prices_update" ON product_prices FOR UPDATE TO authenticated USING (is_admin_or_encargado());
CREATE POLICY "product_prices_delete" ON product_prices FOR DELETE TO authenticated USING (is_admin_or_encargado());

-- promotions
CREATE POLICY "promotions_read" ON promotions FOR SELECT TO authenticated USING (true);
CREATE POLICY "promotions_write" ON promotions FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "promotions_update" ON promotions FOR UPDATE TO authenticated USING (is_admin_or_encargado());
CREATE POLICY "promotions_delete" ON promotions FOR DELETE TO authenticated USING (is_admin_or_encargado());

-- ============================================================
-- Infrastructure — all read, admin-only write
-- ============================================================

-- sites
CREATE POLICY "sites_read" ON sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "sites_write" ON sites FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "sites_update" ON sites FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "sites_delete" ON sites FOR DELETE TO authenticated USING (is_admin());

-- warehouses
CREATE POLICY "warehouses_read" ON warehouses FOR SELECT TO authenticated USING (true);
CREATE POLICY "warehouses_write" ON warehouses FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "warehouses_update" ON warehouses FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "warehouses_delete" ON warehouses FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- Site-scoped reads + permissive writes (RPC-mutated tables)
-- ============================================================

-- sales
CREATE POLICY "sales_read" ON sales FOR SELECT TO authenticated
  USING (is_global_role() OR site_id = user_site_id());
CREATE POLICY "sales_write" ON sales FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sales_update" ON sales FOR UPDATE TO authenticated USING (true);

-- sale_items
CREATE POLICY "sale_items_read" ON sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "sale_items_write" ON sale_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sale_items_update" ON sale_items FOR UPDATE TO authenticated USING (true);

-- pos_shifts
CREATE POLICY "pos_shifts_read" ON pos_shifts FOR SELECT TO authenticated
  USING (is_global_role() OR site_id = user_site_id());
CREATE POLICY "pos_shifts_write" ON pos_shifts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pos_shifts_update" ON pos_shifts FOR UPDATE TO authenticated USING (true);

-- cash_movements
CREATE POLICY "cash_movements_read" ON cash_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "cash_movements_write" ON cash_movements FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cash_movements_update" ON cash_movements FOR UPDATE TO authenticated USING (true);

-- accounting_entries
CREATE POLICY "accounting_entries_read" ON accounting_entries FOR SELECT TO authenticated
  USING (is_global_role() OR site_id = user_site_id());
CREATE POLICY "accounting_entries_write" ON accounting_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "accounting_entries_update" ON accounting_entries FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- RPC-mutated stock tables (permissive — server actions authorize)
-- ============================================================

-- product_stock
CREATE POLICY "product_stock_read" ON product_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "product_stock_write" ON product_stock FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "product_stock_update" ON product_stock FOR UPDATE TO authenticated USING (true);

-- transfers
CREATE POLICY "transfers_read" ON transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "transfers_write" ON transfers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "transfers_update" ON transfers FOR UPDATE TO authenticated USING (true);

-- transfer_items
CREATE POLICY "transfer_items_read" ON transfer_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "transfer_items_write" ON transfer_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "transfer_items_update" ON transfer_items FOR UPDATE TO authenticated USING (true);

-- stock_movements
CREATE POLICY "movements_read_authenticated" ON stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "movements_insert_authenticated" ON stock_movements FOR INSERT TO authenticated WITH CHECK (true);

-- site_counters
CREATE POLICY "counters_read_authenticated" ON site_counters FOR SELECT TO authenticated USING (true);
CREATE POLICY "counters_update_authenticated" ON site_counters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- Inventory adjustments — admin/encargado write
-- ============================================================

CREATE POLICY "inventory_adjustments_read" ON inventory_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_adjustments_write" ON inventory_adjustments FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "inventory_adjustments_update" ON inventory_adjustments FOR UPDATE TO authenticated USING (is_admin_or_encargado());

CREATE POLICY "adjustment_items_read" ON adjustment_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "adjustment_items_write" ON adjustment_items FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "adjustment_items_update" ON adjustment_items FOR UPDATE TO authenticated USING (is_admin_or_encargado());

-- ============================================================
-- Customers — all read/write, admin-only delete
-- ============================================================

CREATE POLICY "customers_read" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers_write" ON customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "customers_delete" ON customers FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- Suspended sales — all read/write, admin/encargado delete
-- ============================================================

CREATE POLICY "suspended_sales_read" ON suspended_sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "suspended_sales_write" ON suspended_sales FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "suspended_sales_delete" ON suspended_sales FOR DELETE TO authenticated USING (true);

-- ============================================================
-- Promotion products — all read, admin/encargado write
-- ============================================================

CREATE POLICY "promo_products_read" ON promotion_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "promo_products_write" ON promotion_products FOR INSERT TO authenticated WITH CHECK (is_admin_or_encargado());
CREATE POLICY "promo_products_delete" ON promotion_products FOR DELETE TO authenticated USING (is_admin_or_encargado());

-- === scripts/03_storage.sql ===

-- ============================================================================
-- POS-SOLCRAFT — Storage
-- Bucket público "product-media" para imágenes de productos
-- (lib/inventory-actions.ts → uploadProductMedia).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-media', 'product-media', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

-- Lectura pública (las URLs de imagen se usan en el POS y catálogos)
DROP POLICY IF EXISTS "public_read_product_media" ON storage.objects;
CREATE POLICY "public_read_product_media" ON storage.objects
    FOR SELECT USING (bucket_id = 'product-media');

-- Escritura solo para usuarios autenticados
DROP POLICY IF EXISTS "authenticated_write_product_media" ON storage.objects;
CREATE POLICY "authenticated_write_product_media" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-media');

DROP POLICY IF EXISTS "authenticated_update_product_media" ON storage.objects;
CREATE POLICY "authenticated_update_product_media" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS "authenticated_delete_product_media" ON storage.objects;
CREATE POLICY "authenticated_delete_product_media" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'product-media');

-- === scripts/04_seed.sql ===

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

-- === scripts/06_transfer_reception.sql ===

-- ============================================================
-- POS-SOLCRAFT — Recepción de traslados con checklist
-- Fase 2.1: Traslados con tránsito y recepción por checklist
-- ============================================================

-- 1. Add reception columns to transfers
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES auth.users(id);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES auth.users(id);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

-- 2. Add status check constraint
ALTER TABLE transfers ADD CONSTRAINT transfers_status_check
  CHECK (status IN ('pendiente','en_transito','recibido','recibido_con_pendiente','cancelado','completed'));

-- 3. Change default status for new transfers
ALTER TABLE transfers ALTER COLUMN status SET DEFAULT 'en_transito';

-- 4. Add quantity_received to transfer_items
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS quantity_received INTEGER DEFAULT 0;

-- 5. Backfill existing completed transfers (they were already received)
UPDATE transfer_items SET quantity_received = quantity
WHERE quantity_received IS NULL;

-- 6. Index for fast lookup of pending transfers by destination
CREATE INDEX IF NOT EXISTS idx_transfers_status_to ON transfers (to_warehouse_id, status);

-- ============================================================
-- RPC: send stock through transit warehouse
-- Source → -qty (traslado_salida), Transit → +qty (transito_entrada)
-- ============================================================
CREATE OR REPLACE FUNCTION send_transfer_via_transit(
    p_product_id UUID,
    p_from_warehouse_id UUID,
    p_transit_warehouse_id UUID,
    p_quantity INTEGER,
    p_reference_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'La cantidad a trasladar debe ser mayor que cero.';
    END IF;
    -- Deduct from source
    PERFORM adjust_warehouse_stock(
        p_product_id, p_from_warehouse_id, -p_quantity,
        'traslado_salida', 'transfer', p_reference_id, p_user_id
    );
    -- Add to transit
    PERFORM adjust_warehouse_stock(
        p_product_id, p_transit_warehouse_id, p_quantity,
        'transito_entrada', 'transfer', p_reference_id, p_user_id
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RPC: receive stock from transit to destination
-- Transit → -qty (transito_salida), Destination → +qty (traslado_entrada)
-- ============================================================
CREATE OR REPLACE FUNCTION receive_transfer_item(
    p_product_id UUID,
    p_transit_warehouse_id UUID,
    p_to_warehouse_id UUID,
    p_quantity INTEGER,
    p_reference_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'La cantidad recibida debe ser mayor que cero.';
    END IF;
    -- Deduct from transit
    PERFORM adjust_warehouse_stock(
        p_product_id, p_transit_warehouse_id, -p_quantity,
        'transito_salida', 'transfer', p_reference_id, p_user_id
    );
    -- Add to destination
    PERFORM adjust_warehouse_stock(
        p_product_id, p_to_warehouse_id, p_quantity,
        'traslado_entrada', 'transfer', p_reference_id, p_user_id
    );
END;
$$ LANGUAGE plpgsql;

-- === scripts/13b_drift_wompi_local.sql ===

-- ###############################################################
-- ##                                                           ##
-- ##  ⚠️  LOCAL-ONLY — NO APLICAR EN PROD  ⚠️                  ##
-- ##                                                           ##
-- ##  Existe SOLO para reproducir el esquema real de prod      ##
-- ##  en el stack docker de desarrollo (supabase start).       ##
-- ##                                                           ##
-- ##  En prod estos objetos ya existen (con más columnas,      ##
-- ##  índices, RLS y triggers que este mínimo).                ##
-- ##                                                           ##
-- ##  Aplicarlo en prod: mejor caso = sobrescribe RPCs con     ##
-- ##  versiones simplificadas y rompe el flujo real.           ##
-- ##  Peor caso = pierde datos si CREATE TABLE choca con la    ##
-- ##  versión existente.                                       ##
-- ##                                                           ##
-- ##  Ver PLAN-PENDIENTES.md · M14 (drift versionado a         ##
-- ##  cerrar como scripts/15_web_orders_and_wompi_schema.sql). ##
-- ##                                                           ##
-- ###############################################################

-- =============================================================================
-- 13b_drift_wompi_local.sql — reproducción mínima de esquema Wompi para tests.
--
-- Alcance: solo lo que las 3 RPCs sensibles (apply_wompi_transaction,
-- set_web_order_payment_reference, log_payment_event) leen o escriben. FKs a
-- customers/sites/sales omitidos porque los tests no los necesitan.
-- =============================================================================

BEGIN;

-- payment_events (bitácora del webhook)
CREATE TABLE IF NOT EXISTS payment_events (
  event_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         TEXT DEFAULT 'wompi',
  transaction_id   TEXT,
  reference        TEXT,
  event_type       TEXT,
  status           TEXT,
  amount_in_cents  BIGINT,
  raw_payload      JSONB,
  signature_valid  BOOLEAN,
  processed        BOOLEAN DEFAULT FALSE,
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- web_orders (pedidos del storefront público) — mínimo funcional
CREATE TABLE IF NOT EXISTS web_orders (
  order_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               SERIAL,
  order_number         TEXT,
  total                NUMERIC NOT NULL,
  status               TEXT DEFAULT 'pending_payment',
  payment_status       TEXT DEFAULT 'pending',
  payment_method       TEXT DEFAULT 'wompi',
  wompi_reference      TEXT,
  wompi_transaction_id TEXT,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Grants base para las 3 RPCs (sin esto no funcionan bajo el rol authenticated)
GRANT ALL ON payment_events TO postgres, service_role;
GRANT SELECT, INSERT ON payment_events TO authenticated, anon;
GRANT ALL ON web_orders TO postgres, service_role;
GRANT SELECT, UPDATE ON web_orders TO authenticated, anon;
GRANT USAGE ON SEQUENCE web_orders_numero_seq TO authenticated, anon, service_role;

-- ----------------------------------------------------------------------------
-- 3 RPCs — DDL copiado literal de prod (pg_get_functiondef) 2026-08-03.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_wompi_transaction(p_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_expected BIGINT;
  v_new_payment_status TEXT;
BEGIN
  SELECT * INTO v_order FROM web_orders WHERE wompi_reference = p_reference;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Referencia desconocida: ' || p_reference);
  END IF;
  IF v_order.payment_status = 'approved' AND v_order.wompi_transaction_id = p_transaction_id THEN
    RETURN json_build_object('success', true, 'already_applied', true, 'order_number', v_order.order_number);
  END IF;
  v_expected := (v_order.total * 100)::BIGINT;
  IF p_amount_in_cents IS NOT NULL AND p_amount_in_cents <> v_expected THEN
    RETURN json_build_object('error', format('Monto no coincide: recibido %s, esperado %s.', p_amount_in_cents, v_expected));
  END IF;
  v_new_payment_status := CASE upper(p_status)
    WHEN 'APPROVED' THEN 'approved' WHEN 'DECLINED' THEN 'declined'
    WHEN 'VOIDED'   THEN 'voided'   WHEN 'ERROR'    THEN 'error'
    ELSE 'pending'
  END;
  UPDATE web_orders SET
    payment_status = v_new_payment_status,
    wompi_transaction_id = p_transaction_id,
    paid_at = CASE WHEN v_new_payment_status = 'approved' THEN NOW() ELSE paid_at END,
    status = CASE
               WHEN v_new_payment_status = 'approved' AND status = 'pending_payment' THEN 'paid'
               WHEN v_new_payment_status IN ('declined','error','voided') AND status = 'pending_payment' THEN 'pending_payment'
               ELSE status
             END,
    updated_at = NOW()
  WHERE order_id = v_order.order_id;
  RETURN json_build_object('success', true, 'order_number', v_order.order_number, 'payment_status', v_new_payment_status);
END $function$;

CREATE OR REPLACE FUNCTION public.set_web_order_payment_reference(p_order_id uuid, p_reference text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM web_orders WHERE order_id = p_order_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Pedido no encontrado.'); END IF;
  IF v_order.payment_status = 'approved' THEN
    RETURN json_build_object('error', 'Este pedido ya fue pagado.');
  END IF;
  UPDATE web_orders SET wompi_reference = p_reference, payment_method = 'wompi', updated_at = NOW()
  WHERE order_id = p_order_id;
  RETURN json_build_object('success', true, 'reference', p_reference, 'amount_in_cents', (v_order.total * 100)::BIGINT);
END $function$;

CREATE OR REPLACE FUNCTION public.log_payment_event(p_transaction_id text, p_reference text, p_event_type text, p_status text, p_amount_in_cents bigint, p_raw jsonb, p_signature_valid boolean, p_processed boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO payment_events (transaction_id, reference, event_type, status, amount_in_cents, raw_payload, signature_valid, processed, error_message)
  VALUES (p_transaction_id, p_reference, p_event_type, p_status, p_amount_in_cents, p_raw, p_signature_valid, p_processed, p_error);
$function$;

-- Grants iniciales (los mismos que tiene prod hoy — luego 14 los revoca)
GRANT EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) TO anon, authenticated, service_role;

-- Seed: 1 pedido pendiente que los tests usan
INSERT INTO web_orders (order_id, order_number, total, wompi_reference)
VALUES ('99999999-9999-9999-9999-999999999999', 'WEB-TEST-001', 150000, 'REF-TEST-001')
ON CONFLICT (order_id) DO NOTHING;

COMMIT;

-- === scripts/08_perf_fk_indexes.sql ===

-- 08_perf_fk_indexes.sql
-- Aplicada a la DB el 31/07/2026 (migración 08_perf_fk_indexes).
-- Resuelve el advisor "unindexed_foreign_keys": 24 foreign keys de tablas
-- calientes (stock_movements, sales, transfer_items, pos_shifts, ...) no tenían
-- índice de cobertura, causando seq scans en kardex, ventas por sede y recepción
-- de traslados. Índices no destructivos, idempotentes.

CREATE INDEX IF NOT EXISTS idx_accounting_entries_sale ON public.accounting_entries(sale_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_items_adjustment ON public.adjustment_items(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_items_product ON public.adjustment_items(product_id);
CREATE INDEX IF NOT EXISTS idx_business_settings_updated_by ON public.business_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_online_order_items_product ON public.online_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_handled_by ON public.online_orders(handled_by);
CREATE INDEX IF NOT EXISTS idx_online_orders_sale ON public.online_orders(sale_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_warehouse ON public.online_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_warehouse ON public.pos_shifts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_images_created_by ON public.product_images(created_by);
CREATE INDEX IF NOT EXISTS idx_product_prices_price_list ON public.product_prices(price_list_id);
CREATE INDEX IF NOT EXISTS idx_promotion_products_product ON public.promotion_products(product_id);
CREATE INDEX IF NOT EXISTS idx_promotions_site ON public.promotions(site_id);
CREATE INDEX IF NOT EXISTS idx_sales_warehouse ON public.sales(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_user ON public.stock_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON public.stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_suspended_sales_customer ON public.suspended_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_suspended_sales_suspended_by ON public.suspended_sales(suspended_by);
CREATE INDEX IF NOT EXISTS idx_transfer_items_product ON public.transfer_items(product_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON public.transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfers_received_by ON public.transfers(received_by);
CREATE INDEX IF NOT EXISTS idx_transfers_sent_by ON public.transfers(sent_by);
CREATE INDEX IF NOT EXISTS idx_web_order_items_product ON public.web_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_web_orders_sale ON public.web_orders(sale_id);

-- === scripts/10_security_fix_function_search_path.sql ===

-- 10_security_fix_function_search_path.sql
-- Aplicada a la DB el 31/07/2026 (migración 10_security_fix_function_search_path).
-- Resuelve el advisor "Function Search Path Mutable" (34 funciones): un search_path
-- mutable permite ataques de shadowing de esquema contra funciones SECURITY DEFINER.
-- Fija un search_path explícito que cubre los esquemas que cualquier función podría
-- tocar (public: tablas; auth: users/identities; extensions: crypt/gen_salt), sin
-- romper la resolución de nombres. Idempotente: omite funciones que ya lo tienen.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, auth, extensions, pg_temp',
      r.proname, r.args
    );
  END LOOP;
END $$;

-- === scripts/11_rls_initplan_and_permissive_cleanup.sql ===

-- 11_rls_initplan_and_permissive_cleanup.sql
-- Aplicada a la DB el 31/07/2026 (migración 11_rls_initplan_and_permissive_cleanup).
-- P2 (auth_rls_initplan): auth.uid()/is_admin() se re-evaluaban por fila. Se envuelven
--   en (select ...) para que Postgres los evalúe una sola vez por consulta.
-- P3 (multiple_permissive_policies): las políticas ALL (*_write) solapaban SELECT con
--   las read_own. Se separan en INSERT/UPDATE/DELETE para dejar un solo path de SELECT.
-- La semántica de autorización es idéntica a la original.

-- ===== user_profiles =====
DROP POLICY IF EXISTS users_read_own ON public.user_profiles;
CREATE POLICY users_read_own ON public.user_profiles
  FOR SELECT TO authenticated
  USING ((id = (select auth.uid())) OR (select is_admin()));

DROP POLICY IF EXISTS users_admin_write ON public.user_profiles;
CREATE POLICY users_admin_write_ins ON public.user_profiles
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY users_admin_write_upd ON public.user_profiles
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY users_admin_write_del ON public.user_profiles
  FOR DELETE TO authenticated USING ((select is_admin()));

-- ===== user_sites =====
DROP POLICY IF EXISTS user_sites_read_own ON public.user_sites;
CREATE POLICY user_sites_read_own ON public.user_sites
  FOR SELECT TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()));

DROP POLICY IF EXISTS user_sites_admin_write ON public.user_sites;
CREATE POLICY user_sites_admin_write_ins ON public.user_sites
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY user_sites_admin_write_upd ON public.user_sites
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY user_sites_admin_write_del ON public.user_sites
  FOR DELETE TO authenticated USING ((select is_admin()));

-- ===== customer_accounts =====
DROP POLICY IF EXISTS customer_accounts_read_own ON public.customer_accounts;
CREATE POLICY customer_accounts_read_own ON public.customer_accounts
  FOR SELECT TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()));

DROP POLICY IF EXISTS customer_accounts_write ON public.customer_accounts;
CREATE POLICY customer_accounts_write_ins ON public.customer_accounts
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = (select auth.uid())) OR (select is_admin()));
CREATE POLICY customer_accounts_write_upd ON public.customer_accounts
  FOR UPDATE TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()))
  WITH CHECK ((user_id = (select auth.uid())) OR (select is_admin()));
CREATE POLICY customer_accounts_write_del ON public.customer_accounts
  FOR DELETE TO authenticated
  USING ((user_id = (select auth.uid())) OR (select is_admin()));

-- === scripts/12_fix_low_stock_use_product_stock.sql ===

-- 12_fix_low_stock_use_product_stock.sql
-- Aplicada a la DB el 01/08/2026 (migración 12b_fix_low_stock_clean).
-- BUG (Módulo A): get_low_stock_products leía products.stock_quantity, una columna
-- legacy que quedó congelada en 0 mientras el stock real vive en product_stock
-- (fuente de verdad derivada del kardex). El reporte de bajo stock devolvía datos
-- falsos (todo en 0). Se reescribe para agregar el stock real por producto sobre
-- las bodegas de venta (excluye bodegas de sistema como Tránsito).
--
-- Nota: esta función y products.stock_quantity solo alimentaban código no enganchado
-- a la UI (getDashboardStats / componente DashboardStats / decrement_product_stock).
-- El dashboard en producción usa lib/dashboard-actions.ts, que ya lee product_stock.
CREATE OR REPLACE FUNCTION public.get_low_stock_products(threshold integer DEFAULT 10)
 RETURNS TABLE(product_id uuid, name character varying, stock_quantity integer, price numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
BEGIN
    RETURN QUERY
    SELECT p.product_id, p.name, COALESCE(s.qty, 0)::integer AS stock_quantity, p.price
    FROM products p
    LEFT JOIN (
        SELECT ps.product_id, SUM(ps.quantity) AS qty
        FROM product_stock ps
        JOIN warehouses w ON w.warehouse_id = ps.warehouse_id
        WHERE COALESCE(w.is_system, false) = false
        GROUP BY ps.product_id
    ) s ON s.product_id = p.product_id
    WHERE COALESCE(p.is_service, false) = false
      AND COALESCE(s.qty, 0) <= threshold
    ORDER BY 3 ASC, p.name ASC;
END;
$function$;

-- === scripts/13_shifts_to_secdef_rpc.sql ===

-- =============================================================================
-- 13_shifts_to_secdef_rpc.sql  —  Paso 1 de S1 (cierre RLS de escritura).
--
-- Migra las 3 operaciones de turno/caja que hoy escriben directo a las tablas
-- (`pos_shifts`, `cash_movements`) desde Server Actions sin `requireRole()`,
-- a RPCs `SECURITY DEFINER` con validación de rol/sede DENTRO de la función.
--
-- No cambia lógica de negocio; recolecta la validación que faltaba en el
-- wrapper (shift-actions.ts) hacia el propio RPC, cerrando el bypass posible
-- desde cualquier `authenticated`.
--
-- No toca create_sale / void_sale / adjust_warehouse_stock — eso va en un
-- paso 2 separado.
--
-- Rollback: DROP FUNCTION de los tres al final del archivo, comentado.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1) open_shift
-- =============================================================================
CREATE OR REPLACE FUNCTION open_shift(
    p_site_id      UUID,
    p_warehouse_id UUID,
    p_initial_cash NUMERIC,
    p_bank_base    TEXT DEFAULT NULL,
    p_opened_by    TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role       TEXT;
    v_user_site  UUID;
    v_shift_id   UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;

    v_role      := user_role();
    v_user_site := user_site_id();

    IF v_role IS NULL OR v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para abrir turno.';
    END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM p_site_id THEN
        RAISE EXCEPTION 'Solo puedes abrir turno en tu sede.';
    END IF;
    IF p_initial_cash IS NULL OR p_initial_cash < 0 THEN
        RAISE EXCEPTION 'La base inicial no puede ser negativa.';
    END IF;
    IF EXISTS (SELECT 1 FROM pos_shifts WHERE site_id = p_site_id AND status = 'open') THEN
        RAISE EXCEPTION 'Ya hay un turno abierto en esta sede.';
    END IF;

    INSERT INTO pos_shifts (site_id, warehouse_id, initial_cash, bank_base, opened_by, status)
    VALUES (p_site_id, p_warehouse_id, p_initial_cash,
            COALESCE(p_bank_base,'Caja general'), p_opened_by, 'open')
    RETURNING shift_id INTO v_shift_id;

    RETURN v_shift_id;
END;
$$;

REVOKE ALL     ON FUNCTION open_shift(UUID,UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION open_shift(UUID,UUID,NUMERIC,TEXT,TEXT) TO authenticated;

-- =============================================================================
-- 2) add_cash_movement
-- =============================================================================
CREATE OR REPLACE FUNCTION add_cash_movement(
    p_shift_id    UUID,
    p_type        TEXT,   -- 'income' | 'expense' | 'refund'
    p_amount      NUMERIC,
    p_description TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role      TEXT;
    v_user_site UUID;
    v_shift     RECORD;
    v_mov_id    UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para registrar movimientos de caja.';
    END IF;
    IF p_type NOT IN ('income','expense','refund') THEN
        RAISE EXCEPTION 'Tipo de movimiento inválido.';
    END IF;
    IF p_amount IS NULL OR p_amount < 0 THEN
        RAISE EXCEPTION 'El monto no puede ser negativo.';
    END IF;

    SELECT site_id, status INTO v_shift FROM pos_shifts WHERE shift_id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno no encontrado.';
    END IF;
    IF v_shift.status <> 'open' THEN
        RAISE EXCEPTION 'El turno está cerrado.';
    END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM v_shift.site_id THEN
        RAISE EXCEPTION 'Solo puedes registrar movimientos en tu sede.';
    END IF;

    INSERT INTO cash_movements (shift_id, type, amount, description)
    VALUES (p_shift_id, p_type, p_amount, p_description)
    RETURNING movement_id INTO v_mov_id;

    RETURN v_mov_id;
END;
$$;

REVOKE ALL     ON FUNCTION add_cash_movement(UUID,TEXT,NUMERIC,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION add_cash_movement(UUID,TEXT,NUMERIC,TEXT) TO authenticated;

-- =============================================================================
-- 3) close_shift  —  computa expected_cash dentro de la función.
--     Replica classifyMethod('cash'): payment_method ILIKE '%efectivo%' O '%cash%'.
-- =============================================================================
CREATE OR REPLACE FUNCTION close_shift(
    p_shift_id     UUID,
    p_counted_cash NUMERIC,
    p_closed_by    TEXT DEFAULT NULL,
    p_notes        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role       TEXT;
    v_user_site  UUID;
    v_shift      RECORD;
    v_cash_sales NUMERIC := 0;
    v_cash_in    NUMERIC := 0;
    v_cash_out   NUMERIC := 0;
    v_refunds    NUMERIC := 0;
    v_expected   NUMERIC;
    v_diff       NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para cerrar turno.';
    END IF;
    IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
        RAISE EXCEPTION 'El efectivo contado no puede ser negativo.';
    END IF;

    SELECT * INTO v_shift FROM pos_shifts WHERE shift_id = p_shift_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turno no encontrado.'; END IF;
    IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'El turno ya está cerrado.'; END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM v_shift.site_id THEN
        RAISE EXCEPTION 'Solo puedes cerrar turnos de tu sede.';
    END IF;

    -- Paridad 1:1 con buildBalance() en TS: NO filtramos por status. Ventas
    -- anuladas del turno cuentan igual que el path viejo. Registro de la
    -- mejora pendiente (excluir anuladas consistentemente) vive en
    -- PLAN-PENDIENTES.md ("Excluir ventas anuladas del expected_cash").
    SELECT COALESCE(SUM(total_amount), 0) INTO v_cash_sales
    FROM sales
    WHERE shift_id = p_shift_id
      AND (payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%');

    SELECT
        COALESCE(SUM(amount) FILTER (WHERE type='income'), 0),
        COALESCE(SUM(amount) FILTER (WHERE type='expense'), 0),
        COALESCE(SUM(amount) FILTER (WHERE type='refund'), 0)
    INTO v_cash_in, v_cash_out, v_refunds
    FROM cash_movements WHERE shift_id = p_shift_id;

    v_expected := COALESCE(v_shift.initial_cash, 0) + v_cash_sales + v_cash_in - v_cash_out - v_refunds;
    v_diff     := p_counted_cash - v_expected;

    UPDATE pos_shifts SET
        status        = 'closed',
        closed_at     = NOW(),
        closed_by     = p_closed_by,
        counted_cash  = p_counted_cash,
        expected_cash = v_expected,
        difference    = v_diff,
        notes         = p_notes
    WHERE shift_id = p_shift_id;

    RETURN jsonb_build_object(
        'shift_id',      p_shift_id,
        'expected_cash', v_expected,
        'counted_cash',  p_counted_cash,
        'difference',    v_diff
    );
END;
$$;

REVOKE ALL     ON FUNCTION close_shift(UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION close_shift(UUID,NUMERIC,TEXT,TEXT) TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK (correr manualmente si algo se rompe. Los Server Actions viejos ya
-- no llaman a estas RPC — necesitas también revertir los cambios en
-- lib/shift-actions.ts a la versión previa; sin eso, la app queda apuntando a
-- funciones inexistentes).
--
-- DROP FUNCTION IF EXISTS open_shift(UUID,UUID,NUMERIC,TEXT,TEXT);
-- DROP FUNCTION IF EXISTS add_cash_movement(UUID,TEXT,NUMERIC,TEXT);
-- DROP FUNCTION IF EXISTS close_shift(UUID,NUMERIC,TEXT,TEXT);
-- =============================================================================

-- === scripts/14_s3p0_wompi_rpc_service_role.sql ===

-- =============================================================================
-- 14_s3p0_wompi_rpc_service_role.sql — Hotfix S3-P0.
--
-- Bloquea EXECUTE anon/authenticated en las 3 RPCs del flujo pago/pedido web
-- que hoy son SECURITY DEFINER expuestas por defecto. Solo service_role puede
-- invocarlas — los server-side callers (webhook Wompi y Server Actions de
-- checkout) deben usar el SUPABASE_SERVICE_ROLE_KEY.
--
-- CONTEXTO
--   apply_wompi_transaction: P0 crítico — anon puede marcar cualquier orden
--     como pagada sin firma HMAC. Aunque el route handler valida firma, la
--     RPC en sí no; anon la llama directo /rest/v1/rpc/apply_wompi_transaction.
--   set_web_order_payment_reference: P1 — anon puede setear wompi_reference de
--     cualquier order_id (UUID). Amplifica el vector anterior.
--   log_payment_event: bajar privilegio como buena higiene. Sólo el webhook la
--     usa; nadie más debería poder ensuciar la bitácora de pagos.
--
-- ORDEN DE APLICACIÓN
--   Este archivo se aplica DESPUÉS de que el refactor del caller (webhook +
--   wompi-actions) esté deployado en Vercel usando service_role. Sin el
--   refactor deployado primero, este REVOKE tumba el flujo de pago web real.
--
-- ROLLBACK: bloque comentado al final.
-- =============================================================================

BEGIN;

-- 1) apply_wompi_transaction
REVOKE EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) TO service_role;

-- 2) set_web_order_payment_reference
REVOKE EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) TO service_role;

-- 3) log_payment_event
REVOKE EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) TO service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (correr manualmente si necesitas devolver anon/authenticated).
--   Solo tiene sentido si el refactor del webhook fue revertido antes; con el
--   refactor aplicado, el webhook usa service_role y no necesita anon.
--
-- GRANT EXECUTE ON FUNCTION apply_wompi_transaction(text, text, text, bigint) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION set_web_order_payment_reference(uuid, text) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION log_payment_event(text, text, text, text, bigint, jsonb, boolean, boolean, text) TO anon, authenticated;
-- =============================================================================
