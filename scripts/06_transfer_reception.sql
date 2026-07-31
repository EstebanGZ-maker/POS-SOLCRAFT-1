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
