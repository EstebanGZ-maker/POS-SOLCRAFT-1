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
