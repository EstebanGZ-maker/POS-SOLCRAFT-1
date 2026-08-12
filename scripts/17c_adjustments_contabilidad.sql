-- =============================================================================
-- 17c_adjustments_contabilidad.sql — Ajustes Fase 2C (asientos por motivo).
--
-- ⚠⚠⚠ GATE CONTABLE — NO APLICAR A PROD SIN OK DEL CONTADOR ⚠⚠⚠
--
-- El tratamiento `motivo='compra' → expense inmediato "Compra de mercancía"`
-- es una simplificación que impacta P&L al comprar, cuando el modelo puro
-- (partida doble) NO lo haría (Débito Inventario / Crédito Caja o
-- Proveedores; utilidad reconoce al vender, no al comprar).
--
-- Sobrante (income) y correccion (sin asiento) son defendibles y coinciden
-- con partida doble. Ver docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2 (subsección
-- "Gate contable de Fase 2 — punto crítico único") para las 3 alternativas
-- si el contador rechaza compra→expense inmediato.
--
-- Cuando el contador valide, documentar la fecha + quién validó en el commit
-- que aplique esta migración a prod.
--
-- Riesgo ALTO. Requiere: 17b_adjustments_wac.sql aplicado.
--
-- Alcance:
--   1. ALTER accounting_entries ADD adjustment_id UUID FK (D4).
--   2. create_adjustment v2c: firma nueva con p_motivo (TEXT DEFAULT NULL).
--      Genera asientos según motivo + reglas de merma para disminuciones.
--   3. void_adjustment v2c: compensa los asientos referenciados por
--      adjustment_id (income↔expense inverso). No revierte products.cost.
--   4. Nueva función verify_adjustment_accounting_integrity(): asegura que
--      cada ajuste voided con asientos suma neto = 0 (compensación completa).
--
-- El p_motivo tiene DEFAULT NULL para no romper callers que aún no lo
-- pasan. Regla: si el ajuste tiene items 'incrementar' → motivo obligatorio
-- (RAISE si NULL); si es 100% disminuciones → motivo debe ser NULL (RAISE
-- si viene).
--
-- Coordinación de deploy: 17c debe ir junto con la actualización de la
-- Server Action `createAdjustment` para que el UI pase `p_motivo` correcto.
-- Antes de 17c, el UI no puede crear ajustes con incrementos si el motivo
-- no está incluido — Fase 3 (UI) o adaptación del wrapper para pasar un
-- motivo default para receiveMerchandise ('compra') deben coordinarse.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. accounting_entries.adjustment_id (D4)
-- =============================================================================

ALTER TABLE accounting_entries
  ADD COLUMN IF NOT EXISTS adjustment_id UUID
    REFERENCES inventory_adjustments(adjustment_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_entries_adjustment
  ON accounting_entries (adjustment_id) WHERE adjustment_id IS NOT NULL;

-- =============================================================================
-- 2. create_adjustment v2c — con motivo y asientos
-- =============================================================================

-- Firma nueva: agrega p_motivo al final. CREATE OR REPLACE no basta porque
-- cambia el nº de args; DROP explícito.
DROP FUNCTION IF EXISTS create_adjustment(UUID, TEXT, JSONB);

CREATE OR REPLACE FUNCTION create_adjustment(
    p_warehouse_id UUID,
    p_notes        TEXT,
    p_items        JSONB,
    p_motivo       TEXT DEFAULT NULL   -- 'compra' | 'sobrante' | 'correccion'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid            UUID := auth.uid();
    v_role           TEXT;
    v_user_site      UUID;
    v_site_id        UUID;
    v_adj_id         UUID;
    v_numero         INTEGER;
    v_item           RECORD;
    v_delta          INTEGER;
    v_total          NUMERIC := 0;
    v_cost_before    NUMERIC;
    v_stock_before   INTEGER;
    v_new_cost       NUMERIC;
    v_has_incrementar BOOLEAN;
    v_has_disminuir   BOOLEAN;
    v_amt_incrementar NUMERIC;
    v_amt_disminuir   NUMERIC;
    v_motivo         TEXT := p_motivo;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado') THEN
        RAISE EXCEPTION 'Sin permisos para crear ajustes de inventario.';
    END IF;
    IF p_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'La bodega es obligatoria.';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'El ajuste no tiene ítems.';
    END IF;

    -- Validar motivo si viene: debe ser uno de los 3 valores.
    IF v_motivo IS NOT NULL AND v_motivo NOT IN ('compra','sobrante','correccion') THEN
        RAISE EXCEPTION 'Motivo inválido: % (esperado compra|sobrante|correccion).', v_motivo;
    END IF;

    -- Chequeo de composición: hay incrementos, disminuciones, o mixto.
    SELECT bool_or((i->>'objective') = 'incrementar'),
           bool_or((i->>'objective') = 'disminuir'),
           COALESCE(SUM(CASE WHEN (i->>'objective')='incrementar'
                             THEN (i->>'cost')::NUMERIC * (i->>'quantity')::INTEGER
                             ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN (i->>'objective')='disminuir'
                             THEN (i->>'cost')::NUMERIC * (i->>'quantity')::INTEGER
                             ELSE 0 END), 0)
      INTO v_has_incrementar, v_has_disminuir, v_amt_incrementar, v_amt_disminuir
      FROM jsonb_array_elements(p_items) AS i;

    -- Regla del motivo:
    --   * Hay incrementos → motivo OBLIGATORIO.
    --   * 100% disminuciones → motivo DEBE ser NULL.
    IF v_has_incrementar AND v_motivo IS NULL THEN
        RAISE EXCEPTION 'El motivo es obligatorio cuando el ajuste tiene incrementos (compra|sobrante|correccion).';
    END IF;
    IF NOT v_has_incrementar AND v_motivo IS NOT NULL THEN
        RAISE EXCEPTION 'El motivo debe ser NULL cuando el ajuste es 100%% disminuciones (solo merma).';
    END IF;

    -- correccion exige notes no vacío.
    IF v_motivo = 'correccion' AND (p_notes IS NULL OR btrim(p_notes) = '') THEN
        RAISE EXCEPTION 'Los ajustes de corrección requieren una justificación en notes.';
    END IF;

    SELECT w.site_id INTO v_site_id
      FROM warehouses w WHERE w.warehouse_id = p_warehouse_id;
    IF v_site_id IS NULL THEN
        RAISE EXCEPTION 'La bodega % no existe o no tiene sede asignada.', p_warehouse_id;
    END IF;
    IF v_role = 'encargado' AND v_user_site IS DISTINCT FROM v_site_id THEN
        RAISE EXCEPTION 'Solo puedes crear ajustes en tu sede.';
    END IF;

    -- Numeración.
    UPDATE adjustment_counters SET last_numero = last_numero + 1
     WHERE site_id = v_site_id RETURNING last_numero INTO v_numero;
    IF v_numero IS NULL THEN
        INSERT INTO adjustment_counters (site_id, last_numero) VALUES (v_site_id, 1)
          ON CONFLICT (site_id) DO UPDATE SET last_numero = adjustment_counters.last_numero + 1
          RETURNING last_numero INTO v_numero;
    END IF;

    v_total := v_amt_incrementar + v_amt_disminuir;

    INSERT INTO inventory_adjustments
        (warehouse_id, site_id, notes, total_adjusted, created_by, numero, motivo)
    VALUES
        (p_warehouse_id, v_site_id, p_notes, v_total, v_uid, v_numero, v_motivo)
    RETURNING adjustment_id INTO v_adj_id;

    FOR v_item IN
        SELECT
            (i->>'product_id')::UUID    AS product_id,
            COALESCE((i->>'cost')::NUMERIC, 0) AS cost,
            (i->>'objective')::TEXT     AS objective,
            (i->>'quantity')::INTEGER   AS quantity
          FROM jsonb_array_elements(p_items) AS i
    LOOP
        IF v_item.product_id IS NULL THEN
            RAISE EXCEPTION 'Falta product_id en un ítem del ajuste.';
        END IF;
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'La cantidad debe ser > 0 (producto %).', v_item.product_id;
        END IF;
        IF v_item.cost < 0 THEN
            RAISE EXCEPTION 'El costo no puede ser negativo (producto %).', v_item.product_id;
        END IF;
        IF v_item.objective NOT IN ('incrementar','disminuir') THEN
            RAISE EXCEPTION 'Objective inválido: %.', v_item.objective;
        END IF;

        INSERT INTO adjustment_items
            (adjustment_id, product_id, cost, objective, quantity)
        VALUES
            (v_adj_id, v_item.product_id, v_item.cost, v_item.objective, v_item.quantity);

        -- WAC (§5.1.1)
        IF v_item.objective = 'incrementar' AND v_item.cost > 0 THEN
            SELECT cost INTO v_cost_before FROM products
             WHERE product_id = v_item.product_id FOR UPDATE;
            SELECT COALESCE(SUM(quantity), 0) INTO v_stock_before
              FROM product_stock WHERE product_id = v_item.product_id;
        END IF;

        v_delta := CASE WHEN v_item.objective = 'incrementar'
                        THEN  v_item.quantity ELSE -v_item.quantity END;

        PERFORM adjust_warehouse_stock(
            v_item.product_id, p_warehouse_id, v_delta,
            'ajuste', 'adjustment', v_adj_id, v_uid, p_notes
        );

        IF v_item.objective = 'incrementar' AND v_item.cost > 0 THEN
            v_new_cost := (v_stock_before * COALESCE(v_cost_before, 0)
                          + v_item.quantity * v_item.cost)
                         / (v_stock_before + v_item.quantity);
            UPDATE products SET cost = v_new_cost WHERE product_id = v_item.product_id;
        END IF;
    END LOOP;

    -- =========================================================================
    -- Asientos contables por bloque (§6.2). Se emiten POST-loop porque los
    -- items ya están validados y el kardex ya está aplicado; si algo falla
    -- acá, el rollback de la TX deshace también los items/kardex.
    --
    -- ⚠ compra → expense inmediato PENDIENTE VALIDACIÓN CONTADOR.
    -- =========================================================================

    -- Bloque INCREMENTOS: 1 asiento según motivo, si amount > 0.
    IF v_has_incrementar AND v_amt_incrementar > 0 THEN
        IF v_motivo = 'compra' THEN
            INSERT INTO accounting_entries
                (site_id, entry_type, category, description, amount, adjustment_id)
            VALUES (
                v_site_id, 'expense', 'Compra de mercancía',
                'Ajuste #' || v_numero || ' (compra) — ' || COALESCE(p_notes, ''),
                v_amt_incrementar, v_adj_id
            );
        ELSIF v_motivo = 'sobrante' THEN
            INSERT INTO accounting_entries
                (site_id, entry_type, category, description, amount, adjustment_id)
            VALUES (
                v_site_id, 'income', 'Sobrante de inventario',
                'Ajuste #' || v_numero || ' (sobrante) — ' || COALESCE(p_notes, ''),
                v_amt_incrementar, v_adj_id
            );
        -- motivo='correccion' → sin asiento (P&L = 0).
        END IF;
    END IF;

    -- Bloque DISMINUCIONES: 1 asiento de merma, si amount > 0. Independiente
    -- del motivo (motivo es NULL en 100% disminución, y en mixto la merma
    -- va aparte del bloque de incrementos).
    IF v_has_disminuir AND v_amt_disminuir > 0 THEN
        INSERT INTO accounting_entries
            (site_id, entry_type, category, description, amount, adjustment_id)
        VALUES (
            v_site_id, 'expense', 'Merma / Ajuste negativo',
            'Ajuste #' || v_numero || ' (merma) — ' || COALESCE(p_notes, ''),
            v_amt_disminuir, v_adj_id
        );
    END IF;

    RETURN v_adj_id;
END;
$$;

REVOKE ALL     ON FUNCTION create_adjustment(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_adjustment(UUID, TEXT, JSONB, TEXT) TO authenticated;

-- =============================================================================
-- 3. void_adjustment v2c — compensa asientos referenciados por adjustment_id
-- =============================================================================

CREATE OR REPLACE FUNCTION void_adjustment(
    p_adjustment_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid        UUID := auth.uid();
    v_role       TEXT;
    v_user_site  UUID;
    v_adj        RECORD;
    v_item       RECORD;
    v_delta      INTEGER;
    v_ae         RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado.';
    END IF;
    v_role      := user_role();
    v_user_site := user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado') THEN
        RAISE EXCEPTION 'Sin permisos para anular ajustes.';
    END IF;

    SELECT adjustment_id, warehouse_id, site_id, status, numero
      INTO v_adj
      FROM inventory_adjustments
     WHERE adjustment_id = p_adjustment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ajuste no encontrado.';
    END IF;
    IF v_adj.status = 'voided' THEN
        RAISE EXCEPTION 'El ajuste ya está anulado.';
    END IF;
    IF v_role = 'encargado' AND v_user_site IS DISTINCT FROM v_adj.site_id THEN
        RAISE EXCEPTION 'Solo puedes anular ajustes de tu sede.';
    END IF;

    UPDATE inventory_adjustments SET status = 'voided'
     WHERE adjustment_id = p_adjustment_id;

    -- Reversar kardex por-ítem con delta invertido. NO se recalcula
    -- products.cost (D5): el WAC ya movido se queda; la UI advierte.
    FOR v_item IN
        SELECT product_id, objective, quantity
          FROM adjustment_items WHERE adjustment_id = p_adjustment_id
    LOOP
        v_delta := CASE WHEN v_item.objective = 'incrementar'
                        THEN -v_item.quantity ELSE  v_item.quantity END;
        PERFORM adjust_warehouse_stock(
            v_item.product_id, v_adj.warehouse_id, v_delta,
            'ajuste', 'adjustment', p_adjustment_id, v_uid,
            'Reversión por anulación de ajuste #' || v_adj.numero
        );
    END LOOP;

    -- Compensar asientos contables originales. Cada asiento con
    -- adjustment_id = este ajuste que NO sea ya una compensación
    -- ('Reversión %' en category), genera su inverso.
    FOR v_ae IN
        SELECT entry_id, entry_type, category, amount
          FROM accounting_entries
         WHERE adjustment_id = p_adjustment_id
           AND category NOT LIKE 'Reversión %'
    LOOP
        INSERT INTO accounting_entries
            (site_id, entry_type, category, description, amount, adjustment_id)
        VALUES (
            v_adj.site_id,
            CASE WHEN v_ae.entry_type = 'expense' THEN 'income' ELSE 'expense' END,
            'Reversión ' || v_ae.category,
            'Anulación ajuste #' || v_adj.numero,
            v_ae.amount,
            p_adjustment_id
        );
    END LOOP;
END;
$$;

REVOKE ALL     ON FUNCTION void_adjustment(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION void_adjustment(UUID) TO authenticated;

-- =============================================================================
-- 4. verify_adjustment_accounting_integrity()
--
-- Para cada ajuste voided con asientos, la SUM neta (income - expense)
-- referenciada por adjustment_id debe ser 0 (compensación completa).
-- Retorna filas para ajustes donde NO se cumple.
-- =============================================================================

CREATE OR REPLACE FUNCTION verify_adjustment_accounting_integrity()
RETURNS TABLE (
    adjustment_id UUID,
    numero        INTEGER,
    status        TEXT,
    net_amount    NUMERIC,
    issue         TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT
        a.adjustment_id,
        a.numero,
        a.status,
        COALESCE(SUM(CASE WHEN ae.entry_type='income'  THEN ae.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN ae.entry_type='expense' THEN ae.amount ELSE 0 END), 0)
        AS net_amount,
        'voided con asientos que no compensan a 0' AS issue
    FROM inventory_adjustments a
    JOIN accounting_entries ae ON ae.adjustment_id = a.adjustment_id
    WHERE a.status = 'voided'
    GROUP BY a.adjustment_id, a.numero, a.status
    HAVING (
      COALESCE(SUM(CASE WHEN ae.entry_type='income'  THEN ae.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN ae.entry_type='expense' THEN ae.amount ELSE 0 END), 0)
    ) <> 0;
$$;

GRANT EXECUTE ON FUNCTION verify_adjustment_accounting_integrity() TO authenticated;

COMMIT;
