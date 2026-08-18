-- =============================================================================
-- 17c_v2_adjustments_no_expense.sql — Ajustes Fase 2C v2 (método aprobado
-- 2026-08-17: capitalización + COGS al vender).
--
-- REEMPLAZA scripts/17c_adjustments_contabilidad.sql (v1, INVALIDADO).
-- Ver docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2 (tabla nueva), §10.1 (DN4).
--
-- ⚠ RELEASE TRIPLE ACOPLADO: 17c v2 + 17e (COGS) + refactor TS 2D deben
-- ir en la misma ventana. Ninguno se puede fasear. Ver ESTADO-PENDIENTES.md
-- §0 "GATE CONTADOR RESUELTO" para detalle.
--
-- Riesgo ALTO. Requiere: 17b_adjustments_wac.sql aplicado.
--
-- Alcance:
--   1. ALTER accounting_entries ADD adjustment_id UUID FK (D4) — se
--      mantiene del diseño original de 2C, ya que sigue teniendo sentido:
--      el asiento de merma para disminuciones se ancla al ajuste vía
--      esta FK. También la usa void_adjustment y
--      verify_adjustment_accounting_integrity.
--   2. create_adjustment v2c-2: firma nueva con p_motivo TEXT DEFAULT NULL
--      (misma que v1). Diferencias vs v1:
--        - Recalcula WAC para los 3 motivos (compra, sobrante, correccion),
--          no solo compra. Todos capitalizan al costo que ingresa el
--          usuario.
--        - NO inserta accounting_entries para el bloque de incrementos
--          (ninguno de los 3 motivos genera asiento inmediato). El costo
--          se reconoce cuando la mercancía se venda vía COGS en
--          create_sale (17e).
--        - MANTIENE el asiento de merma para disminuciones (§6.1 sin
--          cambio).
--   3. void_adjustment v2c-2: compensa solo el asiento de merma si
--      existe. Ya no hay asientos de compra/sobrante que compensar.
--      Sigue sin revertir products.cost (D5).
--   4. verify_adjustment_accounting_integrity() sin cambio semántico —
--      sigue verificando que voided con asientos suma neto=0.
--
-- Regla de validación de motivo sin cambio:
--   - Incrementos → motivo obligatorio (compra|sobrante|correccion).
--   - 100% disminuciones → motivo debe ser NULL.
--   - correccion exige notes no vacío.
--
-- Coordinación de deploy: 17c v2 debe ir con 17e (create_sale COGS) y
-- refactor TS de 2D (receiveMerchandise/ingressNewProduct/createAdjustment
-- wrapper) en el mismo commit. Aplicar solo 17c v2 sin 17e = catálogo
-- capitalizado sin reconocimiento COGS perpetuo (utilidad inflada).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. accounting_entries.adjustment_id (D4) — SE MANTIENE
-- =============================================================================

ALTER TABLE accounting_entries
  ADD COLUMN IF NOT EXISTS adjustment_id UUID
    REFERENCES inventory_adjustments(adjustment_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_entries_adjustment
  ON accounting_entries (adjustment_id) WHERE adjustment_id IS NOT NULL;

-- =============================================================================
-- 2. create_adjustment v2c-2 — con motivo, sin asientos de incrementos
-- =============================================================================

-- Firma cambia de 3 args (v2b actual en prod) a 4 args con p_motivo.
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
    v_uid             UUID := auth.uid();
    v_role            TEXT;
    v_user_site       UUID;
    v_site_id         UUID;
    v_adj_id          UUID;
    v_numero          INTEGER;
    v_item            RECORD;
    v_delta           INTEGER;
    v_total           NUMERIC := 0;
    v_cost_before     NUMERIC;
    v_stock_before    INTEGER;
    v_new_cost        NUMERIC;
    v_has_incrementar BOOLEAN;
    v_has_disminuir   BOOLEAN;
    v_amt_disminuir   NUMERIC;
    v_motivo          TEXT := p_motivo;
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

    IF v_motivo IS NOT NULL AND v_motivo NOT IN ('compra','sobrante','correccion') THEN
        RAISE EXCEPTION 'Motivo inválido: % (esperado compra|sobrante|correccion).', v_motivo;
    END IF;

    -- Composición del ajuste: incrementos, disminuciones, o mixto.
    -- v_amt_disminuir se usa solo para el asiento de merma; v_amt_incrementar
    -- ya NO se calcula porque no genera asiento (método nuevo).
    SELECT bool_or((i->>'objective') = 'incrementar'),
           bool_or((i->>'objective') = 'disminuir'),
           COALESCE(SUM(CASE WHEN (i->>'objective')='disminuir'
                             THEN (i->>'cost')::NUMERIC * (i->>'quantity')::INTEGER
                             ELSE 0 END), 0)
      INTO v_has_incrementar, v_has_disminuir, v_amt_disminuir
      FROM jsonb_array_elements(p_items) AS i;

    -- Reglas de motivo (sin cambio vs v1).
    IF v_has_incrementar AND v_motivo IS NULL THEN
        RAISE EXCEPTION 'El motivo es obligatorio cuando el ajuste tiene incrementos (compra|sobrante|correccion).';
    END IF;
    IF NOT v_has_incrementar AND v_motivo IS NOT NULL THEN
        RAISE EXCEPTION 'El motivo debe ser NULL cuando el ajuste es 100%% disminuciones (solo merma).';
    END IF;
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

    -- Numeración (DN3 fallback on-the-fly).
    UPDATE adjustment_counters SET last_numero = last_numero + 1
     WHERE site_id = v_site_id RETURNING last_numero INTO v_numero;
    IF v_numero IS NULL THEN
        INSERT INTO adjustment_counters (site_id, last_numero) VALUES (v_site_id, 1)
          ON CONFLICT (site_id) DO UPDATE SET last_numero = adjustment_counters.last_numero + 1
          RETURNING last_numero INTO v_numero;
    END IF;

    -- total_adjusted refleja el valor movido total (incremento + disminución),
    -- sin importar que ya no se asiente por incrementos.
    SELECT COALESCE(SUM(
             (i->>'cost')::NUMERIC * (i->>'quantity')::INTEGER
           ), 0)
      INTO v_total
      FROM jsonb_array_elements(p_items) AS i;

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

        -- WAC: aplica para los 3 motivos (compra, sobrante, correccion) si
        -- cost>0. Método NUEVO — todos capitalizan.
        -- Orden crítico igual al de 17b (spec §5.1.1): LOCK products → READ
        -- stock global BEFORE → adjust → recalc.
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
    -- Asientos contables — método NUEVO:
    --   * Incrementos (compra/sobrante/correccion): NINGÚN asiento inmediato.
    --     Capitalizan al inventario vía WAC. El costo se reconoce cuando la
    --     mercancía se venda vía COGS en create_sale (17e).
    --   * Disminuciones (merma): 1 asiento expense "Merma / Ajuste negativo"
    --     — SIN CAMBIO vs v1.
    -- =========================================================================

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
-- 3. void_adjustment v2c-2 — compensa solo asiento de merma si existe
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

    -- Reversa de kardex por-ítem con delta invertido. NO se recalcula
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

    -- Compensar asientos contables originales del ajuste. Con el método
    -- nuevo, solo puede haber asiento de merma (los incrementos ya no
    -- asientan). El bloque sigue siendo genérico por si en el futuro
    -- se añaden otros asientos por ajuste.
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
-- 4. verify_adjustment_accounting_integrity() — sin cambio semántico
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
