-- =============================================================================
-- 15_credit_sales_phase1.sql — Ventas a crédito (fiado), Fase 1.
--
-- Alcance (spec: docs/CREDIT-SALES-SPEC.md):
--   1. sales += is_on_account, amount_paid, balance_due (STORED).
--   2. sale_payments (ledger de abonos, patrón stock_movements→product_stock)
--      con RLS de escritura CERRADA.
--   3. customers += allows_credit + is_walk_in; walk-in bootstrapped y
--      verificado (aborta si !=1 walk-in con allows_credit=false).
--   4. customer_credits (Fase 1: solo emisión desde void_sale).
--   5. Backfill: sale_payments para toda venta activa histórica; aborta si
--      hay ventas activas con site_id NULL.
--   6. verify_credit_integrity() — invariante amount_paid = SUM(active pays).
--   7. RPCs SECURITY DEFINER:
--      - create_sale (nueva firma con p_is_on_account + p_initial_payment,
--        ignora p_user_id, usa auth.uid()).
--      - close_shift (consume get_shift_balance).
--      - get_shift_balance (NUEVO: única fuente de verdad del arqueo).
--      - void_sale (regla asimétrica Caso A / Caso B / Caso C; refund
--        cross-turno vía cash_movements en el turno actual).
--
-- FUERA DE ALCANCE (van en el mismo commit, código no SQL):
--   - buildBalance() en lib/shift-actions.ts pasa a llamar get_shift_balance.
--   - app/pos/page.tsx pasa a usar customers.is_walk_in en vez de match name.
--   - scripts/04_seed.sql actualizado para nuevos entornos vírgenes.
--
-- Rollback: DROP FUNCTIONs al final del archivo, comentado. La reversión de
-- ALTERs de tabla y del backfill requiere restore desde snapshot del branch.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. Precondiciones bloqueantes
-- =============================================================================

DO $pre$
DECLARE v_bad INT;
BEGIN
    -- El backfill requiere site_id NOT NULL para todo activo con monto > 0
    -- (sale_payments.site_id es NOT NULL). Si hay ventas legadas sin sede,
    -- deben resolverse antes de correr esta migración.
    SELECT COUNT(*) INTO v_bad
    FROM sales
    WHERE status = 'active' AND site_id IS NULL AND total_amount > 0;

    IF v_bad > 0 THEN
        RAISE EXCEPTION
          'Fase 1 aborta: % venta(s) activa(s) con total>0 y site_id NULL. Reparar antes.',
          v_bad;
    END IF;
END
$pre$;

-- =============================================================================
-- 1. sales: nuevas columnas
-- =============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS is_on_account BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS amount_paid   NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0);

-- balance_due: solo se agrega si no existe (no se puede alterar una columna
-- generada; hay que borrarla y recrearla si algo cambia).
DO $addcol$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='sales'
          AND column_name='balance_due'
    ) THEN
        ALTER TABLE sales
          ADD COLUMN balance_due NUMERIC(12,2)
          GENERATED ALWAYS AS (total_amount - amount_paid) STORED;
    END IF;
END
$addcol$;

DO $addck$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'sales_amount_paid_within_total'
          AND table_name = 'sales'
    ) THEN
        ALTER TABLE sales
          ADD CONSTRAINT sales_amount_paid_within_total
          CHECK (amount_paid <= total_amount);
    END IF;
END
$addck$;

CREATE INDEX IF NOT EXISTS idx_sales_on_account_open
  ON sales (customer_id, sale_date)
  WHERE is_on_account = TRUE AND balance_due > 0 AND status = 'active';

-- =============================================================================
-- 2. sale_payments (ledger de abonos)
-- =============================================================================

CREATE TABLE IF NOT EXISTS sale_payments (
    payment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id        UUID NOT NULL REFERENCES sales(sale_id) ON DELETE RESTRICT,
    amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(60) NOT NULL,
    shift_id       UUID REFERENCES pos_shifts(shift_id) ON DELETE SET NULL,
    site_id        UUID NOT NULL REFERENCES sites(site_id) ON DELETE RESTRICT,
    received_by    TEXT,
    notes          TEXT,
    status         TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','voided')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale  ON sale_payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_site  ON sale_payments (site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_payments_shift ON sale_payments (shift_id);

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;

-- SELECT: permisivo a authenticated (mismo patrón que sales — ya hay RLS de
-- sede en el read). Escritura CERRADA: no policy INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "sale_payments_read" ON sale_payments;
CREATE POLICY "sale_payments_read" ON sale_payments FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- 3. customers: allows_credit + is_walk_in + walk-in bootstrap
-- =============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS allows_credit BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_walk_in    BOOLEAN NOT NULL DEFAULT FALSE;

-- Bootstrap único por nombre — a partir de aquí, el runtime usa is_walk_in.
UPDATE customers
   SET is_walk_in = TRUE, allows_credit = FALSE
 WHERE name = 'Consumidor final'
   AND is_walk_in = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS one_walk_in_customer
  ON customers (is_walk_in) WHERE is_walk_in;

DO $addck2$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'walk_in_never_allows_credit'
          AND table_name = 'customers'
    ) THEN
        ALTER TABLE customers
          ADD CONSTRAINT walk_in_never_allows_credit
          CHECK (NOT (is_walk_in AND allows_credit));
    END IF;
END
$addck2$;

-- Verificación abortiva (D12): exactamente 1 walk-in con allows_credit=false.
DO $verify_walkin$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM customers WHERE is_walk_in = TRUE AND allows_credit = FALSE;
    IF v_count <> 1 THEN
        RAISE EXCEPTION
          'Fase 1 aborta: se esperaba exactamente 1 walk-in con allows_credit=false, hay %.',
          v_count;
    END IF;
END
$verify_walkin$;

-- =============================================================================
-- 4. customer_credits (Fase 1: solo emisión)
-- =============================================================================

CREATE TABLE IF NOT EXISTS customer_credits (
    credit_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id    UUID NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    amount         NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
    source_type    TEXT NOT NULL CHECK (source_type IN ('void_sale','manual_adjustment','redemption')),
    source_sale_id UUID REFERENCES sales(sale_id) ON DELETE SET NULL,
    site_id        UUID NOT NULL REFERENCES sites(site_id) ON DELETE RESTRICT,
    notes          TEXT,
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_credits_customer
  ON customer_credits (customer_id, created_at);

ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_credits_read" ON customer_credits;
CREATE POLICY "customer_credits_read" ON customer_credits FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- 5. Backfill histórico de sale_payments (D6, obligatorio)
-- =============================================================================
--
-- Regla: para toda venta activa con total>0, insertar 1 sale_payment
-- equivalente (monto=total, método=copia, shift=copia, fecha=sale_date). Y
-- actualizar amount_paid=total en sales para preservar el invariante nuevo.
-- Ventas voided o total=0 se dejan como están (amount_paid=0 default).
-- =============================================================================

UPDATE sales
   SET amount_paid = total_amount
 WHERE status = 'active' AND total_amount > 0 AND amount_paid = 0;

INSERT INTO sale_payments
  (sale_id, amount, payment_method, shift_id, site_id, received_by, notes, created_at)
SELECT
  s.sale_id,
  s.total_amount,
  COALESCE(s.payment_method, 'Desconocido'),
  s.shift_id,
  s.site_id,
  s.seller,
  'Backfill Fase 1 fiado',
  s.sale_date
FROM sales s
WHERE s.status = 'active'
  AND s.total_amount > 0
  AND NOT EXISTS (
      SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.sale_id
  );

-- =============================================================================
-- 6. verify_credit_integrity()
-- =============================================================================

CREATE OR REPLACE FUNCTION verify_credit_integrity()
RETURNS TABLE (
    sale_id            UUID,
    numero             INTEGER,
    total_amount       NUMERIC,
    amount_paid_sales  NUMERIC,
    amount_paid_ledger NUMERIC,
    diff               NUMERIC,
    issue              TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT
        s.sale_id,
        s.numero,
        s.total_amount,
        s.amount_paid,
        COALESCE(sp.sum_paid, 0) AS amount_paid_ledger,
        s.amount_paid - COALESCE(sp.sum_paid, 0) AS diff,
        CASE
            WHEN s.amount_paid > s.total_amount THEN 'amount_paid > total_amount'
            WHEN s.balance_due < 0             THEN 'balance_due negativo'
            WHEN s.amount_paid <> COALESCE(sp.sum_paid, 0)
                                               THEN 'amount_paid != SUM(sale_payments active)'
            ELSE 'ok'
        END AS issue
    FROM sales s
    LEFT JOIN (
        SELECT sale_id, SUM(amount) AS sum_paid
        FROM sale_payments
        WHERE status = 'active'
        GROUP BY sale_id
    ) sp ON sp.sale_id = s.sale_id
    WHERE s.status = 'active'
      AND (
          s.amount_paid > s.total_amount
          OR s.balance_due < 0
          OR s.amount_paid <> COALESCE(sp.sum_paid, 0)
      );
$$;

GRANT EXECUTE ON FUNCTION verify_credit_integrity() TO authenticated;

-- =============================================================================
-- 7. RPC create_sale — nueva versión SECURITY DEFINER
-- =============================================================================

-- Drop de la firma vigente (11 args, con p_user_id al final).
DROP FUNCTION IF EXISTS create_sale(
    UUID, NUMERIC, JSONB, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID
);

CREATE OR REPLACE FUNCTION create_sale(
    p_customer_id      UUID,
    p_total_amount     NUMERIC,
    p_items            JSONB,
    p_payment_method   TEXT    DEFAULT NULL,
    p_amount_received  NUMERIC DEFAULT NULL,
    p_seller           TEXT    DEFAULT NULL,
    p_notes            TEXT    DEFAULT NULL,
    p_site_id          UUID    DEFAULT NULL,
    p_warehouse_id     UUID    DEFAULT NULL,
    p_shift_id         UUID    DEFAULT NULL,
    -- IGNORADO: se usa auth.uid() (D11). Queda por compat de firma con el
    -- wrapper Server Action; remover en DROP+CREATE posterior.
    p_user_id          UUID    DEFAULT NULL,
    p_is_on_account    BOOLEAN DEFAULT FALSE,
    p_initial_payment  NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid            UUID := auth.uid();
    v_role           TEXT;
    v_user_site      UUID;
    v_sale_id        UUID;
    v_item           RECORD;
    v_is_service     BOOLEAN;
    v_numero         INTEGER;
    v_customer       RECORD;
    v_amount_paid    NUMERIC := 0;
    v_payment_label  TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para registrar venta.';
    END IF;
    IF p_site_id IS NULL THEN
        RAISE EXCEPTION 'La venta requiere sede.';
    END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM p_site_id THEN
        RAISE EXCEPTION 'Solo puedes registrar ventas en tu sede.';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La venta no tiene productos.';
    END IF;
    IF p_total_amount < 0 THEN
        RAISE EXCEPTION 'El total de la venta no puede ser negativo.';
    END IF;

    -- Ventas a cuenta: cliente identificado con allows_credit=true.
    IF p_is_on_account THEN
        SELECT customer_id, allows_credit, is_walk_in
          INTO v_customer
          FROM customers
         WHERE customer_id = p_customer_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cliente no encontrado (obligatorio para fiar).';
        END IF;
        IF v_customer.is_walk_in OR NOT v_customer.allows_credit THEN
            RAISE EXCEPTION 'Este cliente no puede fiar.';
        END IF;

        IF p_initial_payment IS NULL THEN
            v_amount_paid := 0;
        ELSIF p_initial_payment < 0 OR p_initial_payment > p_total_amount THEN
            RAISE EXCEPTION 'Abono inicial fuera de rango [0, total].';
        ELSE
            v_amount_paid := p_initial_payment;
        END IF;

        v_payment_label := 'crédito';  -- solo etiqueta, nunca clasificador (D8)
    ELSE
        v_amount_paid := p_total_amount;
        v_payment_label := p_payment_method;
    END IF;

    IF p_site_id IS NOT NULL THEN
        UPDATE site_counters
           SET last_numero = last_numero + 1
         WHERE site_id = p_site_id
        RETURNING last_numero INTO v_numero;
    END IF;

    INSERT INTO sales (
        customer_id, total_amount, payment_method, amount_received,
        seller, notes, site_id, warehouse_id, shift_id, numero, status,
        is_on_account, amount_paid
    ) VALUES (
        p_customer_id, p_total_amount, v_payment_label, p_amount_received,
        p_seller, p_notes, p_site_id, p_warehouse_id, p_shift_id, v_numero, 'active',
        p_is_on_account, v_amount_paid
    ) RETURNING sale_id INTO v_sale_id;

    FOR v_item IN
        SELECT
            (i ->> 'product_id')::UUID    AS product_id,
            (i ->> 'quantity')::INTEGER   AS quantity,
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
                -- p_user_id se IGNORA (D11); el kardex lleva auth.uid().
                PERFORM adjust_warehouse_stock(
                    v_item.product_id, p_warehouse_id, -v_item.quantity,
                    'venta', 'sale', v_sale_id, v_uid
                );
            ELSE
                PERFORM decrement_product_stock(v_item.product_id, v_item.quantity);
            END IF;
        END IF;
    END LOOP;

    -- sale_payments: contado siempre; fiado solo si hay abono inicial > 0.
    IF v_amount_paid > 0 THEN
        INSERT INTO sale_payments
            (sale_id, amount, payment_method, shift_id, site_id, received_by, notes)
        VALUES (
            v_sale_id, v_amount_paid,
            COALESCE(p_payment_method, 'Desconocido'),
            p_shift_id, p_site_id, p_seller,
            CASE WHEN p_is_on_account THEN 'Abono inicial' ELSE NULL END
        );

        INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
        VALUES (
            p_site_id,
            'income',
            CASE WHEN p_is_on_account THEN 'Abono inicial crédito' ELSE 'Ventas POS' END,
            'Venta #' || COALESCE(v_numero::TEXT, LEFT(v_sale_id::TEXT, 8)) ||
                COALESCE(' - ' || p_payment_method, ''),
            v_amount_paid,
            v_sale_id
        );
    END IF;

    RETURN v_sale_id;
END;
$$;

REVOKE ALL     ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC) TO authenticated;

-- =============================================================================
-- 8. RPC get_shift_balance (NUEVO) — única fuente de verdad del arqueo
-- =============================================================================

CREATE OR REPLACE FUNCTION get_shift_balance(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role         TEXT;
    v_user_site    UUID;
    v_shift        RECORD;
    v_cash         NUMERIC := 0;
    v_non_cash     NUMERIC := 0;
    v_cm_income    NUMERIC := 0;
    v_cm_expense   NUMERIC := 0;
    v_cm_refund    NUMERIC := 0;
    v_expected     NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role NOT IN ('admin','encargado','vendedor','contador') THEN
        RAISE EXCEPTION 'Sin permisos para consultar arqueo.';
    END IF;

    SELECT shift_id, site_id, initial_cash, status
      INTO v_shift
      FROM pos_shifts WHERE shift_id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno no encontrado.';
    END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM v_shift.site_id THEN
        RAISE EXCEPTION 'Solo puedes consultar arqueos de tu sede.';
    END IF;

    SELECT
      COALESCE(SUM(amount) FILTER (
        WHERE payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%'
      ), 0),
      COALESCE(SUM(amount) FILTER (
        WHERE NOT (payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%')
      ), 0)
    INTO v_cash, v_non_cash
    FROM sale_payments
    WHERE shift_id = p_shift_id
      AND status = 'active';

    SELECT
      COALESCE(SUM(amount) FILTER (WHERE type='income'),  0),
      COALESCE(SUM(amount) FILTER (WHERE type='expense'), 0),
      COALESCE(SUM(amount) FILTER (WHERE type='refund'),  0)
    INTO v_cm_income, v_cm_expense, v_cm_refund
    FROM cash_movements WHERE shift_id = p_shift_id;

    v_expected := COALESCE(v_shift.initial_cash, 0)
                + v_cash
                + v_cm_income
                - v_cm_expense
                - v_cm_refund;

    RETURN jsonb_build_object(
        'shift_id',               p_shift_id,
        'initial_cash',           COALESCE(v_shift.initial_cash, 0),
        'cash_in_shift',          v_cash,
        'non_cash_in_shift',      v_non_cash,
        'cash_movements_income',  v_cm_income,
        'cash_movements_expense', v_cm_expense,
        'cash_movements_refund',  v_cm_refund,
        'expected_cash',          v_expected
    );
END;
$$;

REVOKE ALL     ON FUNCTION get_shift_balance(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_shift_balance(UUID) TO authenticated;

-- =============================================================================
-- 9. RPC close_shift — consume get_shift_balance (elimina la duplicación M12)
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
    v_balance    JSONB;
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

    v_balance  := get_shift_balance(p_shift_id);
    v_expected := (v_balance->>'expected_cash')::NUMERIC;
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

-- =============================================================================
-- 10. RPC void_sale — SECDEF + regla asimétrica Caso A / B / C
-- =============================================================================
--   Caso A: contado (is_on_account=false)  → sale_payments intactos;
--           expense=amount_paid; cash_movement refund en turno actual si
--           hubo cobros cash. Sin customer_credits.
--   Caso B: fiado (is_on_account=true) con amount_paid>0 → sale_payments
--           intactos; expense=amount_paid; customer_credits += amount_paid.
--           SIN cash_movement (la plata no se devuelve).
--   Caso C: amount_paid=0 → nada más que voided + devolver stock.
-- =============================================================================

CREATE OR REPLACE FUNCTION void_sale(
    p_sale_id UUID,
    -- IGNORADO: se usa auth.uid() (D11). Queda por compat de firma con el
    -- wrapper Server Action; remover en DROP+CREATE posterior.
    p_user_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_role          TEXT;
    v_user_site     UUID;
    v_sale          RECORD;
    v_item          RECORD;
    v_is_service    BOOLEAN;
    v_cash_refund   NUMERIC := 0;
    v_current_shift UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role NOT IN ('admin','encargado','vendedor') THEN
        RAISE EXCEPTION 'Sin permisos para anular venta.';
    END IF;

    SELECT sale_id, customer_id, site_id, warehouse_id, total_amount,
           amount_paid, status, numero, is_on_account
      INTO v_sale
      FROM sales WHERE sale_id = p_sale_id
      FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venta no encontrada.';
    END IF;
    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION 'La venta ya está anulada.';
    END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM v_sale.site_id THEN
        RAISE EXCEPTION 'Solo puedes anular ventas de tu sede.';
    END IF;

    UPDATE sales SET status = 'voided' WHERE sale_id = p_sale_id;

    -- Reversar stock
    FOR v_item IN
        SELECT si.product_id, si.quantity
          FROM sale_items si WHERE si.sale_id = p_sale_id
    LOOP
        SELECT is_service INTO v_is_service
          FROM products WHERE product_id = v_item.product_id;

        IF NOT v_is_service AND v_sale.warehouse_id IS NOT NULL THEN
            PERFORM adjust_warehouse_stock(
                v_item.product_id, v_sale.warehouse_id, v_item.quantity,
                'devolucion', 'sale', p_sale_id, v_uid,
                'Anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8))
            );
        END IF;
    END LOOP;

    -- Caso C: nada más si no hubo cobro
    IF v_sale.amount_paid = 0 THEN
        RETURN;
    END IF;

    -- Expense P&L en ambos casos (A y B)
    INSERT INTO accounting_entries (site_id, entry_type, category, description, amount, sale_id)
    VALUES (
        v_sale.site_id,
        'expense',
        CASE WHEN v_sale.is_on_account THEN 'Anulación crédito' ELSE 'Anulación venta' END,
        'Anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
        v_sale.amount_paid,
        p_sale_id
    );

    IF v_sale.is_on_account THEN
        -- Caso B: emitir customer_credits, NO tocar sale_payments, NO cash_movement.
        INSERT INTO customer_credits
            (customer_id, amount, source_type, source_sale_id, site_id, notes, created_by)
        VALUES (
            v_sale.customer_id,
            v_sale.amount_paid,
            'void_sale',
            p_sale_id,
            v_sale.site_id,
            'Saldo a favor por anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8)),
            v_uid
        );
    ELSE
        -- Caso A: sale_payments intactos. Refund cash en turno actual si aplica.
        SELECT COALESCE(SUM(amount), 0) INTO v_cash_refund
          FROM sale_payments
         WHERE sale_id = p_sale_id
           AND status = 'active'
           AND (payment_method ILIKE '%efectivo%' OR payment_method ILIKE '%cash%');

        IF v_cash_refund > 0 THEN
            SELECT shift_id INTO v_current_shift
              FROM pos_shifts
             WHERE site_id = v_sale.site_id AND status = 'open';

            IF v_current_shift IS NULL THEN
                RAISE EXCEPTION 'Para anular una venta con cobros en efectivo debes tener un turno abierto en la sede.';
            END IF;

            INSERT INTO cash_movements (shift_id, type, amount, description)
            VALUES (
                v_current_shift,
                'refund',
                v_cash_refund,
                'Refund anulación venta #' || COALESCE(v_sale.numero::TEXT, LEFT(p_sale_id::TEXT, 8))
            );
        END IF;
    END IF;
END;
$$;

REVOKE ALL     ON FUNCTION void_sale(UUID,UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION void_sale(UUID,UUID) TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK manual (correr solo si algo se rompe post-aplicación en branch):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS void_sale(UUID,UUID);
-- DROP FUNCTION IF EXISTS close_shift(UUID,NUMERIC,TEXT,TEXT);
-- DROP FUNCTION IF EXISTS get_shift_balance(UUID);
-- DROP FUNCTION IF EXISTS create_sale(UUID,NUMERIC,JSONB,TEXT,NUMERIC,TEXT,TEXT,UUID,UUID,UUID,UUID,BOOLEAN,NUMERIC);
-- DROP FUNCTION IF EXISTS verify_credit_integrity();
-- -- Restaurar create_sale/close_shift/void_sale desde
-- --   scripts/01_functions.sql y scripts/13_shifts_to_secdef_rpc.sql
-- --
-- -- Reversión de esquema requiere restore desde snapshot del branch:
-- --   DROP TABLE customer_credits, sale_payments;
-- --   ALTER TABLE sales DROP COLUMN balance_due, amount_paid, is_on_account;
-- --   ALTER TABLE customers DROP COLUMN is_walk_in, allows_credit;
-- COMMIT;
-- =============================================================================
