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
