-- ==========================================================================
-- POS-SOLCRAFT — Baseline canónico capturado desde prod (nxszaxwsrtlofqimbfig)
-- Fecha de captura: 2026-08-12    PostgreSQL 17.6.1
-- Método: introspección directa de pg_catalog + information_schema (read-only).
-- Orden: extensions → sequences → tables (PK/UNIQUE/CHECK inline; FK diferidos)
--        → sequence ownership → FKs → functions → triggers → views
--        → ENABLE RLS → policies → indexes → grants/revokes.
-- ==========================================================================

-- ---- Extensions --------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA vault;

-- ---- Sequences (creation; ownership after tables) ---------------------
CREATE SEQUENCE IF NOT EXISTS public.pos_shifts_number_seq AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.web_orders_numero_seq AS integer;

-- ---- Tables ------------------------------------------------------------
CREATE TABLE public.sites (
  "site_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "code" varchar(20) NOT NULL,
  "is_central" boolean DEFAULT false NOT NULL,
  "address" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT sites_pkey PRIMARY KEY (site_id),
  CONSTRAINT sites_code_key UNIQUE (code)
);

CREATE TABLE public.categories (
  "category_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT categories_pkey PRIMARY KEY (category_id),
  CONSTRAINT categories_name_key UNIQUE (name)
);

CREATE TABLE public.price_lists (
  "price_list_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT price_lists_pkey PRIMARY KEY (price_list_id)
);

CREATE TABLE public.customers (
  "customer_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "email" varchar(255),
  "phone" varchar(30),
  "id_type" varchar(30),
  "id_number" varchar(40),
  "first_name" varchar(80),
  "second_name" varchar(80),
  "last_names" varchar(160),
  "city_state" varchar(160),
  "address" text,
  "postal_code" varchar(20),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "is_wholesale" boolean DEFAULT false NOT NULL,
  CONSTRAINT customers_pkey PRIMARY KEY (customer_id),
  CONSTRAINT customers_email_key UNIQUE (email)
);

CREATE TABLE public.business_settings (
  "id" integer DEFAULT 1 NOT NULL,
  "business_name" text DEFAULT 'SOLCRAFT'::text NOT NULL,
  "legal_name" text,
  "tax_id" text,
  "phone" text,
  "email" text,
  "regime" text DEFAULT 'Responsable de IVA'::text,
  "address" text,
  "logo_url" text,
  "legal_footer" text DEFAULT 'Este documento se asimila en todos sus efectos a una letra de cambio de conformidad con el Art. 774 del código de comercio.'::text,
  "custom_phrase" text,
  "template_style" text DEFAULT 'clasico'::text NOT NULL,
  "header_alignment" text DEFAULT 'center'::text NOT NULL,
  "paper_width_mm" integer DEFAULT 80 NOT NULL,
  "margin_left_mm" integer DEFAULT 2 NOT NULL,
  "margin_right_mm" integer DEFAULT 2 NOT NULL,
  "show_description" boolean DEFAULT false NOT NULL,
  "show_unit_price" boolean DEFAULT true NOT NULL,
  "show_logo" boolean DEFAULT false NOT NULL,
  "group_product_data" boolean DEFAULT false NOT NULL,
  "show_unit_of_measure" boolean DEFAULT false NOT NULL,
  "show_lines_summary" boolean DEFAULT true NOT NULL,
  "show_tax_summary" boolean DEFAULT true NOT NULL,
  "show_customer_id" boolean DEFAULT true NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "updated_by" uuid,
  "shipping_cost" numeric(12,2) DEFAULT 0 NOT NULL,
  "free_shipping_over" numeric(12,2),
  "whatsapp_number" text,
  "whatsapp_enabled" boolean DEFAULT true NOT NULL,
  "cod_enabled" boolean DEFAULT true NOT NULL,
  "wompi_enabled" boolean DEFAULT false NOT NULL,
  "wompi_public_key" text,
  "pickup_enabled" boolean DEFAULT true NOT NULL,
  "delivery_enabled" boolean DEFAULT true NOT NULL,
  "wompi_sandbox" boolean DEFAULT true NOT NULL,
  CONSTRAINT business_settings_header_alignment_check CHECK ((header_alignment = ANY (ARRAY['left'::text, 'center'::text, 'right'::text]))),
  CONSTRAINT business_settings_id_check CHECK ((id = 1)),
  CONSTRAINT business_settings_paper_width_mm_check CHECK ((paper_width_mm = ANY (ARRAY[57, 58, 80]))),
  CONSTRAINT business_settings_template_style_check CHECK ((template_style = ANY (ARRAY['clasico'::text, 'moderno'::text, 'minimal'::text]))),
  CONSTRAINT business_settings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.online_order_counter (
  "id" integer DEFAULT 1 NOT NULL,
  "last_number" integer DEFAULT 0 NOT NULL,
  CONSTRAINT online_order_counter_id_check CHECK ((id = 1)),
  CONSTRAINT online_order_counter_pkey PRIMARY KEY (id)
);

CREATE TABLE public.payment_events (
  "event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "provider" text DEFAULT 'wompi'::text NOT NULL,
  "transaction_id" text,
  "reference" text,
  "event_type" text,
  "status" text,
  "amount_in_cents" bigint,
  "raw_payload" jsonb,
  "signature_valid" boolean,
  "processed" boolean DEFAULT false NOT NULL,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT payment_events_pkey PRIMARY KEY (event_id)
);

CREATE TABLE public.warehouses (
  "warehouse_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  CONSTRAINT warehouses_pkey PRIMARY KEY (warehouse_id)
);

CREATE TABLE public.user_profiles (
  "id" uuid NOT NULL,
  "email" text NOT NULL,
  "full_name" text,
  "role" text DEFAULT 'vendedor'::text NOT NULL,
  "site_id" uuid,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "permissions" text[] DEFAULT '{}'::text[] NOT NULL,
  CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'contador'::text, 'encargado'::text, 'vendedor'::text]))),
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_sites (
  "user_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT user_sites_pkey PRIMARY KEY (user_id, site_id)
);

CREATE TABLE public.customer_accounts (
  "user_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT customer_accounts_pkey PRIMARY KEY (user_id)
);

CREATE TABLE public.site_counters (
  "site_id" uuid NOT NULL,
  "last_numero" integer DEFAULT 0 NOT NULL,
  CONSTRAINT site_counters_pkey PRIMARY KEY (site_id)
);

CREATE TABLE public.products (
  "product_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "code" varchar(60),
  "barcode" varchar(120),
  "type_prefix" varchar(4),
  "description" text,
  "category_id" uuid,
  "unit" varchar(40) DEFAULT 'Unidad'::character varying NOT NULL,
  "cost" numeric(12,2) DEFAULT 0 NOT NULL,
  "price" numeric(12,2) NOT NULL,
  "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
  "is_service" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_favorite" boolean DEFAULT false NOT NULL,
  "size" varchar(20),
  "image_url" text,
  "stock_quantity" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "wholesale_price" numeric(12,2),
  CONSTRAINT products_cost_check CHECK ((cost >= (0)::numeric)),
  CONSTRAINT products_price_check CHECK ((price >= (0)::numeric)),
  CONSTRAINT products_tax_rate_check CHECK ((tax_rate >= (0)::numeric)),
  CONSTRAINT products_pkey PRIMARY KEY (product_id),
  CONSTRAINT products_code_key UNIQUE (code)
);

CREATE TABLE public.promotions (
  "promotion_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text,
  "discount_percent" numeric(5,2) NOT NULL,
  "start_date" date,
  "end_date" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "site_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT promotions_discount_percent_check CHECK (((discount_percent > (0)::numeric) AND (discount_percent <= (100)::numeric))),
  CONSTRAINT promotions_pkey PRIMARY KEY (promotion_id)
);

CREATE TABLE public.product_stock (
  "product_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "min_quantity" integer,
  "max_quantity" integer,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT product_stock_quantity_check CHECK ((quantity >= 0)),
  CONSTRAINT product_stock_pkey PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE public.product_prices (
  "product_id" uuid NOT NULL,
  "price_list_id" uuid NOT NULL,
  "price" numeric(12,2) NOT NULL,
  CONSTRAINT product_prices_price_check CHECK ((price >= (0)::numeric)),
  CONSTRAINT product_prices_pkey PRIMARY KEY (product_id, price_list_id)
);

CREATE TABLE public.product_images (
  "image_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "url" text NOT NULL,
  "storage_path" text,
  "alt_text" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  CONSTRAINT product_images_pkey PRIMARY KEY (image_id)
);

CREATE TABLE public.promotion_products (
  "promotion_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  CONSTRAINT promotion_products_pkey PRIMARY KEY (promotion_id, product_id)
);

CREATE TABLE public.inventory_adjustments (
  "adjustment_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "notes" text,
  "total_adjusted" numeric(14,2) DEFAULT 0 NOT NULL,
  "adjustment_date" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT inventory_adjustments_pkey PRIMARY KEY (adjustment_id)
);

CREATE TABLE public.pos_shifts (
  "shift_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "number" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "site_id" uuid NOT NULL,
  "warehouse_id" uuid,
  "status" varchar(10) DEFAULT 'open'::character varying NOT NULL,
  "initial_cash" numeric(12,2) DEFAULT 0 NOT NULL,
  "bank_base" varchar(120),
  "opened_by" text,
  "opened_at" timestamptz DEFAULT now() NOT NULL,
  "closed_at" timestamptz,
  "closed_by" text,
  "counted_cash" numeric(12,2),
  "expected_cash" numeric(12,2),
  "difference" numeric(12,2),
  "notes" text,
  CONSTRAINT pos_shifts_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[]))),
  CONSTRAINT pos_shifts_pkey PRIMARY KEY (shift_id)
);

CREATE TABLE public.stock_movements (
  "movement_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "movement_type" text NOT NULL,
  "quantity" integer NOT NULL,
  "reference_type" text,
  "reference_id" uuid,
  "user_id" uuid,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['apertura'::text, 'compra'::text, 'venta'::text, 'traslado_salida'::text, 'traslado_entrada'::text, 'transito_entrada'::text, 'transito_salida'::text, 'ajuste'::text, 'devolucion'::text, 'reserva_online'::text, 'liberacion_online'::text]))),
  CONSTRAINT stock_movements_pkey PRIMARY KEY (movement_id)
);

CREATE TABLE public.transfers (
  "transfer_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "from_warehouse_id" uuid NOT NULL,
  "to_warehouse_id" uuid NOT NULL,
  "notes" text,
  "status" text DEFAULT 'pendiente'::text NOT NULL,
  "transfer_date" timestamptz DEFAULT now() NOT NULL,
  "sent_by" uuid,
  "received_by" uuid,
  "received_at" timestamptz,
  CONSTRAINT transfers_status_check CHECK ((status = ANY (ARRAY['pendiente'::text, 'en_transito'::text, 'recibido'::text, 'recibido_con_pendiente'::text, 'cancelado'::text]))),
  CONSTRAINT transfers_pkey PRIMARY KEY (transfer_id)
);

CREATE TABLE public.suspended_sales (
  "suspended_sale_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL,
  "customer_id" uuid,
  "price_list" text DEFAULT 'general'::text,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "suspended_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT suspended_sales_pkey PRIMARY KEY (suspended_sale_id)
);

CREATE TABLE public.adjustment_items (
  "adjustment_item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "adjustment_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "cost" numeric(12,2) DEFAULT 0 NOT NULL,
  "objective" varchar(12) NOT NULL,
  "quantity" integer NOT NULL,
  CONSTRAINT adjustment_items_objective_check CHECK (((objective)::text = ANY ((ARRAY['incrementar'::character varying, 'disminuir'::character varying])::text[]))),
  CONSTRAINT adjustment_items_quantity_check CHECK ((quantity > 0)),
  CONSTRAINT adjustment_items_pkey PRIMARY KEY (adjustment_item_id)
);

CREATE TABLE public.transfer_items (
  "transfer_item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "transfer_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "quantity_received" integer DEFAULT 0,
  CONSTRAINT transfer_items_quantity_check CHECK ((quantity > 0)),
  CONSTRAINT transfer_items_pkey PRIMARY KEY (transfer_item_id)
);

CREATE TABLE public.cash_movements (
  "movement_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "shift_id" uuid NOT NULL,
  "type" varchar(10) NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "description" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT cash_movements_amount_check CHECK ((amount >= (0)::numeric)),
  CONSTRAINT cash_movements_type_check CHECK (((type)::text = ANY ((ARRAY['income'::character varying, 'expense'::character varying, 'refund'::character varying])::text[]))),
  CONSTRAINT cash_movements_pkey PRIMARY KEY (movement_id)
);

CREATE TABLE public.sales (
  "sale_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL,
  "sale_date" timestamptz DEFAULT now() NOT NULL,
  "total_amount" numeric(12,2) NOT NULL,
  "payment_method" varchar(60),
  "amount_received" numeric(12,2),
  "seller" text,
  "notes" text,
  "site_id" uuid,
  "warehouse_id" uuid,
  "shift_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "numero" integer,
  "status" text DEFAULT 'active'::text NOT NULL,
  "subtotal" numeric(12,2),
  "discount_total" numeric(12,2) DEFAULT 0 NOT NULL,
  "tax_total" numeric(12,2) DEFAULT 0 NOT NULL,
  CONSTRAINT sales_status_check CHECK ((status = ANY (ARRAY['active'::text, 'voided'::text]))),
  CONSTRAINT sales_total_amount_check CHECK ((total_amount >= (0)::numeric)),
  CONSTRAINT sales_pkey PRIMARY KEY (sale_id)
);

CREATE TABLE public.web_orders (
  "order_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "numero" integer DEFAULT nextval('web_orders_numero_seq'::regclass) NOT NULL,
  "customer_id" uuid,
  "guest_name" text NOT NULL,
  "guest_phone" text NOT NULL,
  "guest_email" text,
  "guest_id_type" text,
  "guest_id_number" text,
  "shipping_address" text NOT NULL,
  "shipping_city" text,
  "shipping_notes" text,
  "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
  "discount_total" numeric(12,2) DEFAULT 0 NOT NULL,
  "tax_total" numeric(12,2) DEFAULT 0 NOT NULL,
  "shipping_cost" numeric(12,2) DEFAULT 0 NOT NULL,
  "total" numeric(12,2) NOT NULL,
  "fulfillment_site_id" uuid,
  "sale_id" uuid,
  "status" text DEFAULT 'pending_payment'::text NOT NULL,
  "payment_method" text DEFAULT 'whatsapp'::text NOT NULL,
  "payment_reference" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "delivery_method" text DEFAULT 'delivery'::text NOT NULL,
  "order_number" text,
  "payment_status" text DEFAULT 'pending'::text NOT NULL,
  "wompi_transaction_id" text,
  "wompi_reference" text,
  "paid_at" timestamptz,
  CONSTRAINT web_orders_delivery_method_check CHECK ((delivery_method = ANY (ARRAY['pickup'::text, 'delivery'::text]))),
  CONSTRAINT web_orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['whatsapp'::text, 'transfer'::text, 'gateway'::text, 'cod'::text, 'wompi'::text]))),
  CONSTRAINT web_orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'voided'::text, 'error'::text]))),
  CONSTRAINT web_orders_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'preparing'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text]))),
  CONSTRAINT web_orders_pkey PRIMARY KEY (order_id),
  CONSTRAINT web_orders_numero_key UNIQUE (numero),
  CONSTRAINT web_orders_order_number_key UNIQUE (order_number),
  CONSTRAINT web_orders_wompi_reference_key UNIQUE (wompi_reference)
);

CREATE TABLE public.online_orders (
  "order_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_number" text NOT NULL,
  "customer_name" text NOT NULL,
  "customer_phone" text NOT NULL,
  "customer_email" text,
  "customer_id_number" text,
  "delivery_method" text NOT NULL,
  "site_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "address" text,
  "city" text,
  "notes" text,
  "payment_method" text NOT NULL,
  "payment_status" text DEFAULT 'pending'::text NOT NULL,
  "payment_reference" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
  "discount_total" numeric(12,2) DEFAULT 0 NOT NULL,
  "tax_total" numeric(12,2) DEFAULT 0 NOT NULL,
  "shipping_cost" numeric(12,2) DEFAULT 0 NOT NULL,
  "total" numeric(12,2) DEFAULT 0 NOT NULL,
  "sale_id" uuid,
  "handled_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "cancelled_at" timestamptz,
  "cancelled_reason" text,
  CONSTRAINT online_orders_delivery_method_check CHECK ((delivery_method = ANY (ARRAY['pickup'::text, 'delivery'::text]))),
  CONSTRAINT online_orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['whatsapp'::text, 'cod'::text, 'wompi'::text]))),
  CONSTRAINT online_orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text]))),
  CONSTRAINT online_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'preparing'::text, 'ready'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text]))),
  CONSTRAINT online_orders_pkey PRIMARY KEY (order_id),
  CONSTRAINT online_orders_order_number_key UNIQUE (order_number)
);

CREATE TABLE public.sale_items (
  "sale_item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sale_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "discount" numeric(5,2) DEFAULT 0 NOT NULL,
  "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
  CONSTRAINT sale_items_quantity_check CHECK ((quantity > 0)),
  CONSTRAINT sale_items_unit_price_check CHECK ((unit_price >= (0)::numeric)),
  CONSTRAINT sale_items_pkey PRIMARY KEY (sale_item_id)
);

CREATE TABLE public.accounting_entries (
  "entry_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL,
  "entry_type" varchar(10) NOT NULL,
  "category" varchar(120),
  "description" text,
  "amount" numeric(14,2) NOT NULL,
  "sale_id" uuid,
  "entry_date" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT accounting_entries_amount_check CHECK ((amount >= (0)::numeric)),
  CONSTRAINT accounting_entries_entry_type_check CHECK (((entry_type)::text = ANY ((ARRAY['income'::character varying, 'expense'::character varying])::text[]))),
  CONSTRAINT accounting_entries_pkey PRIMARY KEY (entry_id)
);

CREATE TABLE public.web_order_items (
  "order_item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "product_code" text,
  "product_name" text,
  "quantity" integer NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "base_price" numeric(12,2) NOT NULL,
  "discount" numeric(5,2) DEFAULT 0 NOT NULL,
  "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
  CONSTRAINT web_order_items_quantity_check CHECK ((quantity > 0)),
  CONSTRAINT web_order_items_pkey PRIMARY KEY (order_item_id)
);

CREATE TABLE public.online_order_items (
  "order_item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "product_name" text NOT NULL,
  "product_code" text NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "base_price" numeric(12,2) NOT NULL,
  "discount" numeric(5,2) DEFAULT 0 NOT NULL,
  "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
  "subtotal" numeric(12,2) NOT NULL,
  CONSTRAINT online_order_items_quantity_check CHECK ((quantity > 0)),
  CONSTRAINT online_order_items_pkey PRIMARY KEY (order_item_id)
);

-- ---- Sequence ownership ------------------------------------------------
ALTER SEQUENCE public.web_orders_numero_seq OWNED BY public.web_orders.numero;

-- ---- Foreign keys ------------------------------------------------------
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE CASCADE;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE SET NULL;
ALTER TABLE public.user_sites ADD CONSTRAINT user_sites_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE CASCADE;
ALTER TABLE public.user_sites ADD CONSTRAINT user_sites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.customer_accounts ADD CONSTRAINT customer_accounts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE;
ALTER TABLE public.customer_accounts ADD CONSTRAINT customer_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.site_counters ADD CONSTRAINT site_counters_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE SET NULL;
ALTER TABLE public.promotions ADD CONSTRAINT promotions_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE SET NULL;
ALTER TABLE public.product_stock ADD CONSTRAINT product_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE;
ALTER TABLE public.product_stock ADD CONSTRAINT product_stock_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id) ON DELETE CASCADE;
ALTER TABLE public.product_prices ADD CONSTRAINT product_prices_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES price_lists(price_list_id) ON DELETE CASCADE;
ALTER TABLE public.product_prices ADD CONSTRAINT product_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE;
ALTER TABLE public.product_images ADD CONSTRAINT product_images_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.product_images ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE;
ALTER TABLE public.promotion_products ADD CONSTRAINT promotion_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE;
ALTER TABLE public.promotion_products ADD CONSTRAINT promotion_products_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES promotions(promotion_id) ON DELETE CASCADE;
ALTER TABLE public.inventory_adjustments ADD CONSTRAINT inventory_adjustments_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id) ON DELETE CASCADE;
ALTER TABLE public.pos_shifts ADD CONSTRAINT pos_shifts_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE CASCADE;
ALTER TABLE public.pos_shifts ADD CONSTRAINT pos_shifts_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id);
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id);
ALTER TABLE public.transfers ADD CONSTRAINT transfers_from_warehouse_id_fkey FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT;
ALTER TABLE public.transfers ADD CONSTRAINT transfers_received_by_fkey FOREIGN KEY (received_by) REFERENCES auth.users(id);
ALTER TABLE public.transfers ADD CONSTRAINT transfers_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES auth.users(id);
ALTER TABLE public.transfers ADD CONSTRAINT transfers_to_warehouse_id_fkey FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT;
ALTER TABLE public.suspended_sales ADD CONSTRAINT suspended_sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(customer_id);
ALTER TABLE public.suspended_sales ADD CONSTRAINT suspended_sales_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id);
ALTER TABLE public.suspended_sales ADD CONSTRAINT suspended_sales_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES auth.users(id);
ALTER TABLE public.adjustment_items ADD CONSTRAINT adjustment_items_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments(adjustment_id) ON DELETE CASCADE;
ALTER TABLE public.adjustment_items ADD CONSTRAINT adjustment_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT;
ALTER TABLE public.transfer_items ADD CONSTRAINT transfer_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT;
ALTER TABLE public.transfer_items ADD CONSTRAINT transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES transfers(transfer_id) ON DELETE CASCADE;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES pos_shifts(shift_id) ON DELETE CASCADE;
ALTER TABLE public.sales ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT;
ALTER TABLE public.sales ADD CONSTRAINT sales_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES pos_shifts(shift_id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD CONSTRAINT sales_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD CONSTRAINT sales_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id) ON DELETE SET NULL;
ALTER TABLE public.web_orders ADD CONSTRAINT web_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(customer_id);
ALTER TABLE public.web_orders ADD CONSTRAINT web_orders_fulfillment_site_id_fkey FOREIGN KEY (fulfillment_site_id) REFERENCES sites(site_id);
ALTER TABLE public.web_orders ADD CONSTRAINT web_orders_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(sale_id);
ALTER TABLE public.online_orders ADD CONSTRAINT online_orders_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES auth.users(id);
ALTER TABLE public.online_orders ADD CONSTRAINT online_orders_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(sale_id);
ALTER TABLE public.online_orders ADD CONSTRAINT online_orders_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id);
ALTER TABLE public.online_orders ADD CONSTRAINT online_orders_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id);
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE;
ALTER TABLE public.accounting_entries ADD CONSTRAINT accounting_entries_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE SET NULL;
ALTER TABLE public.accounting_entries ADD CONSTRAINT accounting_entries_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE CASCADE;
ALTER TABLE public.web_order_items ADD CONSTRAINT web_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES web_orders(order_id) ON DELETE CASCADE;
ALTER TABLE public.web_order_items ADD CONSTRAINT web_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id);
ALTER TABLE public.online_order_items ADD CONSTRAINT online_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES online_orders(order_id) ON DELETE CASCADE;
ALTER TABLE public.online_order_items ADD CONSTRAINT online_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id);

-- ---- Functions / RPCs (pg_get_functiondef verbatim) --------------------
-- Function: handle_new_user()  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'vendedor')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END; $function$;

-- Function: has_permission(p_module text)  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.has_permission(p_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT
    is_admin()
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND p_module = ANY(permissions)
    );
$function$;

-- Function: has_site_access(p_site_id uuid)  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.has_site_access(p_site_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT
    is_global_role()
    OR EXISTS (SELECT 1 FROM user_sites WHERE user_id = auth.uid() AND site_id = p_site_id)
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND site_id = p_site_id);
$function$;

-- Function: is_admin()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
  );
$function$;

-- Function: is_admin_or_encargado()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.is_admin_or_encargado()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'encargado')
  );
$function$;

-- Function: is_global_role()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.is_global_role()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'contador')
  );
$function$;

-- Function: set_web_order_number()  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.set_web_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NEW.order_number IS NULL THEN
    NEW.order_number := 'WEB-' || lpad(NEW.numero::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END $function$;

-- Function: sync_product_primary_image()  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.sync_product_primary_image()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product UUID := COALESCE(NEW.product_id, OLD.product_id);
  v_url TEXT;
BEGIN
  SELECT url INTO v_url
  FROM product_images
  WHERE product_id = v_product
  ORDER BY is_primary DESC, sort_order, created_at
  LIMIT 1;

  UPDATE products SET image_url = v_url WHERE product_id = v_product;
  RETURN NULL;
END $function$;

-- Function: update_updated_at_column()  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- Function: user_accessible_sites()  secdef=true  vol=s  lang=plpgsql
CREATE OR REPLACE FUNCTION public.user_accessible_sites()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM user_sites WHERE user_id = auth.uid()) THEN
    RETURN QUERY SELECT site_id FROM user_sites WHERE user_id = auth.uid();
  ELSE
    RETURN QUERY SELECT site_id FROM user_profiles
      WHERE id = auth.uid() AND site_id IS NOT NULL;
  END IF;
END; $function$;

-- Function: user_role()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$function$;

-- Function: user_site_id()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.user_site_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT site_id FROM user_profiles WHERE id = auth.uid();
$function$;

-- Function: add_cash_movement(p_shift_id uuid, p_type text, p_amount numeric, p_description text)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.add_cash_movement(p_shift_id uuid, p_type text, p_amount numeric, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Function: adjust_warehouse_stock(p_product_id uuid, p_warehouse_id uuid, p_delta integer, p_movement_type text, p_reference_type text, p_reference_id uuid, p_user_id uuid, p_notes text)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.adjust_warehouse_stock(p_product_id uuid, p_warehouse_id uuid, p_delta integer, p_movement_type text DEFAULT NULL::text, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- Function: admin_create_user(p_email text, p_password text, p_full_name text, p_role text, p_site_id uuid)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.admin_create_user(p_email text, p_password text, p_full_name text, p_role text DEFAULT 'vendedor'::text, p_site_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
BEGIN
  -- Only admin can call this
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN json_build_object('error', 'Solo el administrador puede crear usuarios.');
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'contador', 'encargado', 'vendedor') THEN
    RETURN json_build_object('error', 'Rol inválido.');
  END IF;

  -- Check email not already taken
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(p_email)) THEN
    RETURN json_build_object('error', 'Ya existe un usuario con ese correo.');
  END IF;

  -- Generate UUID
  v_user_id := gen_random_uuid();

  -- Encrypt password using Supabase's method
  v_encrypted_pw := crypt(p_password, gen_salt('bf'));

  -- Insert into auth.users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new,
    email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated',
    lower(p_email), v_encrypted_pw,
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_full_name)::jsonb,
    '', '', '', ''
  );

  -- Insert identity for email provider
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, lower(p_email),
    json_build_object('sub', v_user_id::text, 'email', lower(p_email))::jsonb,
    'email', NOW(), NOW(), NOW()
  );

  -- Upsert user_profiles (trigger may have created one already)
  INSERT INTO user_profiles (id, email, full_name, role, site_id, is_active)
  VALUES (v_user_id, lower(p_email), p_full_name, p_role, p_site_id, TRUE)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    site_id = EXCLUDED.site_id;

  RETURN json_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', lower(p_email)
  );
END;
$function$;

-- Function: admin_reset_password(p_user_id uuid, p_new_password text)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_encrypted_pw TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN json_build_object('error', 'Solo el administrador puede cambiar contraseñas.');
  END IF;

  IF length(p_new_password) < 6 THEN
    RETURN json_build_object('error', 'La contraseña debe tener al menos 6 caracteres.');
  END IF;

  v_encrypted_pw := crypt(p_new_password, gen_salt('bf'));

  UPDATE auth.users
  SET encrypted_password = v_encrypted_pw, updated_at = NOW()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Usuario no encontrado.');
  END IF;

  RETURN json_build_object('success', true);
END;
$function$;

-- Function: apply_wompi_transaction(p_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint)  secdef=true  vol=v  lang=plpgsql
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

  -- Idempotencia
  IF v_order.payment_status = 'approved' AND v_order.wompi_transaction_id = p_transaction_id THEN
    RETURN json_build_object('success', true, 'already_applied', true,
                             'order_number', v_order.order_number);
  END IF;

  -- El monto debe coincidir exactamente
  v_expected := (v_order.total * 100)::BIGINT;
  IF p_amount_in_cents IS NOT NULL AND p_amount_in_cents <> v_expected THEN
    RETURN json_build_object('error',
      format('Monto no coincide: recibido %s, esperado %s.', p_amount_in_cents, v_expected));
  END IF;

  v_new_payment_status := CASE upper(p_status)
    WHEN 'APPROVED' THEN 'approved'
    WHEN 'DECLINED' THEN 'declined'
    WHEN 'VOIDED'   THEN 'voided'
    WHEN 'ERROR'    THEN 'error'
    ELSE 'pending'
  END;

  UPDATE web_orders SET
    payment_status = v_new_payment_status,
    wompi_transaction_id = p_transaction_id,
    paid_at = CASE WHEN v_new_payment_status = 'approved' THEN NOW() ELSE paid_at END,
    -- Solo avanza el estado del pedido cuando el pago se aprueba
    status = CASE
               WHEN v_new_payment_status = 'approved' AND status = 'pending_payment' THEN 'paid'
               WHEN v_new_payment_status IN ('declined','error','voided') AND status = 'pending_payment' THEN 'pending_payment'
               ELSE status
             END,
    updated_at = NOW()
  WHERE order_id = v_order.order_id;

  RETURN json_build_object(
    'success', true,
    'order_number', v_order.order_number,
    'payment_status', v_new_payment_status
  );
END $function$;

-- Function: close_shift(p_shift_id uuid, p_counted_cash numeric, p_closed_by text, p_notes text)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.close_shift(p_shift_id uuid, p_counted_cash numeric, p_closed_by text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Function: create_sale(p_customer_id uuid, p_total_amount numeric, p_items jsonb, p_payment_method text, p_amount_received numeric, p_seller text, p_notes text, p_site_id uuid, p_warehouse_id uuid, p_shift_id uuid, p_user_id uuid)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.create_sale(p_customer_id uuid, p_total_amount numeric, p_items jsonb, p_payment_method text DEFAULT NULL::text, p_amount_received numeric DEFAULT NULL::numeric, p_seller text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_site_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_shift_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_sale_id UUID;
    v_item RECORD;
    v_is_service BOOLEAN;
    v_numero INTEGER;
    v_subtotal NUMERIC := 0;
    v_discount_total NUMERIC := 0;
    v_tax_total NUMERIC := 0;
    v_line_base NUMERIC;
    v_line_after_disc NUMERIC;
    v_line_tax NUMERIC;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La venta no tiene productos.';
    END IF;
    IF p_total_amount < 0 THEN
        RAISE EXCEPTION 'El total de la venta no puede ser negativo.';
    END IF;

    IF p_site_id IS NOT NULL THEN
        UPDATE site_counters SET last_numero = last_numero + 1
        WHERE site_id = p_site_id RETURNING last_numero INTO v_numero;
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
            (i ->> 'unit_price')::NUMERIC AS unit_price,
            COALESCE((i ->> 'base_price')::NUMERIC, 0) AS base_price,
            COALESCE((i ->> 'discount')::NUMERIC, 0)   AS discount,
            COALESCE((i ->> 'tax_rate')::NUMERIC, 0)   AS tax_rate
        FROM jsonb_array_elements(p_items) AS i
    LOOP
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Cantidad inválida en la venta.';
        END IF;

        INSERT INTO sale_items (
            sale_id, product_id, quantity, unit_price, discount, tax_rate
        ) VALUES (
            v_sale_id, v_item.product_id, v_item.quantity,
            COALESCE(v_item.unit_price, 0), v_item.discount, v_item.tax_rate
        );

        -- Acumular subtotal / descuento / IVA
        v_line_base       := v_item.base_price * v_item.quantity;
        v_line_after_disc := v_line_base * (1 - v_item.discount / 100);
        v_line_tax        := v_line_after_disc * (v_item.tax_rate / 100);

        v_subtotal       := v_subtotal + v_line_base;
        v_discount_total := v_discount_total + (v_line_base - v_line_after_disc);
        v_tax_total      := v_tax_total + v_line_tax;

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

    UPDATE sales
    SET subtotal = v_subtotal,
        discount_total = v_discount_total,
        tax_total = v_tax_total
    WHERE sale_id = v_sale_id;

    IF p_site_id IS NOT NULL THEN
        INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            p_site_id, 'income', 'Ventas POS',
            'Venta #' || COALESCE(v_numero::TEXT, LEFT(v_sale_id::TEXT, 8)) ||
                COALESCE(' - ' || p_payment_method, ''),
            p_total_amount, v_sale_id
        );
    END IF;

    RETURN v_sale_id;
END;
$function$;

-- Function: create_web_order(p_items jsonb, p_guest_name text, p_guest_phone text, p_guest_email text, p_guest_id_type text, p_guest_id_number text, p_shipping_address text, p_shipping_city text, p_shipping_notes text, p_notes text, p_customer_id uuid)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.create_web_order(p_items jsonb, p_guest_name text, p_guest_phone text, p_guest_email text DEFAULT NULL::text, p_guest_id_type text DEFAULT NULL::text, p_guest_id_number text DEFAULT NULL::text, p_shipping_address text DEFAULT NULL::text, p_shipping_city text DEFAULT NULL::text, p_shipping_notes text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id UUID := gen_random_uuid();
  v_numero INTEGER;
  v_item RECORD;
  v_prod RECORD;
  v_line_base NUMERIC;
  v_line_after_disc NUMERIC;
  v_line_tax NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_ship NUMERIC := 0;
  v_ship_free NUMERIC;
  v_grand NUMERIC;
  v_customer_id UUID := p_customer_id;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('error', 'El pedido no tiene productos.');
  END IF;
  IF coalesce(trim(p_guest_name),'') = '' OR coalesce(trim(p_guest_phone),'') = '' THEN
    RETURN json_build_object('error', 'Nombre y teléfono son obligatorios.');
  END IF;
  IF coalesce(trim(p_shipping_address),'') = '' THEN
    RETURN json_build_object('error', 'La dirección de envío es obligatoria.');
  END IF;

  -- Upsert de cliente por teléfono (o cédula) — así el admin lo tiene en la agenda
  IF v_customer_id IS NULL THEN
    SELECT customer_id INTO v_customer_id
    FROM customers
    WHERE phone = p_guest_phone
       OR (p_guest_id_number IS NOT NULL AND id_number = p_guest_id_number)
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      INSERT INTO customers (name, phone, email, id_type, id_number, address, city_state)
      VALUES (p_guest_name, p_guest_phone, p_guest_email, p_guest_id_type,
              p_guest_id_number, p_shipping_address, p_shipping_city)
      RETURNING customer_id INTO v_customer_id;
    ELSE
      -- Refresca datos por si cambió algo
      UPDATE customers
      SET name = COALESCE(NULLIF(p_guest_name,''), name),
          email = COALESCE(NULLIF(p_guest_email,''), email),
          address = COALESCE(NULLIF(p_shipping_address,''), address),
          city_state = COALESCE(NULLIF(p_shipping_city,''), city_state),
          updated_at = NOW()
      WHERE customer_id = v_customer_id;
    END IF;
  END IF;

  -- Insert cabecera provisional (total se recalcula)
  INSERT INTO web_orders (
    order_id, customer_id, guest_name, guest_phone, guest_email,
    guest_id_type, guest_id_number, shipping_address, shipping_city, shipping_notes,
    total, notes, payment_method
  ) VALUES (
    v_order_id, v_customer_id, p_guest_name, p_guest_phone, p_guest_email,
    p_guest_id_type, p_guest_id_number, p_shipping_address, p_shipping_city, p_shipping_notes,
    0, p_notes, 'whatsapp'
  ) RETURNING numero INTO v_numero;

  -- Iterar items, validar producto activo y calcular
  FOR v_item IN
    SELECT (i ->> 'product_id')::UUID AS product_id,
           (i ->> 'quantity')::INTEGER AS quantity
    FROM jsonb_array_elements(p_items) AS i
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida.';
    END IF;

    SELECT product_id, code, name, price, tax_rate, is_active
      INTO v_prod
    FROM products WHERE product_id = v_item.product_id;

    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Producto no disponible: %', v_item.product_id;
    END IF;

    v_line_base       := v_prod.price * v_item.quantity;
    v_line_after_disc := v_line_base;   -- sin descuentos en pedidos web MVP
    v_line_tax        := v_line_after_disc * (COALESCE(v_prod.tax_rate,0) / 100);
    v_line_total      := v_line_after_disc + v_line_tax;

    v_subtotal := v_subtotal + v_line_base;
    v_tax      := v_tax + v_line_tax;

    INSERT INTO web_order_items (
      order_id, product_id, product_code, product_name,
      quantity, unit_price, base_price, discount, tax_rate
    ) VALUES (
      v_order_id, v_prod.product_id, v_prod.code, v_prod.name,
      v_item.quantity,
      v_prod.price * (1 + COALESCE(v_prod.tax_rate,0) / 100),
      v_prod.price, 0, COALESCE(v_prod.tax_rate, 0)
    );
  END LOOP;

  -- Envío
  SELECT shipping_cost, free_shipping_over
    INTO v_ship, v_ship_free
  FROM business_settings WHERE id = 1;

  IF v_ship_free IS NOT NULL AND v_subtotal + v_tax >= v_ship_free THEN
    v_ship := 0;
  END IF;

  v_grand := v_subtotal - v_discount + v_tax + v_ship;

  UPDATE web_orders
  SET subtotal = v_subtotal,
      discount_total = v_discount,
      tax_total = v_tax,
      shipping_cost = v_ship,
      total = v_grand,
      updated_at = NOW()
  WHERE order_id = v_order_id;

  RETURN json_build_object(
    'success', true,
    'order_id', v_order_id,
    'numero', v_numero,
    'total', v_grand
  );
END $function$;

-- Function: decrement_product_stock(p_product_id uuid, p_quantity integer)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.decrement_product_stock(p_product_id uuid, p_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- Function: fulfill_web_order(p_order_id uuid, p_site_id uuid, p_user_id uuid)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.fulfill_web_order(p_order_id uuid, p_site_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_items JSONB;
  v_warehouse_id UUID;
  v_sale_id UUID;
  v_short RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('admin','encargado') AND is_active
  ) THEN
    RETURN json_build_object('error', 'Solo admin o encargado pueden despachar pedidos.');
  END IF;

  SELECT * INTO v_order FROM web_orders WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Pedido no encontrado.');
  END IF;
  IF v_order.sale_id IS NOT NULL THEN
    RETURN json_build_object('error', 'Este pedido ya fue convertido en venta.');
  END IF;
  IF v_order.status NOT IN ('paid','preparing') THEN
    RETURN json_build_object('error', 'El pedido debe estar pagado o en preparación.');
  END IF;

  SELECT warehouse_id INTO v_warehouse_id
  FROM warehouses WHERE site_id = p_site_id AND is_primary = TRUE LIMIT 1;
  IF v_warehouse_id IS NULL THEN
    RETURN json_build_object('error', 'La sede no tiene bodega principal.');
  END IF;

  -- Validar stock suficiente antes de tocar nada
  SELECT i.product_name, i.quantity, COALESCE(ps.quantity, 0) AS available
    INTO v_short
  FROM web_order_items i
  LEFT JOIN product_stock ps
    ON ps.product_id = i.product_id AND ps.warehouse_id = v_warehouse_id
  JOIN products p ON p.product_id = i.product_id
  WHERE i.order_id = p_order_id
    AND NOT p.is_service
    AND COALESCE(ps.quantity, 0) < i.quantity
  LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object('error',
      format('Stock insuficiente de "%s": hay %s, se necesitan %s.',
             v_short.product_name, v_short.available, v_short.quantity));
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', product_id,
    'quantity', quantity,
    'unit_price', unit_price,
    'base_price', base_price,
    'discount', discount,
    'tax_rate', tax_rate
  )) INTO v_items
  FROM web_order_items WHERE order_id = p_order_id;

  v_sale_id := create_sale(
    v_order.customer_id,
    v_order.total,
    v_items,
    'web-' || v_order.payment_method,
    v_order.total,
    'Pedido web ' || v_order.order_number,
    'Pedido web ' || v_order.order_number ||
      CASE WHEN v_order.delivery_method = 'delivery'
           THEN ' — envío a ' || COALESCE(v_order.shipping_address,'')
           ELSE ' — recoge en tienda' END,
    p_site_id,
    v_warehouse_id,
    NULL,
    p_user_id
  );

  UPDATE web_orders
  SET sale_id = v_sale_id,
      fulfillment_site_id = p_site_id,
      status = 'preparing',
      updated_at = NOW()
  WHERE order_id = p_order_id;

  RETURN json_build_object('success', true, 'sale_id', v_sale_id);
END $function$;

-- Function: get_low_stock_products(threshold integer)  secdef=false  vol=v  lang=plpgsql
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

-- Function: get_sales_summary(start_date timestamp with time zone, end_date timestamp with time zone)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.get_sales_summary(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(total_sales bigint, total_amount numeric, avg_sale_amount numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- Function: list_orphan_product_media()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.list_orphan_product_media()
 RETURNS TABLE(object_name text, bytes bigint, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT o.name::TEXT, ((o.metadata->>'size')::BIGINT), o.created_at
  FROM storage.objects o
  WHERE o.bucket_id = 'product-media'
    AND NOT EXISTS (
      SELECT 1 FROM product_images pi
      WHERE pi.storage_path = o.name OR pi.url LIKE '%' || o.name
    )
    -- margen de seguridad: no tocar subidas en curso
    AND o.created_at < NOW() - INTERVAL '1 hour';
$function$;

-- Function: log_payment_event(p_transaction_id text, p_reference text, p_event_type text, p_status text, p_amount_in_cents bigint, p_raw jsonb, p_signature_valid boolean, p_processed boolean, p_error text)  secdef=true  vol=v  lang=sql
CREATE OR REPLACE FUNCTION public.log_payment_event(p_transaction_id text, p_reference text, p_event_type text, p_status text, p_amount_in_cents bigint, p_raw jsonb, p_signature_valid boolean, p_processed boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO payment_events (
    transaction_id, reference, event_type, status, amount_in_cents,
    raw_payload, signature_valid, processed, error_message
  ) VALUES (
    p_transaction_id, p_reference, p_event_type, p_status, p_amount_in_cents,
    p_raw, p_signature_valid, p_processed, p_error
  );
$function$;

-- Function: next_product_code(p_prefix text, p_size text, p_price_thousands integer)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.next_product_code(p_prefix text, p_size text, p_price_thousands integer)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- Function: open_shift(p_site_id uuid, p_warehouse_id uuid, p_initial_cash numeric, p_bank_base text, p_opened_by text)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.open_shift(p_site_id uuid, p_warehouse_id uuid, p_initial_cash numeric, p_bank_base text DEFAULT NULL::text, p_opened_by text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Function: place_web_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_customer_email text, p_customer_id_number text, p_delivery_method text, p_site_id uuid, p_address text, p_city text, p_notes text, p_payment_method text)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.place_web_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_customer_id_number text DEFAULT NULL::text, p_delivery_method text DEFAULT 'delivery'::text, p_site_id uuid DEFAULT NULL::uuid, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payment_method text DEFAULT 'whatsapp'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id UUID := gen_random_uuid();
  v_numero INTEGER;
  v_order_number TEXT;
  v_item RECORD;
  v_prod RECORD;
  v_available INTEGER;
  v_subtotal NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_ship NUMERIC := 0;
  v_grand NUMERIC;
  v_customer_id UUID;
  v_bs RECORD;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('error', 'El carrito está vacío.');
  END IF;
  IF coalesce(trim(p_customer_name),'') = '' THEN
    RETURN json_build_object('error', 'El nombre es obligatorio.');
  END IF;
  IF length(coalesce(trim(p_customer_phone),'')) < 7 THEN
    RETURN json_build_object('error', 'Se requiere un teléfono válido.');
  END IF;
  IF p_delivery_method NOT IN ('pickup','delivery') THEN
    RETURN json_build_object('error', 'Método de entrega inválido.');
  END IF;
  IF p_payment_method NOT IN ('whatsapp','cod','wompi') THEN
    RETURN json_build_object('error', 'Método de pago inválido.');
  END IF;
  IF p_delivery_method = 'delivery' AND coalesce(trim(p_address),'') = '' THEN
    RETURN json_build_object('error', 'La dirección es obligatoria para envío a domicilio.');
  END IF;
  IF p_delivery_method = 'pickup' AND p_site_id IS NULL THEN
    RETURN json_build_object('error', 'Elige la sede donde recoges el pedido.');
  END IF;

  SELECT * INTO v_bs FROM business_settings WHERE id = 1;

  IF p_delivery_method = 'pickup'  AND NOT COALESCE(v_bs.pickup_enabled, TRUE) THEN
    RETURN json_build_object('error', 'La recogida en tienda no está habilitada.');
  END IF;
  IF p_delivery_method = 'delivery' AND NOT COALESCE(v_bs.delivery_enabled, TRUE) THEN
    RETURN json_build_object('error', 'El envío a domicilio no está habilitado.');
  END IF;
  IF p_payment_method = 'whatsapp' AND NOT COALESCE(v_bs.whatsapp_enabled, TRUE) THEN
    RETURN json_build_object('error', 'El pago vía WhatsApp no está habilitado.');
  END IF;
  IF p_payment_method = 'cod' AND NOT COALESCE(v_bs.cod_enabled, TRUE) THEN
    RETURN json_build_object('error', 'El pago contra entrega no está habilitado.');
  END IF;
  IF p_payment_method = 'wompi' AND NOT COALESCE(v_bs.wompi_enabled, FALSE) THEN
    RETURN json_build_object('error', 'El pago con tarjeta no está habilitado.');
  END IF;

  -- Validar disponibilidad: para pickup en esa sede, para delivery en cualquier
  -- bodega pública. No reserva stock (se descuenta al despachar).
  FOR v_item IN
    SELECT (i ->> 'product_id')::UUID AS product_id,
           (i ->> 'quantity')::INTEGER AS quantity
    FROM jsonb_array_elements(p_items) AS i
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RETURN json_build_object('error', 'Cantidad inválida en el carrito.');
    END IF;

    SELECT product_id, code, name, price, COALESCE(tax_rate,0) AS tax_rate, is_service
      INTO v_prod
    FROM products WHERE product_id = v_item.product_id AND is_active = TRUE;

    IF NOT FOUND THEN
      RETURN json_build_object('error', 'Uno de los productos ya no está disponible.');
    END IF;

    IF NOT v_prod.is_service THEN
      SELECT COALESCE(SUM(ps.quantity), 0) INTO v_available
      FROM product_stock ps
      JOIN warehouses w ON w.warehouse_id = ps.warehouse_id AND w.is_public = TRUE
      WHERE ps.product_id = v_item.product_id
        AND (p_delivery_method = 'delivery' OR w.site_id = p_site_id);

      IF v_available < v_item.quantity THEN
        RETURN json_build_object('error',
          format('Stock insuficiente de "%s": quedan %s unidades.', v_prod.name, v_available));
      END IF;
    END IF;
  END LOOP;

  -- Upsert del cliente
  SELECT customer_id INTO v_customer_id FROM customers
   WHERE phone = p_customer_phone
      OR (p_customer_id_number IS NOT NULL AND id_number = p_customer_id_number)
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (name, phone, email, id_number, address, city_state)
    VALUES (trim(p_customer_name), trim(p_customer_phone), p_customer_email,
            p_customer_id_number, p_address, p_city)
    RETURNING customer_id INTO v_customer_id;
  ELSE
    UPDATE customers SET
      name = COALESCE(NULLIF(trim(p_customer_name),''), name),
      email = COALESCE(NULLIF(p_customer_email,''), email),
      address = COALESCE(NULLIF(p_address,''), address),
      city_state = COALESCE(NULLIF(p_city,''), city_state),
      updated_at = NOW()
    WHERE customer_id = v_customer_id;
  END IF;

  INSERT INTO web_orders (
    order_id, customer_id, guest_name, guest_phone, guest_email,
    guest_id_number, shipping_address, shipping_city,
    delivery_method, fulfillment_site_id, total, notes, payment_method
  ) VALUES (
    v_order_id, v_customer_id, trim(p_customer_name), trim(p_customer_phone), p_customer_email,
    p_customer_id_number, p_address, p_city,
    p_delivery_method,
    CASE WHEN p_delivery_method = 'pickup' THEN p_site_id ELSE NULL END,
    0, p_notes, p_payment_method
  ) RETURNING numero, order_number INTO v_numero, v_order_number;

  FOR v_item IN
    SELECT (i ->> 'product_id')::UUID AS product_id,
           (i ->> 'quantity')::INTEGER AS quantity
    FROM jsonb_array_elements(p_items) AS i
  LOOP
    SELECT product_id, code, name, price, COALESCE(tax_rate,0) AS tax_rate
      INTO v_prod
    FROM products WHERE product_id = v_item.product_id;

    v_subtotal := v_subtotal + v_prod.price * v_item.quantity;
    v_tax := v_tax + v_prod.price * v_item.quantity * (v_prod.tax_rate / 100);

    INSERT INTO web_order_items (
      order_id, product_id, product_code, product_name,
      quantity, unit_price, base_price, discount, tax_rate
    ) VALUES (
      v_order_id, v_prod.product_id, v_prod.code, v_prod.name,
      v_item.quantity,
      v_prod.price * (1 + v_prod.tax_rate / 100),
      v_prod.price, 0, v_prod.tax_rate
    );
  END LOOP;

  IF p_delivery_method = 'delivery' THEN
    v_ship := COALESCE(v_bs.shipping_cost, 0);
    IF v_bs.free_shipping_over IS NOT NULL
       AND (v_subtotal + v_tax) >= v_bs.free_shipping_over THEN
      v_ship := 0;
    END IF;
  END IF;

  v_grand := v_subtotal + v_tax + v_ship;

  UPDATE web_orders SET
    subtotal = v_subtotal, tax_total = v_tax,
    shipping_cost = v_ship, total = v_grand, updated_at = NOW()
  WHERE order_id = v_order_id;

  RETURN json_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'numero', v_numero,
    'total', v_grand
  );
END $function$;

-- Function: public_catalog_business()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_catalog_business()
 RETURNS TABLE(business_name text, phone text, email text, address text, logo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT business_name::TEXT, phone::TEXT, email::TEXT, address::TEXT, logo_url::TEXT
  FROM business_settings WHERE id = 1;
$function$;

-- Function: public_catalog_facets()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_catalog_facets()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'lines', COALESCE((
      SELECT json_agg(json_build_object('code', t.line, 'count', t.n) ORDER BY t.line)
      FROM (
        SELECT type_prefix::TEXT AS line, COUNT(*) AS n
        FROM products WHERE is_active AND type_prefix IS NOT NULL
        GROUP BY type_prefix
      ) t
    ), '[]'::json),
    'sizes', COALESCE((
      SELECT json_agg(DISTINCT size::TEXT ORDER BY size::TEXT)
      FROM products WHERE is_active AND size IS NOT NULL
    ), '[]'::json)
  );
$function$;

-- Function: public_catalog_list(p_site_id uuid, p_search text, p_only_available boolean, p_limit integer, p_offset integer, p_line text, p_size text)  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_catalog_list(p_site_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_only_available boolean DEFAULT false, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_line text DEFAULT NULL::text, p_size text DEFAULT NULL::text)
 RETURNS TABLE(product_id uuid, code text, name text, price numeric, description text, image_url text, line text, size text, available_sites text[], is_available boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  WITH availability AS (
    SELECT
      p.product_id,
      p.code::TEXT AS code,
      p.name::TEXT AS name,
      p.price,
      p.description,
      p.image_url,
      p.type_prefix::TEXT AS line,
      p.size::TEXT AS size,
      COALESCE(
        ARRAY_AGG(DISTINCT s.name::TEXT ORDER BY s.name::TEXT)
          FILTER (WHERE s.name IS NOT NULL AND ps.quantity > 0),
        ARRAY[]::TEXT[]
      ) AS available_sites,
      COALESCE(SUM(CASE
        WHEN p_site_id IS NULL AND ps.quantity > 0 THEN 1
        WHEN p_site_id IS NOT NULL AND s.site_id = p_site_id AND ps.quantity > 0 THEN 1
        ELSE 0 END), 0) > 0 AS is_available
    FROM products p
    LEFT JOIN warehouses w ON w.is_public = TRUE
    LEFT JOIN sites s ON s.site_id = w.site_id
    LEFT JOIN product_stock ps
      ON ps.product_id = p.product_id AND ps.warehouse_id = w.warehouse_id
    WHERE p.is_active = TRUE
    GROUP BY p.product_id, p.code, p.name, p.price, p.description,
             p.image_url, p.type_prefix, p.size
  )
  SELECT *
  FROM availability
  WHERE (p_search IS NULL OR p_search = ''
         OR name ILIKE '%' || p_search || '%'
         OR code ILIKE '%' || p_search || '%')
    AND (p_line IS NULL OR p_line = '' OR line = p_line)
    AND (p_size IS NULL OR p_size = '' OR size = p_size)
    AND (NOT p_only_available OR is_available = TRUE)
  ORDER BY is_available DESC, name
  LIMIT p_limit OFFSET p_offset;
$function$;

-- Function: public_catalog_product(p_code text)  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_catalog_product(p_code text)
 RETURNS TABLE(product_id uuid, code text, name text, price numeric, description text, image_url text, images jsonb, category_name text, available_sites text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT
    p.product_id,
    p.code::TEXT,
    p.name::TEXT,
    p.price,
    p.description,
    p.image_url,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('url', pi.url, 'alt', pi.alt_text)
                       ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at)
      FROM product_images pi WHERE pi.product_id = p.product_id
    ), '[]'::jsonb) AS images,
    c.name::TEXT AS category_name,
    COALESCE(
      ARRAY_AGG(DISTINCT s.name::TEXT ORDER BY s.name::TEXT)
        FILTER (WHERE s.name IS NOT NULL AND ps.quantity > 0),
      ARRAY[]::TEXT[]
    )
  FROM products p
  LEFT JOIN categories c ON c.category_id = p.category_id
  LEFT JOIN warehouses w ON w.is_public = TRUE
  LEFT JOIN sites s ON s.site_id = w.site_id
  LEFT JOIN product_stock ps
    ON ps.product_id = p.product_id AND ps.warehouse_id = w.warehouse_id
  WHERE p.code = p_code AND p.is_active = TRUE
  GROUP BY p.product_id, p.code, p.name, p.price, p.description, p.image_url, c.name;
$function$;

-- Function: public_catalog_sites()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_catalog_sites()
 RETURNS TABLE(site_id uuid, name text, address text, is_central boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT s.site_id, s.name::TEXT, s.address::TEXT, s.is_central
  FROM sites s
  WHERE EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.site_id = s.site_id AND w.is_public = TRUE
  )
  ORDER BY s.is_central DESC, s.name;
$function$;

-- Function: public_commerce_config()  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_commerce_config()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'business_name', business_name,
    'phone', phone,
    'email', email,
    'address', address,
    'logo_url', logo_url,
    'whatsapp_number', whatsapp_number,
    'whatsapp_enabled', COALESCE(whatsapp_enabled, TRUE),
    'cod_enabled', COALESCE(cod_enabled, TRUE),
    'wompi_enabled', COALESCE(wompi_enabled, FALSE),
    'wompi_public_key', wompi_public_key,
    'pickup_enabled', COALESCE(pickup_enabled, TRUE),
    'delivery_enabled', COALESCE(delivery_enabled, TRUE),
    'shipping_cost', COALESCE(shipping_cost, 0),
    'free_shipping_over', free_shipping_over
  )
  FROM business_settings WHERE id = 1;
$function$;

-- Function: public_get_order(p_order_number text, p_phone text)  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_get_order(p_order_number text, p_phone text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'order_id', o.order_id,
    'order_number', o.order_number,
    'numero', o.numero,
    'status', o.status,
    'payment_status', o.payment_status,
    'delivery_method', o.delivery_method,
    'payment_method', o.payment_method,
    'total', o.total,
    'subtotal', o.subtotal,
    'shipping_cost', o.shipping_cost,
    'tax_total', o.tax_total,
    'created_at', o.created_at,
    'paid_at', o.paid_at,
    'customer_name', o.guest_name,
    'address', o.shipping_address,
    'city', o.shipping_city,
    'fulfillment_site', (SELECT s.name FROM sites s WHERE s.site_id = o.fulfillment_site_id),
    'items', COALESCE((
      SELECT json_agg(json_build_object(
        'name', i.product_name, 'code', i.product_code,
        'quantity', i.quantity, 'unit_price', i.unit_price
      )) FROM web_order_items i WHERE i.order_id = o.order_id
    ), '[]'::json)
  )
  FROM web_orders o
  WHERE o.order_number = p_order_number AND o.guest_phone = p_phone
  LIMIT 1;
$function$;

-- Function: public_place_order(p_customer_name text, p_customer_phone text, p_customer_email text, p_customer_id_number text, p_delivery_method text, p_site_id uuid, p_address text, p_city text, p_notes text, p_payment_method text, p_items jsonb)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.public_place_order(p_customer_name text, p_customer_phone text, p_customer_email text, p_customer_id_number text, p_delivery_method text, p_site_id uuid, p_address text, p_city text, p_notes text, p_payment_method text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_order_id UUID := gen_random_uuid();
  v_order_number TEXT;
  v_number INTEGER;
  v_warehouse_id UUID;
  v_item RECORD;
  v_stock INTEGER;
  v_base NUMERIC;
  v_tax NUMERIC;
  v_line_price NUMERIC;
  v_line_subtotal NUMERIC;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_shipping NUMERIC := 0;
  v_settings RECORD;
BEGIN
  -- Validaciones básicas
  IF p_customer_name IS NULL OR length(trim(p_customer_name)) = 0 THEN
    RETURN jsonb_build_object('error', 'Nombre requerido.');
  END IF;
  IF p_customer_phone IS NULL OR length(trim(p_customer_phone)) < 7 THEN
    RETURN jsonb_build_object('error', 'Teléfono válido requerido.');
  END IF;
  IF p_delivery_method NOT IN ('pickup','delivery') THEN
    RETURN jsonb_build_object('error', 'Método de entrega inválido.');
  END IF;
  IF p_payment_method NOT IN ('whatsapp','cod','wompi') THEN
    RETURN jsonb_build_object('error', 'Método de pago inválido.');
  END IF;
  IF p_delivery_method = 'delivery' AND (p_address IS NULL OR length(trim(p_address)) = 0) THEN
    RETURN jsonb_build_object('error', 'La dirección es obligatoria para envío a domicilio.');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('error', 'El carrito está vacío.');
  END IF;

  -- Config del negocio
  SELECT * INTO v_settings FROM business_settings WHERE id = 1;

  -- Validar método habilitado
  IF p_delivery_method = 'pickup' AND NOT v_settings.pickup_enabled THEN
    RETURN jsonb_build_object('error', 'La recogida en tienda no está habilitada.');
  END IF;
  IF p_delivery_method = 'delivery' AND NOT v_settings.delivery_enabled THEN
    RETURN jsonb_build_object('error', 'El envío a domicilio no está habilitado.');
  END IF;
  IF p_payment_method = 'whatsapp' AND NOT v_settings.whatsapp_enabled THEN
    RETURN jsonb_build_object('error', 'El pago vía WhatsApp no está habilitado.');
  END IF;
  IF p_payment_method = 'cod' AND NOT v_settings.cod_enabled THEN
    RETURN jsonb_build_object('error', 'El pago contra entrega no está habilitado.');
  END IF;
  IF p_payment_method = 'wompi' AND NOT v_settings.wompi_enabled THEN
    RETURN jsonb_build_object('error', 'El pago con tarjeta no está habilitado.');
  END IF;

  -- Bodega pública principal de la sede
  SELECT warehouse_id INTO v_warehouse_id
  FROM warehouses
  WHERE site_id = p_site_id AND is_public = TRUE
  ORDER BY is_primary DESC
  LIMIT 1;

  IF v_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('error', 'La sede seleccionada no tiene bodega pública.');
  END IF;

  -- Costo de envío (solo si delivery)
  IF p_delivery_method = 'delivery' THEN
    v_shipping := v_settings.shipping_cost;
  END IF;

  -- Generar número de pedido
  UPDATE online_order_counter
    SET last_number = last_number + 1
    WHERE id = 1
    RETURNING last_number INTO v_number;
  v_order_number := 'WEB-' || LPAD(v_number::TEXT, 6, '0');

  -- Insertar pedido (sin totales aún)
  INSERT INTO online_orders (
    order_id, order_number, customer_name, customer_phone, customer_email,
    customer_id_number, delivery_method, site_id, warehouse_id,
    address, city, notes, payment_method, status
  ) VALUES (
    v_order_id, v_order_number, trim(p_customer_name), trim(p_customer_phone),
    p_customer_email, p_customer_id_number, p_delivery_method, p_site_id,
    v_warehouse_id, p_address, p_city, p_notes, p_payment_method, 'pending'
  );

  -- Procesar ítems: validar stock, calcular precio, reservar
  FOR v_item IN
    SELECT
      (i ->> 'product_id')::UUID AS product_id,
      (i ->> 'quantity')::INTEGER AS quantity
    FROM jsonb_array_elements(p_items) AS i
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida.';
    END IF;

    -- Validar stock disponible en la bodega
    SELECT COALESCE(quantity, 0) INTO v_stock
    FROM product_stock
    WHERE product_id = v_item.product_id AND warehouse_id = v_warehouse_id;

    IF v_stock < v_item.quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para uno de los productos. Solo hay % unidades disponibles.', v_stock;
    END IF;

    -- Precio autorizado por el servidor
    SELECT price, COALESCE(tax_rate, 0), name INTO v_base, v_tax, v_line_subtotal
    FROM products WHERE product_id = v_item.product_id AND is_active = TRUE;

    IF v_base IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado.';
    END IF;

    v_line_price := v_base * (1 + v_tax / 100);
    v_line_subtotal := v_line_price * v_item.quantity;

    INSERT INTO online_order_items (
      order_id, product_id, product_name, product_code,
      quantity, unit_price, base_price, discount, tax_rate, subtotal
    )
    SELECT v_order_id, p.product_id, p.name, p.code,
           v_item.quantity, v_line_price, v_base, 0, v_tax, v_line_subtotal
    FROM products p WHERE p.product_id = v_item.product_id;

    v_subtotal  := v_subtotal + (v_base * v_item.quantity);
    v_tax_total := v_tax_total + (v_base * v_item.quantity * v_tax / 100);

    -- Reservar stock (kardex + saldo)
    PERFORM adjust_warehouse_stock(
      v_item.product_id, v_warehouse_id, -v_item.quantity,
      'reserva_online', 'online_order', v_order_id, NULL
    );
  END LOOP;

  UPDATE online_orders
  SET subtotal = v_subtotal,
      tax_total = v_tax_total,
      shipping_cost = v_shipping,
      total = v_subtotal + v_tax_total + v_shipping
  WHERE order_id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total', v_subtotal + v_tax_total + v_shipping
  );
END; $function$;

-- Function: public_product_sizes(p_code text)  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_product_sizes(p_code text)
 RETURNS TABLE(code text, size text, price numeric, is_available boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT type_prefix, name FROM products WHERE code = p_code AND is_active LIMIT 1
  )
  SELECT
    p.code::TEXT,
    p.size::TEXT,
    p.price,
    COALESCE(SUM(CASE WHEN ps.quantity > 0 THEN 1 ELSE 0 END), 0) > 0 AS is_available
  FROM products p
  JOIN base b ON b.type_prefix IS NOT DISTINCT FROM p.type_prefix
             AND b.name IS NOT DISTINCT FROM p.name
  LEFT JOIN warehouses w ON w.is_public = TRUE
  LEFT JOIN product_stock ps
    ON ps.product_id = p.product_id AND ps.warehouse_id = w.warehouse_id
  WHERE p.is_active = TRUE
  GROUP BY p.code, p.size, p.price
  ORDER BY p.size;
$function$;

-- Function: public_web_order_lookup(p_numero integer, p_phone text)  secdef=true  vol=s  lang=sql
CREATE OR REPLACE FUNCTION public.public_web_order_lookup(p_numero integer, p_phone text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'numero', o.numero,
    'status', o.status,
    'total', o.total,
    'created_at', o.created_at,
    'items', COALESCE((
      SELECT json_agg(json_build_object(
        'name', i.product_name, 'code', i.product_code,
        'quantity', i.quantity, 'unit_price', i.unit_price
      )) FROM web_order_items i WHERE i.order_id = o.order_id
    ), '[]'::json)
  )
  FROM web_orders o
  WHERE o.numero = p_numero AND o.guest_phone = p_phone
  LIMIT 1;
$function$;

-- Function: receive_transfer(p_transfer_id uuid, p_items jsonb, p_user_id uuid)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.receive_transfer(p_transfer_id uuid, p_items jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer      RECORD;
  v_dest_site     UUID;
  v_transit_wh    UUID;
  v_item          RECORD;
  v_ti            RECORD;
  v_remaining     INTEGER;
  v_to_receive    INTEGER;
  v_transit_qty   INTEGER;
  v_total_received INTEGER := 0;
  v_lines          INTEGER := 0;
  v_still_pending  BOOLEAN;
  v_new_status     TEXT;
  v_caller         UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  -- 1. Bloquear el traslado. Una segunda recepción simultánea espera aquí
  --    y al continuar ya ve las cantidades actualizadas.
  SELECT t.transfer_id, t.status, t.to_warehouse_id, t.received_by, t.received_at
    INTO v_transfer
  FROM transfers t
  WHERE t.transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Traslado no encontrado.');
  END IF;

  IF v_transfer.status NOT IN ('en_transito', 'recibido_con_pendiente') THEN
    RETURN json_build_object('error',
      format('No se puede recibir un traslado con estado "%s".', v_transfer.status));
  END IF;

  -- 2. Autorización: admin, o encargado con acceso a la sede destino
  SELECT w.site_id INTO v_dest_site
  FROM warehouses w WHERE w.warehouse_id = v_transfer.to_warehouse_id;

  IF v_dest_site IS NULL THEN
    RETURN json_build_object('error', 'La bodega de destino no existe.');
  END IF;

  IF NOT (is_admin() OR (user_role() = 'encargado' AND has_site_access(v_dest_site))) THEN
    RETURN json_build_object('error', 'No tienes acceso a esta sede.');
  END IF;

  -- 3. Bodega de tránsito
  SELECT warehouse_id INTO v_transit_wh
  FROM warehouses WHERE is_system = TRUE LIMIT 1;

  IF v_transit_wh IS NULL THEN
    RETURN json_build_object('error', 'No se encontró la bodega de tránsito.');
  END IF;

  -- 4. Procesar cada línea
  FOR v_item IN
    SELECT (i ->> 'product_id')::UUID AS product_id,
           (i ->> 'quantity_received')::INTEGER AS qty
    FROM jsonb_array_elements(p_items) AS i
  LOOP
    IF v_item.qty IS NULL OR v_item.qty <= 0 THEN
      CONTINUE;
    END IF;

    -- Bloquear la línea del traslado
    SELECT ti.transfer_item_id, ti.quantity, COALESCE(ti.quantity_received, 0) AS received
      INTO v_ti
    FROM transfer_items ti
    WHERE ti.transfer_id = p_transfer_id
      AND ti.product_id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;  -- producto que no pertenece a este traslado
    END IF;

    -- Nunca recibir más de lo enviado
    v_remaining  := v_ti.quantity - v_ti.received;
    v_to_receive := LEAST(v_item.qty, v_remaining);

    IF v_to_receive <= 0 THEN
      CONTINUE;
    END IF;

    -- Bloquear el saldo de tránsito y verificar que alcanza.
    -- Sin este lock, dos recepciones concurrentes podrían sacar de tránsito
    -- más unidades de las que hay.
    SELECT quantity INTO v_transit_qty
    FROM product_stock
    WHERE product_id = v_item.product_id
      AND warehouse_id = v_transit_wh
    FOR UPDATE;

    IF v_transit_qty IS NULL OR v_transit_qty < v_to_receive THEN
      RAISE EXCEPTION 'Stock insuficiente en tránsito para el producto % (hay %, se requieren %).',
        v_item.product_id, COALESCE(v_transit_qty, 0), v_to_receive;
    END IF;

    -- Mover: tránsito → destino (escribe kardex en ambos lados)
    PERFORM adjust_warehouse_stock(
      v_item.product_id, v_transit_wh, -v_to_receive,
      'transito_salida', 'transfer', p_transfer_id, v_caller, NULL
    );
    PERFORM adjust_warehouse_stock(
      v_item.product_id, v_transfer.to_warehouse_id, v_to_receive,
      'traslado_entrada', 'transfer', p_transfer_id, v_caller, NULL
    );

    UPDATE transfer_items
    SET quantity_received = v_ti.received + v_to_receive
    WHERE transfer_item_id = v_ti.transfer_item_id;

    v_total_received := v_total_received + v_to_receive;
    v_lines := v_lines + 1;
  END LOOP;

  -- 5. ¿Queda algo pendiente?
  SELECT EXISTS (
    SELECT 1 FROM transfer_items
    WHERE transfer_id = p_transfer_id
      AND COALESCE(quantity_received, 0) < quantity
  ) INTO v_still_pending;

  v_new_status := CASE WHEN v_still_pending THEN 'recibido_con_pendiente' ELSE 'recibido' END;

  -- 6. Conservar quién recibió PRIMERO (bug 6).
  --    received_at se actualiza solo al cerrar el traslado por completo.
  UPDATE transfers
  SET status      = v_new_status,
      received_by = COALESCE(received_by, v_caller),
      received_at = CASE
                      WHEN v_new_status = 'recibido' THEN COALESCE(received_at, NOW())
                      ELSE received_at
                    END
  WHERE transfer_id = p_transfer_id;

  RETURN json_build_object(
    'success', true,
    'status', v_new_status,
    'lines_received', v_lines,
    'units_received', v_total_received,
    'pending', v_still_pending
  );
END $function$;

-- Function: receive_transfer_item(p_product_id uuid, p_transit_warehouse_id uuid, p_to_warehouse_id uuid, p_quantity integer, p_reference_id uuid, p_user_id uuid)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.receive_transfer_item(p_product_id uuid, p_transit_warehouse_id uuid, p_to_warehouse_id uuid, p_quantity integer, p_reference_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'La cantidad recibida debe ser mayor que cero.';
    END IF;
    PERFORM adjust_warehouse_stock(
        p_product_id, p_transit_warehouse_id, -p_quantity,
        'transito_salida', 'transfer', p_reference_id, p_user_id
    );
    PERFORM adjust_warehouse_stock(
        p_product_id, p_to_warehouse_id, p_quantity,
        'traslado_entrada', 'transfer', p_reference_id, p_user_id
    );
END;
$function$;

-- Function: reconcile_transfer(p_transfer_id uuid, p_items jsonb, p_notes text, p_user_id uuid)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.reconcile_transfer(p_transfer_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer     RECORD;
  v_transit_wh   UUID;
  v_item         RECORD;
  v_ti           RECORD;
  v_pending      INTEGER;
  v_found        INTEGER;
  v_lost         INTEGER;
  v_transit_qty  INTEGER;
  v_total_found  INTEGER := 0;
  v_total_lost   INTEGER := 0;
  v_caller       UUID := COALESCE(p_user_id, auth.uid());
  v_note         TEXT;
BEGIN
  -- 1. Autorización primero: dar de baja faltantes es admin o contador.
  --    El encargado que recibe no debe poder ocultar un faltante.
  IF NOT (is_admin() OR user_role() = 'contador') THEN
    RETURN json_build_object('error',
      'Solo un administrador o contador puede reconciliar pérdidas.');
  END IF;

  -- 2. Bloquear el traslado
  SELECT t.transfer_id, t.status, t.to_warehouse_id
    INTO v_transfer
  FROM transfers t
  WHERE t.transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Traslado no encontrado.');
  END IF;

  IF v_transfer.status <> 'recibido_con_pendiente' THEN
    RETURN json_build_object('error',
      format('Solo se reconcilian traslados con pendientes. Estado actual: "%s".', v_transfer.status));
  END IF;

  SELECT warehouse_id INTO v_transit_wh
  FROM warehouses WHERE is_system = TRUE LIMIT 1;

  IF v_transit_wh IS NULL THEN
    RETURN json_build_object('error', 'No se encontró la bodega de tránsito.');
  END IF;

  v_note := COALESCE(NULLIF(trim(p_notes), ''), 'Reconciliación de traslado');

  FOR v_item IN
    SELECT (i ->> 'product_id')::UUID AS product_id,
           GREATEST(COALESCE((i ->> 'found_qty')::INTEGER, 0), 0) AS found
    FROM jsonb_array_elements(p_items) AS i
  LOOP
    SELECT ti.transfer_item_id, ti.quantity, COALESCE(ti.quantity_received, 0) AS received
      INTO v_ti
    FROM transfer_items ti
    WHERE ti.transfer_id = p_transfer_id
      AND ti.product_id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_pending := v_ti.quantity - v_ti.received;
    IF v_pending <= 0 THEN
      CONTINUE;
    END IF;

    v_found := LEAST(v_item.found, v_pending);
    v_lost  := v_pending - v_found;

    SELECT quantity INTO v_transit_qty
    FROM product_stock
    WHERE product_id = v_item.product_id
      AND warehouse_id = v_transit_wh
    FOR UPDATE;

    IF COALESCE(v_transit_qty, 0) < v_pending THEN
      RAISE EXCEPTION 'Tránsito no cuadra para el producto % (hay %, el pendiente es %).',
        v_item.product_id, COALESCE(v_transit_qty, 0), v_pending;
    END IF;

    IF v_found > 0 THEN
      PERFORM adjust_warehouse_stock(
        v_item.product_id, v_transit_wh, -v_found,
        'transito_salida', 'transfer', p_transfer_id, v_caller, v_note
      );
      PERFORM adjust_warehouse_stock(
        v_item.product_id, v_transfer.to_warehouse_id, v_found,
        'traslado_entrada', 'transfer', p_transfer_id, v_caller, v_note
      );
    END IF;

    IF v_lost > 0 THEN
      PERFORM adjust_warehouse_stock(
        v_item.product_id, v_transit_wh, -v_lost,
        'ajuste', 'transfer_reconcile', p_transfer_id, v_caller,
        v_note || format(' — pérdida de %s unidad(es)', v_lost)
      );
    END IF;

    UPDATE transfer_items
    SET quantity_received = v_ti.received + v_found
    WHERE transfer_item_id = v_ti.transfer_item_id;

    v_total_found := v_total_found + v_found;
    v_total_lost  := v_total_lost + v_lost;
  END LOOP;

  UPDATE transfers
  SET status      = 'recibido',
      received_by = COALESCE(received_by, v_caller),
      received_at = COALESCE(received_at, NOW()),
      notes       = COALESCE(notes, '') ||
                    CASE WHEN v_total_lost > 0
                         THEN format(E'\n[Reconciliado] %s halladas, %s perdidas. %s',
                                     v_total_found, v_total_lost, v_note)
                         ELSE format(E'\n[Reconciliado] %s halladas, sin pérdidas.', v_total_found)
                    END
  WHERE transfer_id = p_transfer_id;

  RETURN json_build_object(
    'success', true,
    'found', v_total_found,
    'lost', v_total_lost,
    'status', 'recibido'
  );
END $function$;

-- Function: send_transfer_via_transit(p_product_id uuid, p_from_warehouse_id uuid, p_transit_warehouse_id uuid, p_quantity integer, p_reference_id uuid, p_user_id uuid)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.send_transfer_via_transit(p_product_id uuid, p_from_warehouse_id uuid, p_transit_warehouse_id uuid, p_quantity integer, p_reference_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'La cantidad a trasladar debe ser mayor que cero.';
    END IF;
    PERFORM adjust_warehouse_stock(
        p_product_id, p_from_warehouse_id, -p_quantity,
        'traslado_salida', 'transfer', p_reference_id, p_user_id
    );
    PERFORM adjust_warehouse_stock(
        p_product_id, p_transit_warehouse_id, p_quantity,
        'transito_entrada', 'transfer', p_reference_id, p_user_id
    );
END;
$function$;

-- Function: set_web_order_payment_reference(p_order_id uuid, p_reference text)  secdef=true  vol=v  lang=plpgsql
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
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Pedido no encontrado.');
  END IF;
  IF v_order.payment_status = 'approved' THEN
    RETURN json_build_object('error', 'Este pedido ya fue pagado.');
  END IF;

  UPDATE web_orders
  SET wompi_reference = p_reference,
      payment_method = 'wompi',
      updated_at = NOW()
  WHERE order_id = p_order_id;

  RETURN json_build_object('success', true, 'reference', p_reference,
                           'amount_in_cents', (v_order.total * 100)::BIGINT);
END $function$;

-- Function: transfer_stock(p_product_id uuid, p_from uuid, p_to uuid, p_quantity integer, p_reference_id uuid, p_user_id uuid)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.transfer_stock(p_product_id uuid, p_from uuid, p_to uuid, p_quantity integer, p_reference_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- Function: update_online_order_status(p_order_id uuid, p_new_status text, p_user_id uuid, p_reason text)  secdef=true  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.update_online_order_status(p_order_id uuid, p_new_status text, p_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_order RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_order FROM online_orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido no encontrado.');
  END IF;

  IF v_order.status IN ('delivered','cancelled') THEN
    RETURN jsonb_build_object('error', 'El pedido ya está finalizado.');
  END IF;

  IF p_new_status = 'cancelled' AND v_order.status <> 'cancelled' THEN
    -- Liberar stock reservado
    FOR v_item IN SELECT product_id, quantity FROM online_order_items WHERE order_id = p_order_id LOOP
      PERFORM adjust_warehouse_stock(
        v_item.product_id, v_order.warehouse_id, v_item.quantity,
        'liberacion_online', 'online_order', p_order_id, p_user_id
      );
    END LOOP;
  END IF;

  UPDATE online_orders
  SET status = p_new_status,
      updated_at = NOW(),
      handled_by = COALESCE(handled_by, p_user_id),
      cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN NOW() ELSE cancelled_at END,
      cancelled_reason = CASE WHEN p_new_status = 'cancelled' THEN p_reason ELSE cancelled_reason END
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object('success', true, 'status', p_new_status);
END; $function$;

-- Function: verify_kardex_integrity()  secdef=false  vol=v  lang=sql
CREATE OR REPLACE FUNCTION public.verify_kardex_integrity()
 RETURNS TABLE(product_id uuid, warehouse_id uuid, saldo_real integer, suma_kardex bigint, diff bigint)
 LANGUAGE sql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- Function: void_sale(p_sale_id uuid, p_user_id uuid)  secdef=false  vol=v  lang=plpgsql
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- ---- Triggers ----------------------------------------------------------
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_sync_primary_image AFTER INSERT OR DELETE OR UPDATE ON product_images FOR EACH ROW EXECUTE FUNCTION sync_product_primary_image();
CREATE TRIGGER update_product_stock_updated_at BEFORE UPDATE ON product_stock FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_set_web_order_number BEFORE INSERT ON web_orders FOR EACH ROW EXECUTE FUNCTION set_web_order_number();

-- ---- Views -------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_availability AS
 SELECT p.product_id,
    p.code,
    p.name,
    p.price,
    p.wholesale_price,
    p.description,
    p.image_url,
    s.site_id,
    s.name AS site_name,
        CASE
            WHEN COALESCE(ps.quantity, 0) > 0 THEN 'disponible'::text
            ELSE 'agotado'::text
        END AS availability
   FROM products p
     CROSS JOIN ( SELECT si.site_id,
            si.name,
            w.warehouse_id
           FROM sites si
             JOIN warehouses w ON w.site_id = si.site_id
          WHERE w.is_public = true) s
     LEFT JOIN product_stock ps ON ps.product_id = p.product_id AND ps.warehouse_id = s.warehouse_id
  WHERE p.is_active = true;

-- ---- Enable RLS --------------------------------------------------------
ALTER TABLE public.accounting_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjustment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_order_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suspended_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_orders ENABLE ROW LEVEL SECURITY;

-- ---- RLS Policies ------------------------------------------------------
CREATE POLICY accounting_entries_read ON public.accounting_entries
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_site_access(site_id));
CREATE POLICY accounting_entries_update ON public.accounting_entries
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY accounting_entries_write ON public.accounting_entries
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY adjustment_items_read ON public.adjustment_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY adjustment_items_update ON public.adjustment_items
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY adjustment_items_write ON public.adjustment_items
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY business_settings_admin_write ON public.business_settings
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY business_settings_read ON public.business_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY cash_movements_read ON public.cash_movements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY cash_movements_update ON public.cash_movements
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY cash_movements_write ON public.cash_movements
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY categories_delete ON public.categories
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin());
CREATE POLICY categories_read ON public.categories
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY categories_update ON public.categories
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY categories_write ON public.categories
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY customer_accounts_read_own ON public.customer_accounts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));
CREATE POLICY customer_accounts_write_del ON public.customer_accounts
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));
CREATE POLICY customer_accounts_write_ins ON public.customer_accounts
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));
CREATE POLICY customer_accounts_write_upd ON public.customer_accounts
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));
CREATE POLICY customers_delete ON public.customers
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin());
CREATE POLICY customers_read ON public.customers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY customers_update ON public.customers
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY customers_write ON public.customers
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY inventory_adjustments_read ON public.inventory_adjustments
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY inventory_adjustments_update ON public.inventory_adjustments
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY inventory_adjustments_write ON public.inventory_adjustments
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY counter_read ON public.online_order_counter
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY order_items_read ON public.online_order_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY orders_read ON public.online_orders
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_site_access(site_id));
CREATE POLICY orders_update ON public.online_orders
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (has_site_access(site_id));
CREATE POLICY payment_events_read_staff ON public.payment_events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_admin_or_encargado() OR is_global_role()));
CREATE POLICY pos_shifts_read ON public.pos_shifts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_site_access(site_id));
CREATE POLICY pos_shifts_update ON public.pos_shifts
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY pos_shifts_write ON public.pos_shifts
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY price_lists_delete ON public.price_lists
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY price_lists_read ON public.price_lists
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY price_lists_update ON public.price_lists
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY price_lists_write ON public.price_lists
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY product_images_delete ON public.product_images
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY product_images_read_all ON public.product_images
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true);
CREATE POLICY product_images_update ON public.product_images
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY product_images_write ON public.product_images
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY product_prices_delete ON public.product_prices
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY product_prices_read ON public.product_prices
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY product_prices_update ON public.product_prices
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY product_prices_write ON public.product_prices
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY product_stock_read ON public.product_stock
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY product_stock_update ON public.product_stock
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY product_stock_write ON public.product_stock
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY products_delete ON public.products
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin());
CREATE POLICY products_read ON public.products
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY products_update ON public.products
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY products_write ON public.products
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY promo_products_delete ON public.promotion_products
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY promo_products_read ON public.promotion_products
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY promo_products_write ON public.promotion_products
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY promotions_delete ON public.promotions
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY promotions_read ON public.promotions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY promotions_update ON public.promotions
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado());
CREATE POLICY promotions_write ON public.promotions
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_encargado());
CREATE POLICY sale_items_read ON public.sale_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY sale_items_update ON public.sale_items
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY sale_items_write ON public.sale_items
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY sales_read ON public.sales
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_site_access(site_id));
CREATE POLICY sales_update ON public.sales
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY sales_write ON public.sales
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY counters_insert_authenticated ON public.site_counters
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY counters_read_authenticated ON public.site_counters
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY counters_update_authenticated ON public.site_counters
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY sites_delete ON public.sites
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin());
CREATE POLICY sites_read ON public.sites
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY sites_update ON public.sites
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin());
CREATE POLICY sites_write ON public.sites
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY movements_insert_authenticated ON public.stock_movements
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY movements_read_authenticated ON public.stock_movements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY suspended_sales_delete ON public.suspended_sales
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (true);
CREATE POLICY suspended_sales_read ON public.suspended_sales
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY suspended_sales_write ON public.suspended_sales
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY transfer_items_read ON public.transfer_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY transfer_items_update ON public.transfer_items
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY transfer_items_write ON public.transfer_items
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY transfers_read ON public.transfers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY transfers_update ON public.transfers
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
CREATE POLICY transfers_write ON public.transfers
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY users_admin_write_del ON public.user_profiles
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (( SELECT is_admin() AS is_admin));
CREATE POLICY users_admin_write_ins ON public.user_profiles
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));
CREATE POLICY users_admin_write_upd ON public.user_profiles
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));
CREATE POLICY users_read_own ON public.user_profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));
CREATE POLICY user_sites_admin_write_del ON public.user_sites
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (( SELECT is_admin() AS is_admin));
CREATE POLICY user_sites_admin_write_ins ON public.user_sites
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));
CREATE POLICY user_sites_admin_write_upd ON public.user_sites
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));
CREATE POLICY user_sites_read_own ON public.user_sites
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));
CREATE POLICY warehouses_delete ON public.warehouses
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_admin());
CREATE POLICY warehouses_read ON public.warehouses
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY warehouses_update ON public.warehouses
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin());
CREATE POLICY warehouses_write ON public.warehouses
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY web_order_items_read ON public.web_order_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_admin_or_encargado() OR is_global_role()));
CREATE POLICY web_orders_read_staff ON public.web_orders
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_admin_or_encargado() OR is_global_role()));
CREATE POLICY web_orders_update_staff ON public.web_orders
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_encargado())
  WITH CHECK (is_admin_or_encargado());

-- ---- Indexes (non-constraint) ------------------------------------------
CREATE INDEX idx_accounting_entries_sale ON public.accounting_entries USING btree (sale_id);
CREATE INDEX idx_accounting_site_date ON public.accounting_entries USING btree (site_id, entry_date);
CREATE INDEX idx_adjustment_items_adjustment ON public.adjustment_items USING btree (adjustment_id);
CREATE INDEX idx_adjustment_items_product ON public.adjustment_items USING btree (product_id);
CREATE INDEX idx_business_settings_updated_by ON public.business_settings USING btree (updated_by);
CREATE INDEX idx_cash_movements_shift ON public.cash_movements USING btree (shift_id);
CREATE INDEX idx_customer_accounts_customer ON public.customer_accounts USING btree (customer_id);
CREATE INDEX idx_customers_name ON public.customers USING btree (name);
CREATE INDEX idx_adjustments_warehouse ON public.inventory_adjustments USING btree (warehouse_id);
CREATE INDEX idx_online_order_items_order ON public.online_order_items USING btree (order_id);
CREATE INDEX idx_online_order_items_product ON public.online_order_items USING btree (product_id);
CREATE INDEX idx_online_orders_created ON public.online_orders USING btree (created_at DESC);
CREATE INDEX idx_online_orders_handled_by ON public.online_orders USING btree (handled_by);
CREATE INDEX idx_online_orders_phone ON public.online_orders USING btree (customer_phone);
CREATE INDEX idx_online_orders_sale ON public.online_orders USING btree (sale_id);
CREATE INDEX idx_online_orders_site ON public.online_orders USING btree (site_id);
CREATE INDEX idx_online_orders_status ON public.online_orders USING btree (status);
CREATE INDEX idx_online_orders_warehouse ON public.online_orders USING btree (warehouse_id);
CREATE INDEX idx_payment_events_ref ON public.payment_events USING btree (reference);
CREATE INDEX idx_payment_events_tx ON public.payment_events USING btree (transaction_id);
CREATE INDEX idx_pos_shifts_warehouse ON public.pos_shifts USING btree (warehouse_id);
CREATE UNIQUE INDEX one_open_shift_per_site ON public.pos_shifts USING btree (site_id) WHERE ((status)::text = 'open'::text);
CREATE UNIQUE INDEX one_default_price_list ON public.price_lists USING btree (is_default) WHERE is_default;
CREATE INDEX idx_product_images_created_by ON public.product_images USING btree (created_by);
CREATE UNIQUE INDEX idx_product_images_one_primary ON public.product_images USING btree (product_id) WHERE is_primary;
CREATE INDEX idx_product_images_product ON public.product_images USING btree (product_id, sort_order);
CREATE INDEX idx_product_prices_price_list ON public.product_prices USING btree (price_list_id);
CREATE INDEX idx_product_stock_warehouse ON public.product_stock USING btree (warehouse_id);
CREATE INDEX idx_products_barcode ON public.products USING btree (barcode);
CREATE INDEX idx_products_category ON public.products USING btree (category_id);
CREATE INDEX idx_products_name ON public.products USING btree (name);
CREATE INDEX idx_promotion_products_product ON public.promotion_products USING btree (product_id);
CREATE INDEX idx_promotions_site ON public.promotions USING btree (site_id);
CREATE INDEX idx_sale_items_product ON public.sale_items USING btree (product_id);
CREATE INDEX idx_sale_items_sale ON public.sale_items USING btree (sale_id);
CREATE INDEX idx_sales_customer ON public.sales USING btree (customer_id);
CREATE UNIQUE INDEX idx_sales_numero_site ON public.sales USING btree (site_id, numero) WHERE (numero IS NOT NULL);
CREATE INDEX idx_sales_shift ON public.sales USING btree (shift_id);
CREATE INDEX idx_sales_site_date ON public.sales USING btree (site_id, sale_date);
CREATE INDEX idx_sales_warehouse ON public.sales USING btree (warehouse_id);
CREATE UNIQUE INDEX one_central_site ON public.sites USING btree (is_central) WHERE is_central;
CREATE INDEX idx_movements_product_wh ON public.stock_movements USING btree (product_id, warehouse_id, created_at);
CREATE INDEX idx_movements_reference ON public.stock_movements USING btree (reference_type, reference_id);
CREATE INDEX idx_movements_type ON public.stock_movements USING btree (movement_type);
CREATE INDEX idx_stock_movements_user ON public.stock_movements USING btree (user_id);
CREATE INDEX idx_stock_movements_warehouse ON public.stock_movements USING btree (warehouse_id);
CREATE INDEX idx_suspended_sales_customer ON public.suspended_sales USING btree (customer_id);
CREATE INDEX idx_suspended_sales_site ON public.suspended_sales USING btree (site_id);
CREATE INDEX idx_suspended_sales_suspended_by ON public.suspended_sales USING btree (suspended_by);
CREATE INDEX idx_transfer_items_product ON public.transfer_items USING btree (product_id);
CREATE INDEX idx_transfer_items_transfer ON public.transfer_items USING btree (transfer_id);
CREATE INDEX idx_transfers_from ON public.transfers USING btree (from_warehouse_id);
CREATE INDEX idx_transfers_received_by ON public.transfers USING btree (received_by);
CREATE INDEX idx_transfers_sent_by ON public.transfers USING btree (sent_by);
CREATE INDEX idx_transfers_status_to ON public.transfers USING btree (to_warehouse_id, status);
CREATE INDEX idx_transfers_to ON public.transfers USING btree (to_warehouse_id);
CREATE INDEX idx_user_profiles_role ON public.user_profiles USING btree (role);
CREATE INDEX idx_user_profiles_site ON public.user_profiles USING btree (site_id);
CREATE INDEX idx_user_sites_site ON public.user_sites USING btree (site_id);
CREATE INDEX idx_user_sites_user ON public.user_sites USING btree (user_id);
CREATE INDEX idx_warehouses_site ON public.warehouses USING btree (site_id);
CREATE UNIQUE INDEX one_primary_warehouse_per_site ON public.warehouses USING btree (site_id) WHERE is_primary;
CREATE INDEX idx_web_order_items_order ON public.web_order_items USING btree (order_id);
CREATE INDEX idx_web_order_items_product ON public.web_order_items USING btree (product_id);
CREATE INDEX idx_web_orders_customer ON public.web_orders USING btree (customer_id);
CREATE INDEX idx_web_orders_sale ON public.web_orders USING btree (sale_id);
CREATE INDEX idx_web_orders_site ON public.web_orders USING btree (fulfillment_site_id);
CREATE INDEX idx_web_orders_status ON public.web_orders USING btree (status);
CREATE INDEX idx_web_orders_wompi_ref ON public.web_orders USING btree (wompi_reference);
CREATE INDEX idx_web_orders_wompi_tx ON public.web_orders USING btree (wompi_transaction_id);

-- ---- Function grants/revokes (preserves S1-paso1 + script 09 hardening) -
REVOKE ALL ON FUNCTION public.add_cash_movement(p_shift_id uuid, p_type text, p_amount numeric, p_description text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_create_user(p_email text, p_password text, p_full_name text, p_role text, p_site_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text) FROM anon;
REVOKE ALL ON FUNCTION public.close_shift(p_shift_id uuid, p_counted_cash numeric, p_closed_by text, p_notes text) FROM anon;
REVOKE ALL ON FUNCTION public.fulfill_web_order(p_order_id uuid, p_site_id uuid, p_user_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE ALL ON FUNCTION public.open_shift(p_site_id uuid, p_warehouse_id uuid, p_initial_cash numeric, p_bank_base text, p_opened_by text) FROM anon;
REVOKE ALL ON FUNCTION public.update_online_order_status(p_order_id uuid, p_new_status text, p_user_id uuid, p_reason text) FROM anon;
REVOKE ALL ON FUNCTION public.apply_wompi_transaction(p_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint) FROM anon;
REVOKE ALL ON FUNCTION public.apply_wompi_transaction(p_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint) FROM authenticated;
REVOKE ALL ON FUNCTION public.set_web_order_payment_reference(p_order_id uuid, p_reference text) FROM anon;
REVOKE ALL ON FUNCTION public.set_web_order_payment_reference(p_order_id uuid, p_reference text) FROM authenticated;
REVOKE ALL ON FUNCTION public.log_payment_event(p_transaction_id text, p_reference text, p_event_type text, p_status text, p_amount_in_cents bigint, p_raw jsonb, p_signature_valid boolean, p_processed boolean, p_error text) FROM anon;
REVOKE ALL ON FUNCTION public.log_payment_event(p_transaction_id text, p_reference text, p_event_type text, p_status text, p_amount_in_cents bigint, p_raw jsonb, p_signature_valid boolean, p_processed boolean, p_error text) FROM authenticated;

-- End of baseline
