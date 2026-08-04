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
