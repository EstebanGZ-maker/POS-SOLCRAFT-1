CREATE OR REPLACE FUNCTION decrement_product_stock(p_product_id UUID, p_quantity INT)
RETURNS VOID AS $$
BEGIN
  UPDATE Products
  SET stock_quantity = stock_quantity - p_quantity
  WHERE product_id = p_product_id;
END;
$$ LANGUAGE plpgsql;
