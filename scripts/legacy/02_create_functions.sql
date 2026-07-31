-- Function to decrement product stock
CREATE OR REPLACE FUNCTION decrement_product_stock(p_product_id UUID, p_quantity INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE products
    SET stock_quantity = stock_quantity - p_quantity,
        updated_at = NOW()
    WHERE product_id = p_product_id
    AND stock_quantity >= p_quantity;
    
    -- Check if the update affected any rows
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', p_product_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get low stock products
CREATE OR REPLACE FUNCTION get_low_stock_products(threshold INTEGER DEFAULT 10)
RETURNS TABLE(
    product_id UUID,
    name VARCHAR(255),
    stock_quantity INTEGER,
    price NUMERIC(10, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.product_id, p.name, p.stock_quantity, p.price
    FROM products p
    WHERE p.stock_quantity <= threshold
    ORDER BY p.stock_quantity ASC, p.name ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to get sales summary by date range
CREATE OR REPLACE FUNCTION get_sales_summary(
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE(
    total_sales BIGINT,
    total_amount NUMERIC(10, 2),
    avg_sale_amount NUMERIC(10, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_sales,
        COALESCE(SUM(s.total_amount), 0) as total_amount,
        COALESCE(AVG(s.total_amount), 0) as avg_sale_amount
    FROM sales s
    WHERE s.sale_date >= start_date AND s.sale_date <= end_date;
END;
$$ LANGUAGE plpgsql;
