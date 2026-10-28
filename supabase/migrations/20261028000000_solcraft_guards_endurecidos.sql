-- Migración: endurecer guards de rol en 3 RPCs SECDEF de Solcraft.
-- Fecha: 2026-10-28
-- Scope: SOLO Solcraft (nxszaxwsrtlofqimbfig). Taiwy y celulares-carmen YA
--        tienen el guard endurecido (verificado con pg_get_functiondef); el
--        4° guard (apply_customer_credit) ya fue endurecido antes en Solcraft.
--
-- Motivo: en Solcraft las 3 funciones tenían
--             IF v_role NOT IN ('admin', ...) THEN RAISE 'Sin permisos.'
--         Postgres evalúa `NULL NOT IN (…)` como `NULL`, que la cláusula IF
--         trata como FALSE → NO se dispara el RAISE y el usuario avanza.
--         Un auth.users sin fila en user_profiles (user_role() → NULL)
--         pasaba el guard y podía crear/anular ajustes y registrar ventas.
--         El fix explicita el caso NULL:
--             IF v_role IS NULL OR v_role NOT IN ('admin', ...)
--
-- Patch quirúrgico: cada CREATE OR REPLACE se construyó extrayendo
-- `pg_get_functiondef` actual de Solcraft (regla 4) y reemplazando por sed
-- exactamente la línea del guard — nada más. Diff verificado (1 línea
-- cambiada por función). Se preservan todos los mensajes instructivos
-- actuales de Solcraft (p.ej. "Motivo inválido: % (esperado …).") y el
-- resto del cuerpo.
--
-- NO DROP: se omite deliberadamente `DROP FUNCTION` para preservar los
-- `REVOKE EXECUTE … FROM PUBLIC, anon` aplicados en
-- 20261012000000_revoke_anon_from_internal_rpcs. CREATE OR REPLACE mantiene
-- los privilegios actuales.
--
-- md5 pre (Solcraft, 2026-10-28):
--   create_adjustment  md5_full=d1f5205259f4e7f81c063044d52f89da
--                      md5_norm=f5a3d806211c814dfc33bdd8783d1f32
--                      md5_gate_norm=59d80aba5cd3626d4e4e73eb660ca23b
--   create_sale        md5_full=77037253e10d8bd82c8abcbe40cf99b4
--                      md5_norm=2769225fe9b330f1cba8aaa63fa45a3d
--                      md5_gate_norm=cb0915a4819339ae6f1b40003f7097d5
--   void_adjustment    md5_full=92e40299e08233ffba140d59a96b40aa
--                      md5_norm=faebf41986f294e8c88093d98adb34cf
--                      md5_gate_norm=a80e6a14845c386b5336167fe39e190d
--
-- Baseline del gate (scripts/verify_provisioning.sql §33b) referencia:
--   create_adjustment  e5152d0cb2e76d74b15be946e15e731a
--   create_sale        0be1f9629255bc161dd8163158a2f54b
--   void_adjustment    58c2918a54563224d2f42f0d33dd3b7e
-- Tras aplicar, los 3 cambian su md5_gate_norm. Hay que recomputar y
-- actualizar el baseline en el mismo commit si Esteban quiere que el gate
-- dé verde en Solcraft (hoy esos 3 ya fallan por drift cosmético — ver
-- comentario del gate).
--
-- NO afecta Taiwy ni celulares-carmen.
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.create_adjustment(p_warehouse_id uuid, p_notes text, p_items jsonb, p_motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid UUID:=auth.uid(); v_role TEXT; v_user_site UUID; v_site_id UUID;
    v_adj_id UUID; v_numero INTEGER; v_item RECORD; v_delta INTEGER; v_total NUMERIC:=0;
    v_cost_before NUMERIC; v_stock_before INTEGER; v_new_cost NUMERIC;
    v_has_incrementar BOOLEAN; v_has_disminuir BOOLEAN; v_amt_disminuir NUMERIC;
    v_motivo TEXT:=p_motivo;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
    v_role:=user_role(); v_user_site:=user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado') THEN RAISE EXCEPTION 'Sin permisos para crear ajustes de inventario.'; END IF;
    IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'La bodega es obligatoria.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'El ajuste no tiene ítems.'; END IF;
    IF v_motivo IS NOT NULL AND v_motivo NOT IN ('compra','sobrante','correccion') THEN
        RAISE EXCEPTION 'Motivo inválido: % (esperado compra|sobrante|correccion).', v_motivo; END IF;
    SELECT bool_or((i->>'objective')='incrementar'), bool_or((i->>'objective')='disminuir'),
           COALESCE(SUM(CASE WHEN (i->>'objective')='disminuir'
                             THEN (i->>'cost')::NUMERIC*(i->>'quantity')::INTEGER ELSE 0 END),0)
      INTO v_has_incrementar, v_has_disminuir, v_amt_disminuir
      FROM jsonb_array_elements(p_items) AS i;
    IF v_has_incrementar AND v_motivo IS NULL THEN
        RAISE EXCEPTION 'El motivo es obligatorio cuando el ajuste tiene incrementos (compra|sobrante|correccion).'; END IF;
    IF NOT v_has_incrementar AND v_motivo IS NOT NULL THEN
        RAISE EXCEPTION 'El motivo debe ser NULL cuando el ajuste es 100%% disminuciones (solo merma).'; END IF;
    IF v_motivo='correccion' AND (p_notes IS NULL OR btrim(p_notes)='') THEN
        RAISE EXCEPTION 'Los ajustes de corrección requieren una justificación en notes.'; END IF;
    SELECT w.site_id INTO v_site_id FROM warehouses w WHERE w.warehouse_id=p_warehouse_id;
    IF v_site_id IS NULL THEN RAISE EXCEPTION 'La bodega % no existe o no tiene sede asignada.', p_warehouse_id; END IF;
    IF v_role='encargado' AND v_user_site IS DISTINCT FROM v_site_id THEN
        RAISE EXCEPTION 'Solo puedes crear ajustes en tu sede.'; END IF;
    UPDATE adjustment_counters SET last_numero=last_numero+1 WHERE site_id=v_site_id RETURNING last_numero INTO v_numero;
    IF v_numero IS NULL THEN
        INSERT INTO adjustment_counters (site_id,last_numero) VALUES (v_site_id,1)
          ON CONFLICT (site_id) DO UPDATE SET last_numero=adjustment_counters.last_numero+1 RETURNING last_numero INTO v_numero;
    END IF;
    SELECT COALESCE(SUM((i->>'cost')::NUMERIC*(i->>'quantity')::INTEGER),0) INTO v_total FROM jsonb_array_elements(p_items) AS i;
    INSERT INTO inventory_adjustments (warehouse_id,site_id,notes,total_adjusted,created_by,numero,motivo)
    VALUES (p_warehouse_id,v_site_id,p_notes,v_total,v_uid,v_numero,v_motivo) RETURNING adjustment_id INTO v_adj_id;
    FOR v_item IN SELECT (i->>'product_id')::UUID AS product_id,
        COALESCE((i->>'cost')::NUMERIC,0) AS cost, (i->>'objective')::TEXT AS objective,
        (i->>'quantity')::INTEGER AS quantity FROM jsonb_array_elements(p_items) AS i LOOP
        IF v_item.product_id IS NULL THEN RAISE EXCEPTION 'Falta product_id.'; END IF;
        IF v_item.quantity IS NULL OR v_item.quantity<=0 THEN RAISE EXCEPTION 'La cantidad debe ser > 0 (producto %).', v_item.product_id; END IF;
        IF v_item.cost<0 THEN RAISE EXCEPTION 'El costo no puede ser negativo (producto %).', v_item.product_id; END IF;
        IF v_item.objective NOT IN ('incrementar','disminuir') THEN RAISE EXCEPTION 'Objective inválido: %.', v_item.objective; END IF;
        INSERT INTO adjustment_items (adjustment_id,product_id,cost,objective,quantity)
        VALUES (v_adj_id,v_item.product_id,v_item.cost,v_item.objective,v_item.quantity);
        IF v_item.objective='incrementar' AND v_item.cost>0 THEN
            SELECT cost INTO v_cost_before FROM products WHERE product_id=v_item.product_id FOR UPDATE;
            SELECT COALESCE(SUM(quantity),0) INTO v_stock_before FROM product_stock WHERE product_id=v_item.product_id;
        END IF;
        v_delta:=CASE WHEN v_item.objective='incrementar' THEN v_item.quantity ELSE -v_item.quantity END;
        PERFORM adjust_warehouse_stock(v_item.product_id,p_warehouse_id,v_delta,'ajuste','adjustment',v_adj_id,v_uid,p_notes);
        IF v_item.objective='incrementar' AND v_item.cost>0 THEN
            v_new_cost:=(v_stock_before*COALESCE(v_cost_before,0)+v_item.quantity*v_item.cost)/(v_stock_before+v_item.quantity);
            UPDATE products SET cost=v_new_cost WHERE product_id=v_item.product_id;
        END IF;
    END LOOP;
    IF v_has_disminuir AND v_amt_disminuir>0 THEN
        INSERT INTO accounting_entries (site_id,entry_type,category,description,amount,adjustment_id)
        VALUES (v_site_id,'expense','Merma / Ajuste negativo',
            'Ajuste #'||v_numero||' (merma) — '||COALESCE(p_notes,''),
            v_amt_disminuir,v_adj_id);
    END IF;
    RETURN v_adj_id;
END; $function$;
CREATE OR REPLACE FUNCTION public.create_sale(p_customer_id uuid, p_total_amount numeric, p_items jsonb, p_payment_method text DEFAULT NULL::text, p_amount_received numeric DEFAULT NULL::numeric, p_seller text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_site_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_shift_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_is_on_account boolean DEFAULT false, p_initial_payment numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid UUID:=auth.uid(); v_role TEXT; v_user_site UUID; v_sale_id UUID;
    v_item RECORD; v_is_service BOOLEAN; v_numero INTEGER;
    v_customer RECORD; v_amount_paid NUMERIC:=0; v_payment_label TEXT;
    v_shift RECORD; v_is_cash BOOLEAN;
    v_item_cost NUMERIC; v_cogs_total NUMERIC:=0;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
    v_role:=user_role(); v_user_site:=user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado','vendedor') THEN RAISE EXCEPTION 'Sin permisos para registrar venta.'; END IF;
    IF p_site_id IS NULL THEN RAISE EXCEPTION 'La venta requiere sede.'; END IF;
    IF v_role IN ('encargado','vendedor') AND v_user_site IS DISTINCT FROM p_site_id THEN
        RAISE EXCEPTION 'Solo puedes registrar ventas en tu sede.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'La venta no tiene productos.'; END IF;
    IF p_total_amount<0 THEN RAISE EXCEPTION 'El total de la venta no puede ser negativo.'; END IF;
    IF p_is_on_account THEN
        SELECT customer_id,allows_credit,is_walk_in INTO v_customer FROM customers WHERE customer_id=p_customer_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado (obligatorio para fiar).'; END IF;
        IF v_customer.is_walk_in OR NOT v_customer.allows_credit THEN RAISE EXCEPTION 'Este cliente no puede fiar.'; END IF;
        IF p_initial_payment IS NULL THEN v_amount_paid:=0;
        ELSIF p_initial_payment<0 OR p_initial_payment>p_total_amount THEN RAISE EXCEPTION 'Abono inicial fuera de rango [0, total].';
        ELSE v_amount_paid:=p_initial_payment; END IF;
        v_payment_label:='crédito';
    ELSE v_amount_paid:=p_total_amount; v_payment_label:=p_payment_method; END IF;
    IF v_amount_paid>0 THEN
        v_is_cash:=(p_payment_method ILIKE '%efectivo%' OR p_payment_method ILIKE '%cash%');
        IF v_is_cash AND p_shift_id IS NULL THEN RAISE EXCEPTION 'Un cobro en efectivo requiere turno abierto (p_shift_id NULL no permitido).'; END IF;
    END IF;
    IF p_shift_id IS NOT NULL THEN
        SELECT shift_id,site_id,status INTO v_shift FROM pos_shifts WHERE shift_id=p_shift_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Turno no encontrado.'; END IF;
        IF v_shift.status<>'open' THEN RAISE EXCEPTION 'El turno no está abierto (status=%).', v_shift.status; END IF;
        IF v_shift.site_id IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'El turno pertenece a otra sede que la venta.'; END IF;
    END IF;
    IF p_site_id IS NOT NULL THEN
        UPDATE site_counters SET last_numero=last_numero+1 WHERE site_id=p_site_id RETURNING last_numero INTO v_numero;
    END IF;
    INSERT INTO sales (customer_id,total_amount,payment_method,amount_received,seller,notes,
        site_id,warehouse_id,shift_id,numero,status,is_on_account,amount_paid)
    VALUES (p_customer_id,p_total_amount,v_payment_label,p_amount_received,p_seller,p_notes,
        p_site_id,p_warehouse_id,p_shift_id,v_numero,'active',p_is_on_account,v_amount_paid)
    RETURNING sale_id INTO v_sale_id;
    FOR v_item IN SELECT (i->>'product_id')::UUID AS product_id,(i->>'quantity')::INTEGER AS quantity,(i->>'unit_price')::NUMERIC AS unit_price
        FROM jsonb_array_elements(p_items) AS i LOOP
        IF v_item.quantity IS NULL OR v_item.quantity<=0 THEN RAISE EXCEPTION 'Cantidad inválida en la venta.'; END IF;
        SELECT is_service INTO v_is_service FROM products WHERE product_id=v_item.product_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'El producto % no existe.', v_item.product_id; END IF;
        IF NOT v_is_service THEN
            SELECT cost INTO v_item_cost FROM products WHERE product_id=v_item.product_id;
            v_cogs_total:=v_cogs_total+(v_item.quantity*COALESCE(v_item_cost,0));
        ELSE v_item_cost:=NULL; END IF;
        INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,unit_cost)
        VALUES (v_sale_id,v_item.product_id,v_item.quantity,COALESCE(v_item.unit_price,0),v_item_cost);
        IF NOT v_is_service THEN
            IF p_warehouse_id IS NOT NULL THEN
                PERFORM adjust_warehouse_stock(v_item.product_id,p_warehouse_id,-v_item.quantity,'venta','sale',v_sale_id,v_uid);
            ELSE PERFORM decrement_product_stock(v_item.product_id,v_item.quantity); END IF;
        END IF;
    END LOOP;
    IF v_amount_paid>0 THEN
        INSERT INTO sale_payments (sale_id,amount,payment_method,shift_id,site_id,received_by,notes)
        VALUES (v_sale_id,v_amount_paid,COALESCE(p_payment_method,'Desconocido'),p_shift_id,p_site_id,p_seller,
            CASE WHEN p_is_on_account THEN 'Abono inicial' ELSE NULL END);
        INSERT INTO accounting_entries (site_id,entry_type,category,description,amount,sale_id)
        VALUES (p_site_id,'income',
            CASE WHEN p_is_on_account THEN 'Abono inicial crédito' ELSE 'Ventas POS' END,
            'Venta #'||COALESCE(v_numero::TEXT,LEFT(v_sale_id::TEXT,8))||COALESCE(' - '||p_payment_method,''),
            v_amount_paid,v_sale_id);
    END IF;
    IF v_cogs_total>0 THEN
        INSERT INTO accounting_entries (site_id,entry_type,category,description,amount,sale_id)
        VALUES (p_site_id,'expense','Costo de mercancía vendida',
            'COGS venta #'||COALESCE(v_numero::TEXT,LEFT(v_sale_id::TEXT,8)),
            v_cogs_total,v_sale_id);
    END IF;
    RETURN v_sale_id;
END; $function$;
CREATE OR REPLACE FUNCTION public.void_adjustment(p_adjustment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid UUID:=auth.uid(); v_role TEXT; v_user_site UUID; v_adj RECORD;
    v_item RECORD; v_delta INTEGER; v_ae RECORD;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
    v_role:=user_role(); v_user_site:=user_site_id();
    IF v_role IS NULL OR v_role NOT IN ('admin','encargado') THEN RAISE EXCEPTION 'Sin permisos para anular ajustes.'; END IF;
    SELECT adjustment_id,warehouse_id,site_id,status,numero INTO v_adj
      FROM inventory_adjustments WHERE adjustment_id=p_adjustment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ajuste no encontrado.'; END IF;
    IF v_adj.status='voided' THEN RAISE EXCEPTION 'El ajuste ya está anulado.'; END IF;
    IF v_role='encargado' AND v_user_site IS DISTINCT FROM v_adj.site_id THEN
        RAISE EXCEPTION 'Solo puedes anular ajustes de tu sede.'; END IF;
    UPDATE inventory_adjustments SET status='voided' WHERE adjustment_id=p_adjustment_id;
    FOR v_item IN SELECT product_id,objective,quantity FROM adjustment_items WHERE adjustment_id=p_adjustment_id LOOP
        v_delta:=CASE WHEN v_item.objective='incrementar' THEN -v_item.quantity ELSE v_item.quantity END;
        PERFORM adjust_warehouse_stock(v_item.product_id,v_adj.warehouse_id,v_delta,
            'ajuste','adjustment',p_adjustment_id,v_uid,
            'Reversión por anulación de ajuste #'||v_adj.numero);
    END LOOP;
    FOR v_ae IN SELECT entry_id,entry_type,category,amount FROM accounting_entries
        WHERE adjustment_id=p_adjustment_id AND category NOT LIKE 'Reversión %' LOOP
        INSERT INTO accounting_entries (site_id,entry_type,category,description,amount,adjustment_id)
        VALUES (v_adj.site_id,
            CASE WHEN v_ae.entry_type='expense' THEN 'income' ELSE 'expense' END,
            'Reversión '||v_ae.category,
            'Anulación ajuste #'||v_adj.numero,
            v_ae.amount,p_adjustment_id);
    END LOOP;
END; $function$;
