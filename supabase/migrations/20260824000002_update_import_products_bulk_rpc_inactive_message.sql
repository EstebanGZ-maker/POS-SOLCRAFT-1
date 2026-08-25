-- =====================================================================
-- Update de import_products_bulk_atomic: mensaje diferenciado cuando el
-- conflicto de UNIQUE es contra un producto INACTIVO (soft-deleted).
--
-- Contexto: products.code y products.barcode tienen UNIQUE que aplica a
-- todas las filas sin importar is_active (decisión explícita — evita
-- resolución ambigua de lookups por barcode en el POS entre activos e
-- inactivos). El importador ahora explica al usuario que puede reactivar
-- el producto en vez de dejarlo con un mensaje genérico "ya existe" que
-- no sugiere solución.
--
-- Solo cambia el bloque EXCEPTION WHEN unique_violation. El resto de la
-- función (auth, insert, adjust_warehouse_stock, FK/CHECK handlers)
-- queda idéntico al original.
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
  v_warehouse         RECORD;
  v_caller            UUID := COALESCE(p_user_id, auth.uid());
  v_row               RECORD;
  v_product_id        UUID;
  v_constraint        TEXT;
  v_inserted          INTEGER := 0;
  v_conflict_active   BOOLEAN;
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
          -- Lookup del estado del producto que causó el conflicto.
          -- Nota: SELECT dentro del bloque EXCEPTION corre en una nueva
          -- subtx implícita — no rompe el rollback de la fila fallida.
          -- Si el SELECT no matchea (fila borrada por SQL manual entre
          -- el INSERT que falló y este handler, muy improbable),
          -- v_conflict_active queda NULL. NULL IS FALSE = false en
          -- Postgres → caemos al ELSE con el mensaje genérico, que es
          -- el fallback semánticamente correcto (no enmascara el error
          -- original ni cambia el ERRCODE 23505).
          SELECT is_active INTO v_conflict_active
          FROM products
          WHERE code = v_row.code;

          IF v_conflict_active IS FALSE THEN
            RAISE EXCEPTION
              'Fila %: la referencia "%" pertenece a un producto inactivo. Reactivalo desde /inventory/products (mostrar inactivos) o usá otro código en el archivo. Ninguna fila se importó.',
              v_row.row_index, v_row.code
              USING ERRCODE = '23505';
          ELSE
            RAISE EXCEPTION
              'Fila %: la referencia "%" ya existe en el sistema (posible race con alta manual o importación paralela). Ninguna fila se importó — corregí el archivo y reintentá.',
              v_row.row_index, v_row.code
              USING ERRCODE = '23505';
          END IF;

        ELSIF v_constraint = 'products_barcode_key' THEN
          -- Mismo fallback NULL → mensaje genérico que el bloque
          -- products_code_key de arriba.
          SELECT is_active INTO v_conflict_active
          FROM products
          WHERE barcode = v_row.barcode;

          IF v_conflict_active IS FALSE THEN
            RAISE EXCEPTION
              'Fila %: el código de barras "%" pertenece a un producto inactivo. Reactivalo desde /inventory/products (mostrar inactivos) o usá otro código en el archivo. Ninguna fila se importó.',
              v_row.row_index, v_row.barcode
              USING ERRCODE = '23505';
          ELSE
            RAISE EXCEPTION
              'Fila %: el código de barras "%" ya existe en el sistema (posible race). Ninguna fila se importó — corregí el archivo y reintentá.',
              v_row.row_index, v_row.barcode
              USING ERRCODE = '23505';
          END IF;

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
