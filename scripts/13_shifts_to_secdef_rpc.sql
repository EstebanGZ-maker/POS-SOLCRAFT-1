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
