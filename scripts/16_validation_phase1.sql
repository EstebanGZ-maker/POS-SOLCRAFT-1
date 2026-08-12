-- =============================================================================
-- 16_validation_phase1.sql — Validación local de la Fase 1 de ajustes.
--
-- Requisitos previos:
--   * scripts/16_inventory_adjustments_phase1.sql ya aplicado a la DB local
--     (encima del baseline monolítico + stubs de auth/roles).
--   * Existe al menos un admin en user_profiles (mismo bootstrap que la
--     validación de credit-sales Fase 1).
--
-- Alcance:
--   1. Bootstrap del contexto auth (auth.uid() vía request.jwt.claim.sub).
--   2. Seed sintético: site + warehouse (primary) + producto + stock inicial.
--   3. Tests:
--      T1. create_adjustment sobre incremento válido → header/items/kardex
--          cuadran; stock aumentó; total_adjusted correcto.
--      T2. create_adjustment sobre disminución válida (parcial del stock) →
--          stock disminuye; movement 'ajuste' creado; invariante kardex 0.
--      T3. ATOMICIDAD: create_adjustment con 2 items donde el segundo
--          provoca stock insuficiente → RAISE + rollback total (0 header,
--          0 items, 0 movements para ese ajuste; stock del primer producto
--          intacto).
--      T4. void_adjustment sobre ajuste activo → status='voided', kardex
--          revertido, stock vuelve al valor previo al ajuste.
--      T5. void_adjustment sobre ya voided → RAISE 'ya está anulado'.
--      T6. Rol insuficiente (vendedor) intentando crear ajuste → RAISE.
--      T7. Encargado de otra sede intentando ajustar → RAISE.
--      T8. Delta kardex post-todo = 0 (Fase 1 no introdujo descuadre).
--
-- Todo dentro de una transacción con ROLLBACK final: no persiste nada.
-- Cualquier assertion fallida aborta con RAISE EXCEPTION.
--
-- LOCAL ÚNICAMENTE. No se aplica a prod desde aquí — cuando subamos a Pro,
-- Fase 1 de ajustes se suma a la misma cola del branch real de Supabase que
-- Fase 1 de credit-sales.
-- =============================================================================

BEGIN;

-- Snapshot de invariante kardex antes del escenario (el seed demo del
-- baseline mete stock sin movements, así que se compara por delta).
CREATE TEMP TABLE _snap AS
SELECT (SELECT COUNT(*) FROM verify_kardex_integrity()) AS kardex_pre;

DO $$
DECLARE
    v_admin       UUID;
    v_encargado_a UUID;
    v_encargado_b UUID;
    v_vendedor    UUID;
    v_site_a      UUID;
    v_site_b      UUID;
    v_wh_a        UUID;
    v_wh_b        UUID;
    v_prod        UUID;
    v_prod2       UUID;
    v_prod3       UUID;
    v_stock0_a    INTEGER;
    v_stock0_a_after_t1 INTEGER;
    v_stock0_a_after_t2 INTEGER;
    v_adj1        UUID;
    v_adj2        UUID;
    v_headers_before INT; v_headers_after INT;
    v_items_before   INT; v_items_after   INT;
    v_moves_before   INT; v_moves_after   INT;
    v_status_check TEXT;
    v_stock_now INTEGER;
    v_total_expected NUMERIC;
    v_ok BOOLEAN;
BEGIN
    -- =========================================================================
    -- BOOTSTRAP AUTH: creamos 3 usuarios (admin, encargado sedeA, vendedor)
    -- y setteamos JWT claim para que auth.uid() funcione dentro de las SECDEF.
    -- =========================================================================
    INSERT INTO auth.users (id, email) VALUES
      ('11111111-0000-0000-0000-000000000001', 'admin+val16@test'),
      ('11111111-0000-0000-0000-000000000002', 'encargado+val16a@test'),
      ('11111111-0000-0000-0000-000000000003', 'vendedor+val16@test'),
      ('11111111-0000-0000-0000-000000000004', 'encargado+val16b@test')
    ON CONFLICT (id) DO NOTHING;
    v_admin       := '11111111-0000-0000-0000-000000000001';
    v_encargado_a := '11111111-0000-0000-0000-000000000002';
    v_vendedor    := '11111111-0000-0000-0000-000000000003';
    v_encargado_b := '11111111-0000-0000-0000-000000000004';

    -- =========================================================================
    -- SEED: 2 sites (para probar cross-site RLS), 1 warehouse cada uno, 3 prods
    -- =========================================================================
    INSERT INTO sites (name, is_central) VALUES ('Sede Val16 A', FALSE) RETURNING site_id INTO v_site_a;
    INSERT INTO sites (name, is_central) VALUES ('Sede Val16 B', FALSE) RETURNING site_id INTO v_site_b;

    INSERT INTO warehouses (site_id, name, is_primary) VALUES (v_site_a, 'Principal A', TRUE)
      RETURNING warehouse_id INTO v_wh_a;
    INSERT INTO warehouses (site_id, name, is_primary) VALUES (v_site_b, 'Principal B', TRUE)
      RETURNING warehouse_id INTO v_wh_b;

    -- Perfiles de usuarios (después de las sedes para poder linkear encargado).
    INSERT INTO user_profiles (id, email, full_name, role, site_id) VALUES
      (v_admin,       'admin+val16@test',      'Admin Val16',      'admin',     NULL),
      (v_encargado_a, 'encargado+val16a@test', 'Encargado Val16A', 'encargado', v_site_a),
      (v_encargado_b, 'encargado+val16b@test', 'Encargado Val16B', 'encargado', v_site_b),
      (v_vendedor,    'vendedor+val16@test',   'Vendedor Val16',   'vendedor',  v_site_a)
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, site_id = EXCLUDED.site_id;

    INSERT INTO products (name, code, unit, cost, price, is_service, is_active, stock_quantity)
      VALUES ('Producto Val16 #1', 'VAL16-01', 'Unidad', 1000, 2000, FALSE, TRUE, 0)
      RETURNING product_id INTO v_prod;
    INSERT INTO products (name, code, unit, cost, price, is_service, is_active, stock_quantity)
      VALUES ('Producto Val16 #2', 'VAL16-02', 'Unidad', 500, 1200, FALSE, TRUE, 0)
      RETURNING product_id INTO v_prod2;
    INSERT INTO products (name, code, unit, cost, price, is_service, is_active, stock_quantity)
      VALUES ('Producto Val16 #3', 'VAL16-03', 'Unidad', 800, 1500, FALSE, TRUE, 0)
      RETURNING product_id INTO v_prod3;

    -- Bootstrap stock inicial vía adjust_warehouse_stock (respeta el kardex).
    PERFORM adjust_warehouse_stock(v_prod,  v_wh_a, 10, 'apertura', 'seed', NULL, v_admin, 'seed val16');
    PERFORM adjust_warehouse_stock(v_prod2, v_wh_a,  5, 'apertura', 'seed', NULL, v_admin, 'seed val16');
    PERFORM adjust_warehouse_stock(v_prod3, v_wh_a,  3, 'apertura', 'seed', NULL, v_admin, 'seed val16');

    SELECT quantity INTO v_stock0_a FROM product_stock WHERE product_id = v_prod AND warehouse_id = v_wh_a;
    IF v_stock0_a <> 10 THEN
        RAISE EXCEPTION 'Bootstrap fallido: se esperaba 10, hay % en v_prod/v_wh_a', v_stock0_a;
    END IF;
    RAISE NOTICE '✓ Bootstrap OK: v_prod stock=10 en sede A.';

    -- =========================================================================
    -- CONTEXTO AUTH: admin
    -- =========================================================================
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM set_config('request.jwt.claims',
             jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

    -- =========================================================================
    -- T1 — create_adjustment (incremento válido)
    -- =========================================================================
    v_adj1 := create_adjustment(
        v_wh_a,
        'test T1 incremento',
        jsonb_build_array(
          jsonb_build_object('product_id', v_prod, 'cost', 1000, 'objective', 'incrementar', 'quantity', 4),
          jsonb_build_object('product_id', v_prod2,'cost', 500,  'objective', 'incrementar', 'quantity', 2)
        )
    );
    -- Header: total_adjusted = 4*1000 + 2*500 = 5000; created_by=admin; site_id=A
    IF (SELECT total_adjusted FROM inventory_adjustments WHERE adjustment_id = v_adj1) <> 5000 THEN
        RAISE EXCEPTION 'T1: total_adjusted != 5000';
    END IF;
    IF (SELECT created_by FROM inventory_adjustments WHERE adjustment_id = v_adj1) <> v_admin THEN
        RAISE EXCEPTION 'T1: created_by != admin';
    END IF;
    IF (SELECT site_id FROM inventory_adjustments WHERE adjustment_id = v_adj1) <> v_site_a THEN
        RAISE EXCEPTION 'T1: site_id != site_a';
    END IF;
    IF (SELECT status FROM inventory_adjustments WHERE adjustment_id = v_adj1) <> 'active' THEN
        RAISE EXCEPTION 'T1: status != active';
    END IF;
    -- Confirmar que motivo y numero quedan NULL (Fase 1 no los cablea)
    IF (SELECT motivo FROM inventory_adjustments WHERE adjustment_id = v_adj1) IS NOT NULL THEN
        RAISE EXCEPTION 'T1: motivo debería ser NULL en Fase 1';
    END IF;
    IF (SELECT numero FROM inventory_adjustments WHERE adjustment_id = v_adj1) IS NOT NULL THEN
        RAISE EXCEPTION 'T1: numero debería ser NULL en Fase 1';
    END IF;
    -- Items: 2 filas
    IF (SELECT COUNT(*) FROM adjustment_items WHERE adjustment_id = v_adj1) <> 2 THEN
        RAISE EXCEPTION 'T1: se esperaban 2 items';
    END IF;
    -- Stock: v_prod pasó de 10 a 14
    SELECT quantity INTO v_stock0_a_after_t1 FROM product_stock WHERE product_id = v_prod AND warehouse_id = v_wh_a;
    IF v_stock0_a_after_t1 <> 14 THEN
        RAISE EXCEPTION 'T1: stock v_prod = %, se esperaba 14', v_stock0_a_after_t1;
    END IF;
    -- Movements: 2 nuevos con movement_type='ajuste', reference_id=v_adj1
    IF (SELECT COUNT(*) FROM stock_movements WHERE reference_id = v_adj1 AND movement_type = 'ajuste') <> 2 THEN
        RAISE EXCEPTION 'T1: se esperaban 2 movements ajuste para v_adj1';
    END IF;
    -- No accounting entries (Fase 1)
    IF (SELECT COUNT(*) FROM accounting_entries WHERE description LIKE '%' || v_adj1::text || '%') > 0 THEN
        RAISE EXCEPTION 'T1: Fase 1 no debe generar accounting_entries';
    END IF;
    RAISE NOTICE '✓ T1 OK: incremento atómico, sin contabilidad, sin numero/motivo.';

    -- =========================================================================
    -- T2 — create_adjustment (disminución válida)
    -- =========================================================================
    v_adj2 := create_adjustment(
        v_wh_a,
        'test T2 disminucion',
        jsonb_build_array(
          jsonb_build_object('product_id', v_prod, 'cost', 1000, 'objective', 'disminuir', 'quantity', 3)
        )
    );
    SELECT quantity INTO v_stock0_a_after_t2 FROM product_stock WHERE product_id = v_prod AND warehouse_id = v_wh_a;
    IF v_stock0_a_after_t2 <> 11 THEN  -- 14 - 3
        RAISE EXCEPTION 'T2: stock v_prod = %, se esperaba 11', v_stock0_a_after_t2;
    END IF;
    RAISE NOTICE '✓ T2 OK: disminución bajó stock 14→11.';

    -- =========================================================================
    -- T3 — ATOMICIDAD: fallo en un item aborta todo el ajuste
    -- Intento: incrementar v_prod3 en 5 (OK) + disminuir v_prod2 en 999 (FAIL).
    -- Se espera RAISE por stock insuficiente → nada persistido.
    -- =========================================================================
    SELECT COUNT(*) INTO v_headers_before FROM inventory_adjustments;
    SELECT COUNT(*) INTO v_items_before   FROM adjustment_items;
    SELECT COUNT(*) INTO v_moves_before   FROM stock_movements;
    -- Snapshot del stock afectado antes del intento
    v_stock_now := (SELECT quantity FROM product_stock WHERE product_id = v_prod3 AND warehouse_id = v_wh_a);

    v_ok := TRUE;
    BEGIN
      PERFORM create_adjustment(
          v_wh_a,
          'test T3 atomicidad',
          jsonb_build_array(
            jsonb_build_object('product_id', v_prod3, 'cost', 800, 'objective', 'incrementar', 'quantity', 5),
            jsonb_build_object('product_id', v_prod2, 'cost', 500, 'objective', 'disminuir',   'quantity', 999)
          )
      );
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN
      -- Esperado: adjust_warehouse_stock RAISE 'Stock insuficiente'
      NULL;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'T3: create_adjustment NO abortó; se esperaba RAISE por stock insuficiente';
    END IF;
    -- Verificar rollback total: mismos counts que antes
    SELECT COUNT(*) INTO v_headers_after FROM inventory_adjustments;
    SELECT COUNT(*) INTO v_items_after   FROM adjustment_items;
    SELECT COUNT(*) INTO v_moves_after   FROM stock_movements;
    IF v_headers_after <> v_headers_before THEN
        RAISE EXCEPTION 'T3: quedó header huérfano (antes=% después=%)', v_headers_before, v_headers_after;
    END IF;
    IF v_items_after <> v_items_before THEN
        RAISE EXCEPTION 'T3: quedaron items huérfanos';
    END IF;
    IF v_moves_after <> v_moves_before THEN
        RAISE EXCEPTION 'T3: quedaron stock_movements huérfanos (rollback parcial detectado)';
    END IF;
    -- Stock v_prod3 debe seguir igual (no debe haber subido con el primer item)
    IF (SELECT quantity FROM product_stock WHERE product_id = v_prod3 AND warehouse_id = v_wh_a) <> v_stock_now THEN
        RAISE EXCEPTION 'T3: stock v_prod3 cambió, se esperaba rollback total';
    END IF;
    RAISE NOTICE '✓ T3 OK: fallo del item 2 revirtió todo (header/items/movements/stock intactos).';

    -- =========================================================================
    -- T4 — void_adjustment sobre v_adj1 → status voided + stock revertido
    -- =========================================================================
    PERFORM void_adjustment(v_adj1);
    IF (SELECT status FROM inventory_adjustments WHERE adjustment_id = v_adj1) <> 'voided' THEN
        RAISE EXCEPTION 'T4: status != voided';
    END IF;
    -- Después de void de v_adj1 (que subió v_prod 4), stock v_prod baja de 11 a 7
    -- (T2 lo dejó en 11; v_adj1 había añadido 4; al reversar quita 4 → 7)
    IF (SELECT quantity FROM product_stock WHERE product_id = v_prod AND warehouse_id = v_wh_a) <> 7 THEN
        RAISE EXCEPTION 'T4: stock v_prod = %, se esperaba 7 tras void', (SELECT quantity FROM product_stock WHERE product_id = v_prod AND warehouse_id = v_wh_a);
    END IF;
    -- v_prod2 pasa de 7 (5+2 del T1) a 5 (revierte los 2)
    IF (SELECT quantity FROM product_stock WHERE product_id = v_prod2 AND warehouse_id = v_wh_a) <> 5 THEN
        RAISE EXCEPTION 'T4: stock v_prod2 != 5 tras void';
    END IF;
    -- 2 movements nuevos de reversión (delta invertido)
    IF (SELECT COUNT(*) FROM stock_movements WHERE reference_id = v_adj1 AND movement_type = 'ajuste') <> 4 THEN
        -- 2 originales + 2 de reversión = 4
        RAISE EXCEPTION 'T4: se esperaban 4 movements totales para v_adj1 (2 originales + 2 reversión)';
    END IF;
    -- Fase 1: sin asiento compensatorio en accounting_entries
    IF (SELECT COUNT(*) FROM accounting_entries WHERE description LIKE '%' || v_adj1::text || '%') > 0 THEN
        RAISE EXCEPTION 'T4: Fase 1 no debe asentar reverso contable';
    END IF;
    RAISE NOTICE '✓ T4 OK: void_adjustment revirtió stock, sin asiento.';

    -- =========================================================================
    -- T5 — void_adjustment sobre ya voided → RAISE
    -- =========================================================================
    v_ok := TRUE;
    BEGIN
      PERFORM void_adjustment(v_adj1);
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'T5: void_adjustment sobre ya voided debía abortar';
    END IF;
    RAISE NOTICE '✓ T5 OK: doble void bloqueado.';

    -- =========================================================================
    -- T6 — Vendedor intentando crear ajuste → RAISE 'sin permisos'
    -- =========================================================================
    PERFORM set_config('request.jwt.claim.sub', v_vendedor::text, true);
    v_ok := TRUE;
    BEGIN
      PERFORM create_adjustment(
          v_wh_a, 'test T6 vendedor',
          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'cost', 100, 'objective', 'incrementar', 'quantity', 1))
      );
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'T6: vendedor pudo crear ajuste (debía ser rechazado)';
    END IF;
    RAISE NOTICE '✓ T6 OK: vendedor rechazado.';

    -- =========================================================================
    -- T7 — Encargado de sede B intentando ajustar sede A → RAISE
    -- =========================================================================
    PERFORM set_config('request.jwt.claim.sub', v_encargado_b::text, true);
    v_ok := TRUE;
    BEGIN
      PERFORM create_adjustment(
          v_wh_a, 'test T7 encargado cross-site',
          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'cost', 100, 'objective', 'incrementar', 'quantity', 1))
      );
      v_ok := FALSE;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'T7: encargado de sede B pudo ajustar en sede A (debía ser rechazado)';
    END IF;
    RAISE NOTICE '✓ T7 OK: encargado cross-site rechazado.';

    -- Restauramos admin para test final
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- =========================================================================
    -- T8 — Invariante kardex delta = 0 (Fase 1 no introdujo descuadre)
    -- =========================================================================
    IF (SELECT COUNT(*) FROM verify_kardex_integrity())
       <> (SELECT kardex_pre FROM _snap) THEN
        RAISE EXCEPTION 'T8: verify_kardex_integrity() delta != 0';
    END IF;
    RAISE NOTICE '✓ T8 OK: invariante kardex intacta.';

    RAISE NOTICE '================================================================';
    RAISE NOTICE 'FASE 1 AJUSTES — VALIDACIÓN LOCAL: OK (T1..T8 pasaron).';
    RAISE NOTICE '================================================================';
END $$;

ROLLBACK;
