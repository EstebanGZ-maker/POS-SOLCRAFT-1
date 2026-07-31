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
