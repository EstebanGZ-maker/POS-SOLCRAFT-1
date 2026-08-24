-- =====================================================================
-- import_products_bulk_atomic: importa masivamente productos + stock inicial
-- en una sola transacción. Todo-o-nada: si CUALQUIER fila falla (UNIQUE,
-- FK a categoría, CHECK), la tx entera revierte y ninguna fila queda
-- insertada.
--
-- Autorización doble (misma disciplina que dispatch_transfer_atomic):
--   - Rol: is_admin_or_encargado()
--   - Sede: has_site_access(sede de la bodega destino)
--
-- Capa 1 (cliente) ya validó duplicados intra-archivo, códigos/barcodes
-- ya existentes, categorías inexistentes y campos requeridos. Este RPC
-- es la Capa 2 (red de seguridad ante race): normalmente insertará todo,
-- y sólo fallará si alguien creó un producto/eliminó una categoría entre
-- la Capa 1 y el submit. Los handlers de EXCEPTION traducen el error
-- crudo de Postgres a un mensaje que identifica fila + campo + valor
-- específicos.
--
-- Retorno:
--   OK:  { success: true, inserted_count: N, warehouse_id: uuid }
--   Err: RAISE EXCEPTION con mensaje humano — el cliente lo lee vía
--        supabase-js como error.message.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.import_products_bulk_atomic(
  p_rows        jsonb,
  p_warehouse_id uuid,
  p_user_id     uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_warehouse   RECORD;
  v_caller      UUID := COALESCE(p_user_id, auth.uid());
  v_row         RECORD;
  v_product_id  UUID;
  v_constraint  TEXT;
  v_inserted    INTEGER := 0;
BEGIN
  IF NOT is_admin_or_encargado() THEN
    RAISE EXCEPTION
      'Solo un administrador o encargado puede importar productos.'
      USING ERRCODE = '42501';
  END IF;

  SELECT warehouse_id, site_id, is_system, name
    INTO v_warehouse
  FROM warehouses
  WHERE warehouse_id = p_warehouse_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La bodega destino no existe.'
      USING ERRCODE = '22023';
  END IF;

  IF v_warehouse.is_system THEN
    RAISE EXCEPTION
      'No se puede importar a una bodega del sistema (ej. Tránsito).'
      USING ERRCODE = '22023';
  END IF;

  IF NOT has_site_access(v_warehouse.site_id) THEN
    RAISE EXCEPTION
      'No tenés acceso a la sede de la bodega destino.'
      USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El archivo no contiene filas para importar.'
      USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS x(
      row_index     int,
      name          text,
      code          text,
      barcode       text,
      description   text,
      category_id   uuid,
      unit          text,
      cost          numeric,
      price         numeric,
      size          text,
      initial_stock int
    )
  LOOP
    BEGIN
      INSERT INTO products (
        name, code, barcode, description, category_id,
        unit, cost, price, size, is_active
      )
      VALUES (
        v_row.name, v_row.code, v_row.barcode, v_row.description,
        v_row.category_id, v_row.unit, v_row.cost, v_row.price,
        v_row.size, TRUE
      )
      RETURNING product_id INTO v_product_id;

      IF COALESCE(v_row.initial_stock, 0) > 0 THEN
        PERFORM adjust_warehouse_stock(
          v_product_id,
          p_warehouse_id,
          v_row.initial_stock,
          'ajuste',
          'product_import',
          v_product_id,
          v_caller,
          format('Cantidad inicial por importación masiva (fila %s)', v_row.row_index)
        );
      END IF;

      v_inserted := v_inserted + 1;

    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'products_code_key' THEN
          RAISE EXCEPTION
            'Fila %: la referencia "%" ya existe en el sistema (posible race con alta manual o importación paralela). Ninguna fila se importó — corregí el archivo y reintentá.',
            v_row.row_index, v_row.code
            USING ERRCODE = '23505';
        ELSIF v_constraint = 'products_barcode_key' THEN
          RAISE EXCEPTION
            'Fila %: el código de barras "%" ya existe en el sistema (posible race). Ninguna fila se importó — corregí el archivo y reintentá.',
            v_row.row_index, v_row.barcode
            USING ERRCODE = '23505';
        ELSE
          RAISE;
        END IF;

      WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint LIKE '%category%' THEN
          RAISE EXCEPTION
            'Fila %: la categoría del producto "%" ya no existe (posiblemente fue eliminada mientras validábamos). Actualizá la plantilla y reintentá.',
            v_row.row_index, v_row.name
            USING ERRCODE = '23503';
        ELSE
          RAISE;
        END IF;

      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        RAISE EXCEPTION
          'Fila %: valor inválido en el producto "%" (constraint: %). Corregí el archivo y reintentá.',
          v_row.row_index, v_row.name, v_constraint
          USING ERRCODE = '23514';
    END;
  END LOOP;

  RETURN json_build_object(
    'success',        true,
    'inserted_count', v_inserted,
    'warehouse_id',   p_warehouse_id
  );
END $function$;

REVOKE ALL ON FUNCTION public.import_products_bulk_atomic(jsonb, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_products_bulk_atomic(jsonb, uuid, uuid) TO authenticated;
