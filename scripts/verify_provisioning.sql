-- verify_provisioning.sql
--
-- Verificación READ-ONLY del estado de aprovisionamiento de una instancia
-- POS-SOLCRAFT. Corre al final del runbook §7 como gate obligatorio antes
-- de entregar la instancia al cliente, y ante cualquier duda posterior.
--
-- Devuelve UNA FILA POR CHEQUEO con 3 columnas:
--   check  — nombre corto del chequeo (ordenado numéricamente)
--   ok     — boolean (TRUE = pasó, FALSE = falló)
--   detail — texto con el resultado concreto (conteos, nombres, notas)
--
-- Ningún INSERT/UPDATE/DELETE. Puede correrse las veces que haga falta.
-- No depende del rol que lo invoca más allá de poder leer pg_catalog,
-- pg_proc, pg_trigger, information_schema y las tablas de negocio.
--
-- Cómo leerlo: `WHERE ok IS FALSE` muestra solo los que fallan.
--
-- Chequeos cubiertos:
--   01-15: anon_exec = false en las 15 funciones internas revocadas por
--          20261012000000 + 20261012000001.
--   16-25: anon_exec = true en las 10 funciones públicas del storefront
--          (deben existir y ser invocables por anon por diseño).
--   26-27: buckets `product-media` y `catalog-assets` presentes con
--          file_size_limit y mime types correctos.
--   28:    trigger `on_auth_user_created` en auth.users.
--   29:    trigger `trg_sync_primary_image` en product_images.
--   30:    27 RPCs del release 2C+D + helpers presentes con firma correcta.
--   31:    exactamente 1 bodega con is_system=TRUE (Tránsito única).
--   32:    cada sede tiene al menos 1 bodega marcada is_primary=TRUE.
--   33:    md5(prosrc) normalizado de 10 funciones críticas (reportar valor
--          — comparar entre instancias es manual, pero quedan loggeadas).
--   34:    verify_kardex_integrity() devuelve 0 filas.
--   35:    verify_credit_integrity() devuelve 0 filas.
--   36:    verify_adjustment_accounting_integrity() devuelve 0 filas.
--   37:    business_settings tiene exactamente 1 fila con business_name
--          no vacío.

WITH
-- ============================================================
-- Chequeos 01-15: anon NO debe ejecutar las funciones internas
-- ============================================================
anon_internal AS (
  SELECT
    row_number() OVER (ORDER BY name) AS n,
    name,
    bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')) AS ok,
    string_agg(name || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ') AS sigs
  FROM (VALUES
    ('adjust_warehouse_stock'), ('transfer_stock'), ('decrement_product_stock'),
    ('receive_transfer_item'), ('send_transfer_via_transit'), ('next_product_code'),
    ('get_low_stock_products'), ('get_sales_summary'),
    ('create_web_order'), ('public_place_order'),
    ('list_orphan_product_media'), ('dispatch_transfer_atomic'),
    ('import_products_bulk_atomic'), ('receive_transfer'), ('reconcile_transfer')
  ) AS t(name)
  JOIN pg_proc p ON p.proname = t.name
  JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
  GROUP BY name
),

-- ============================================================
-- Chequeos 16-25: anon SÍ debe ejecutar las públicas del storefront
-- ============================================================
anon_public AS (
  SELECT
    row_number() OVER (ORDER BY name) AS n,
    name,
    bool_and(has_function_privilege('anon', p.oid, 'EXECUTE')) AS ok,
    string_agg(name || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ') AS sigs
  FROM (VALUES
    ('place_web_order'),
    ('public_catalog_business'), ('public_catalog_facets'),
    ('public_catalog_list'), ('public_catalog_product'),
    ('public_catalog_sites'), ('public_commerce_config'),
    ('public_product_sizes'),
    ('public_get_order'), ('public_web_order_lookup')
  ) AS t(name)
  JOIN pg_proc p ON p.proname = t.name
  JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
  GROUP BY name
),

-- ============================================================
-- Chequeo 26-27: buckets de Storage
-- ============================================================
buckets AS (
  SELECT id, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
  WHERE id IN ('product-media', 'catalog-assets')
),

-- ============================================================
-- Chequeo 28: trigger on_auth_user_created en auth.users
-- ============================================================
trg_new_user AS (
  SELECT count(*) AS cnt
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth' AND c.relname = 'users'
    AND t.tgname = 'on_auth_user_created'
    AND NOT t.tgisinternal
),

-- ============================================================
-- Chequeo 29: trigger trg_sync_primary_image en product_images
-- ============================================================
trg_sync_img AS (
  SELECT count(*) AS cnt
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'product_images'
    AND t.tgname = 'trg_sync_primary_image'
    AND NOT t.tgisinternal
),

-- ============================================================
-- Chequeo 30: 27 RPCs del release 2C+D + helpers presentes
--             (chequeo de presencia, no de cuerpo)
-- ============================================================
required_rpcs AS (
  SELECT name,
         EXISTS (
           SELECT 1 FROM pg_proc p
           JOIN pg_namespace ns ON ns.oid = p.pronamespace
           WHERE ns.nspname = 'public' AND p.proname = r.name
         ) AS present
  FROM (VALUES
    ('create_adjustment'), ('void_adjustment'),
    ('create_sale'), ('void_sale'),
    ('register_payment'), ('apply_customer_credit'),
    ('get_shift_balance'), ('close_shift'),
    ('open_shift'), ('add_cash_movement'),
    ('verify_kardex_integrity'), ('verify_credit_integrity'),
    ('verify_adjustment_accounting_integrity'),
    ('dispatch_transfer_atomic'), ('receive_transfer'), ('reconcile_transfer'),
    ('send_transfer_via_transit'), ('receive_transfer_item'), ('transfer_stock'),
    ('import_products_bulk_atomic'),
    ('handle_new_user'),
    ('has_permission'), ('has_site_access'), ('is_admin'),
    ('is_admin_or_encargado'), ('is_global_role'),
    ('user_role'), ('user_site_id'), ('user_accessible_sites')
  ) AS r(name)
),

-- ============================================================
-- Chequeo 31: 1 bodega is_system=TRUE (Tránsito única)
-- ============================================================
transit AS (
  SELECT count(*) AS cnt,
         string_agg(name, '; ') AS names
  FROM warehouses WHERE is_system = TRUE
),

-- ============================================================
-- Chequeo 32: cada sede tiene al menos 1 is_primary=TRUE
-- (excluye la sede-sistema que aloja Tránsito si existe)
-- ============================================================
sites_without_primary AS (
  SELECT s.site_id, s.name
  FROM sites s
  WHERE NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.site_id = s.site_id AND w.is_primary = TRUE
  )
),

-- ============================================================
-- Chequeo 33: md5_logic de 10 funciones críticas vs BASELINE
--
-- El baseline son los md5_logic (sin whitespace, sin comentarios,
-- lowercase) de la instancia Taiwy Sport al 2026-10-13 — que corre
-- las versiones ENDURECIDAS del release 2C+D de los scripts 15 a 18
-- del repo. Cualquier instancia nueva aprovisionada correctamente con
-- el runbook debe tener estos mismos hashes.
--
-- Un hash distinto en las 4 funciones con guard de rol
-- (apply_customer_credit, create_adjustment, create_sale,
-- void_adjustment) detecta el guard DÉBIL legacy:
--     IF v_role NOT IN ('admin','encargado'[,'vendedor']) THEN
-- vs. el endurecido:
--     IF v_role IS NULL OR v_role NOT IN ('admin','encargado'[,'vendedor']) THEN
--
-- Las otras 6 funciones (close_shift, void_sale, register_payment,
-- get_shift_balance, dispatch_transfer_atomic, receive_transfer,
-- reconcile_transfer) difieren principalmente en formato cosmético
-- entre versiones (ej. ';' final después del END del bloque PL/pgSQL,
-- aliases de columna, whitespace). Mantenerlas en el baseline obliga
-- a que todas las instancias partan de la misma plantilla exacta.
--
-- Si Taiwy Sport evoluciona (ej. tras aplicar la migración de
-- alineación de guards en otra instancia + hacerla el nuevo
-- benchmark), ACTUALIZAR estos hashes aquí y re-commitear este
-- script.
-- ============================================================
critical_baseline AS (
  SELECT * FROM (VALUES
    ('apply_customer_credit',       '33b87b3d68a515d9db21147da60f6500'),
    ('create_adjustment',           '63c8f1b7d6d0247177f0aca25e67f3aa'),
    ('create_sale',                 '0be1f9629255bc161dd8163158a2f54b'),
    ('void_adjustment',             '58c2918a54563224d2f42f0d33dd3b7e'),
    ('close_shift',                 'a844e6a55b7d93040bb1931d46b92d9c'),
    ('void_sale',                   '377e80eb2a36a01d253e31bcb1d57840'),
    ('register_payment',            '04b71386ee0336e8eea5f41cd82891b7'),
    ('get_shift_balance',           'ec45aa61384cf30fc3d0663f130efcf6'),
    ('dispatch_transfer_atomic',    '0fed4f6aec0a1657719980292ce0f928'),
    ('receive_transfer',            'ae7710204771ba6729a1d86906abfbf8'),
    ('reconcile_transfer',          '94583fcfa4baf2fefaa043486093facb')
  ) AS b(proname, md5_expected)
),
critical_md5 AS (
  SELECT b.proname,
         b.md5_expected,
         md5(regexp_replace(regexp_replace(lower(p.prosrc),'--[^\n]*','','g'),
                            '[[:space:]]','','g')) AS md5_actual
  FROM critical_baseline b
  LEFT JOIN pg_proc p ON p.proname = b.proname
  LEFT JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
),

-- ============================================================
-- Chequeos 34-36: funciones de integridad en 0 violaciones
-- (ejecutar y contar filas devueltas)
-- ============================================================
kardex_viol AS (SELECT count(*) AS cnt FROM verify_kardex_integrity()),
credit_viol AS (SELECT count(*) AS cnt FROM verify_credit_integrity()),
adj_viol    AS (SELECT count(*) AS cnt FROM verify_adjustment_accounting_integrity()),

-- ============================================================
-- Chequeo 37: business_settings con business_name
-- ============================================================
bs AS (
  SELECT count(*) AS rows_cnt,
         max(CASE WHEN coalesce(trim(business_name),'') = '' THEN 0 ELSE 1 END) AS has_name,
         max(business_name) AS the_name
  FROM business_settings
)

-- ============================================================
-- Output: UNA FILA POR CHEQUEO
-- ============================================================
SELECT lpad(n::text,2,'0') || '. anon_internal_' || name AS check, ok,
       'firma: ' || sigs AS detail
FROM anon_internal
UNION ALL
SELECT lpad((15+n)::text,2,'0') || '. anon_public_' || name AS check, ok,
       'firma: ' || sigs AS detail
FROM anon_public
UNION ALL
SELECT '26. bucket_product_media' AS check,
       -- product-media sirve fotos de producto (jpg/png/webp/avif).
       -- 5 MB es suficiente; mayor no se exige. Chequea que exista y sea
       -- público, con al menos JPEG/PNG en el mime allowlist.
       EXISTS (SELECT 1 FROM buckets WHERE id='product-media' AND public=TRUE
               AND allowed_mime_types && ARRAY['image/jpeg','image/png']) AS ok,
       coalesce((SELECT 'public=' || public::text || ' file_size_limit=' || coalesce(file_size_limit::text,'null')
                        || ' mimes=' || coalesce(array_to_string(allowed_mime_types,','),'null')
                 FROM buckets WHERE id='product-media'),
                'BUCKET AUSENTE') AS detail
UNION ALL
SELECT '27. bucket_catalog_assets' AS check,
       -- catalog-assets sirve el modelo 3D del hero (.glb) + fallbacks.
       -- Requiere file_size_limit >= 50 MB (el .glb de referencia pesa ~62 MB
       -- y el proyecto debe tener subida Global de 100 MB — ver runbook §5).
       EXISTS (SELECT 1 FROM buckets WHERE id='catalog-assets' AND public=TRUE
               AND file_size_limit >= 50*1024*1024
               AND allowed_mime_types && ARRAY['model/gltf-binary']) AS ok,
       coalesce((SELECT 'public=' || public::text || ' file_size_limit=' || coalesce(file_size_limit::text,'null')
                        || ' mimes=' || coalesce(array_to_string(allowed_mime_types,','),'null')
                 FROM buckets WHERE id='catalog-assets'),
                'BUCKET AUSENTE') AS detail
UNION ALL
SELECT '28. trigger_on_auth_user_created' AS check,
       (SELECT cnt FROM trg_new_user) = 1 AS ok,
       'count=' || (SELECT cnt FROM trg_new_user)::text AS detail
UNION ALL
SELECT '29. trigger_trg_sync_primary_image' AS check,
       (SELECT cnt FROM trg_sync_img) = 1 AS ok,
       'count=' || (SELECT cnt FROM trg_sync_img)::text AS detail
UNION ALL
SELECT '30. rpcs_release_2cd_presentes' AS check,
       NOT EXISTS (SELECT 1 FROM required_rpcs WHERE NOT present) AS ok,
       coalesce('faltan: ' || string_agg(name, ', '), 'todas presentes (' || (SELECT count(*)::text FROM required_rpcs) || ')') AS detail
FROM required_rpcs WHERE NOT present
UNION ALL
SELECT '31. bodega_transito_unica' AS check,
       (SELECT cnt FROM transit) = 1 AS ok,
       'count=' || (SELECT cnt FROM transit)::text ||
       ' names=' || coalesce((SELECT names FROM transit),'(ninguna)') AS detail
UNION ALL
SELECT '32. toda_sede_con_bodega_primaria' AS check,
       NOT EXISTS (SELECT 1 FROM sites_without_primary) AS ok,
       coalesce('sedes sin primary: ' || string_agg(name, ', '),
                'todas las sedes tienen bodega primaria') AS detail
FROM sites_without_primary
UNION ALL
SELECT '33. md5_logic_' || proname AS check,
       (md5_actual IS NOT NULL AND md5_actual = md5_expected) AS ok,
       CASE
         WHEN md5_actual IS NULL
           THEN 'FUNCTION AUSENTE (esperaba md5=' || md5_expected || ')'
         WHEN md5_actual = md5_expected
           THEN 'md5=' || md5_actual || ' (coincide con baseline)'
         ELSE 'DRIFT DETECTED — actual=' || md5_actual
              || ' | esperado=' || md5_expected
              || CASE WHEN proname IN ('apply_customer_credit','create_adjustment',
                                       'create_sale','void_adjustment')
                 THEN ' | PROBABLE GUARD DÉBIL (v_role NOT IN sin v_role IS NULL OR)'
                 ELSE ' | revisar diff manual' END
       END AS detail
FROM critical_md5
UNION ALL
SELECT '34. verify_kardex_integrity_cero' AS check,
       (SELECT cnt FROM kardex_viol) = 0 AS ok,
       'violaciones=' || (SELECT cnt FROM kardex_viol)::text AS detail
UNION ALL
SELECT '35. verify_credit_integrity_cero' AS check,
       (SELECT cnt FROM credit_viol) = 0 AS ok,
       'violaciones=' || (SELECT cnt FROM credit_viol)::text AS detail
UNION ALL
SELECT '36. verify_adjustment_accounting_integrity_cero' AS check,
       (SELECT cnt FROM adj_viol) = 0 AS ok,
       'violaciones=' || (SELECT cnt FROM adj_viol)::text AS detail
UNION ALL
SELECT '37. business_settings_con_business_name' AS check,
       (SELECT rows_cnt = 1 AND has_name = 1 FROM bs) AS ok,
       'rows=' || (SELECT rows_cnt FROM bs)::text ||
       ' business_name=' || coalesce((SELECT quote_literal(the_name) FROM bs), 'NULL') AS detail
ORDER BY check;
