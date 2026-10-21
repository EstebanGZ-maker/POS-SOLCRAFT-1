# HISTORIAL-ESTADO.md

> Archivado desde `docs/ESTADO-PENDIENTES.md` el 2026-10-20 (commit
> `04cf85e`). Son los subsecciones del §0 vigente al 2026-10-14 que
> cerraron o quedaron superadas por los merges del 2026-10-17 al
> 2026-10-20. Se mueven acá por la regla "nada se borra sin rastro".
> El estado activo vive en `docs/ESTADO-PENDIENTES.md §0`.

---

### Y.1 — perfil IA (ropa/tecnología): WIP local sin revisión (2026-10-17)

- Rama `feat/ia-rubro-perfil` con commit **WIP local** de Y.1 (perfil IA
  ropa/tecnología), **sin revisión de Esteban**: **no commitear ni
  mergear** nada encima. Al reanudar, el próximo paso es que Esteban
  pegue los diffs desde la terminal para revisarlos.
- Pasan todos los tests del fixture: `--source=profile --verify` y
  `--source=route --verify` (18 archivos byte-idénticos), `--isolation`
  20/20, `--behavior` 25/25.
- Fix del fixture ya mergeado en `71791a5` (extractor AST en vez del
  regex buggy; solo `outputs/client-fallbacks.json` + `run.mjs` +
  README cambiaron, los otros 17 outputs quedaron idénticos).
- Perfil de tecnología aprobado con 7 correcciones aplicadas (marca del
  EQUIPO en fundas/vidrios/cables; category como lista inyectada por
  request; REJECTION_RULE como constante propia; español sin voseo;
  `typePrefixMaxLength` por perfil; sufijos sin abreviatura literal en
  mayúsculas). Accesorios universales (cable/cargador sin modelo):
  `reference` vacía y el operador la escribe; la UI bloquea Guardar
  hasta completarla.
- La ruta `/api/analyze-product` tras merge pasa a exigir **sesión
  implícita** (status 401 `rubro_missing` sin sesión por la lectura
  de `business_settings.rubro`) en las 3 instancias, con una lectura
  extra a `business_settings` (y a `categories` solo en modo tecnología)
  y un nuevo modo de falla 503 `rubro_read_error` si Supabase falla al
  leer. **Falta su commit propio de endurecimiento**: guard 401
  explícito y fix del campo `debug` que expone el mensaje interno del
  AI Gateway.
- **Pendientes abiertos tras Y.1**:
  - **Y.2** — UI de tecnología (Select de categoría poblado desde DB,
    sin precio/costo sugeridos, Guardar bloqueado si falta `marca` **o**
    `referencia`; el servidor ya rechaza con `validateItemForRubro`).
  - **Y.3** — reemplazar la etiqueta hardcoded "Talla" por la del
    perfil en el formulario manual de productos
    (`app/inventory/products/`), el importador de Excel y la landing
    del catálogo público. Celulares-carmen carga por Excel → el label
    debe decir "Referencia" para `rubro='tecnologia'`.

### Cerrado y verificado al 2026-10-14

- **Endurecimiento SECDEF**: 15 funciones sin EXECUTE para anon en
  Solcraft y Taiwy Sport (migraciones `20261012000000` + `20261012000001`,
  verificado con `has_function_privilege`). Smoke reversible pasado en
  ambas (ajuste #1 anulado + 3 integridades en 0).
- **Auditoría de deriva, reglas de sesión y registro de intervenciones
  manuales** formalizados (`CONTEXT-POS.md §0`, tabla "Registro de
  intervenciones manuales en producción"). Diff estricto confirmó que la
  única diferencia LÓGICA entre instancias era el guard débil de los 4
  guards de Solcraft (resto cosmético).
- **celulares-carmen** aprovisionado:
  - **Fase 1** (crear proyecto, USD 10/mes, sa-east-1, `ACTIVE_HEALTHY`).
  - **Fase 2**: 36 tablas, 57 funciones, 98 policies, 123 índices, 6
    triggers. Paridad con Taiwy Sport salvo 4 funciones cosméticas
    documentadas. Scripts 15/16/17a/17b/17c_v2/17e/18 PARCIAL +
    10 migraciones versionadas (incluye las 2 de 20261012 REVOKE anon +
    20260918000001 `catalog_facets_by_category` recuperada).
  - **Fase 5**: sedes CEN (central), CC1, CC2; 10 categorías (FUNDAS,
    CARGADORES, AUDIFONOS, VIDRIOS, CABLES, POWERBANKS, SOPORTES,
    PARLANTES, RELOJES, ACCESORIOS); Tránsito única; lista `General`
    default; contadores por sede; `business_settings` con
    `business_name='Celulares Carmen'`, `regime='No responsable de IVA'`,
    comercio apagado (WhatsApp/COD/Wompi/pickup/delivery todos false).
  - **Admin inicial**: `esteban@solcraftsas.com` con `role='admin'`,
    `site_id=NULL`, `is_active=TRUE`, 0 filas en `user_sites` (replica
    convención Taiwy Sport verificada por Esteban).
  - **Proyecto Vercel** `pos-celulares-carmen` creado con deploy READY.
- **Gate `scripts/verify_provisioning.sql`**: 53 chequeos (01-15
  anon_internal, 16-25 anon_public, 26-27 buckets, 28-29 triggers,
  30 RPCs 2C+D, 31 Tránsito única, 32 primarias, 33a guard endurecido
  × 4, 33b md5 norm × 10 vs baseline del repo, 34-36 integridades,
  37 business_settings, 38-39 walk-in, 40 conteos globales).
  **53/53 PASS en celulares-carmen; 49/53 PASS en Taiwy Sport** (4
  cosméticas conocidas del 33b: `close_shift`,
  `create_adjustment`, `verify_adjustment_accounting_integrity`,
  `verify_credit_integrity`).
- **Migración 20260918000001** (`public_catalog_facets`) versionada:
  antes solo existía como migración MCP suelta aplicada 2026-08-31
  a Solcraft y Taiwy Sport, sin archivo en el repo. Recuperada desde
  `statements[1]` de `schema_migrations` de TS.
- **Migración 20261014000000** (`business_settings.rubro TEXT NOT NULL
  DEFAULT 'ropa' CHECK IN ('ropa','tecnologia')`): aplicada canario en
  las 3 instancias el 2026-10-14 ~22:50 UTC. Commit `afdd603`. UPDATE a
  `'tecnologia'` en celulares-carmen aplicado y verificado
  (~22:59 UTC en el registro de intervenciones). Solcraft y Taiwy Sport
  siguen en `'ropa'`. **El código del perfil IA NO se ha escrito.**
- **Hallazgos corregidos**:
  - Policies son **98** (no 97) — también en Taiwy Sport. Actualizado en
    runbook §2.2.1 y en gate.
  - Supabase Vault v0.3.1 YA está instalado — rehacer decisión Wompi
    con credenciales **cifradas por tenant en Vault**, no env vars.
  - `Consumidor final` es **precondición del script 15** (bootstrap del
    walk-in + verificación abortiva D12). Movido en runbook §2.3 ANTES
    de scripts 15-18. §5.3 queda cumplido por §2.3.
- **Reglas de sesión formalizadas** (`CONTEXT-POS.md §0`):
  - #4: SQL se **extrae del archivo**, nunca se reescribe de memoria.
  - #5: Toda migración MCP se **versiona en `supabase/migrations/`** en
    el mismo commit.

### Pendientes de celulares-carmen (en orden)

1. **Dominio oficial** `tecnologia-accesorios.app-solcraft.com`: ✅
   agregado por Esteban al proyecto Vercel `pos-celulares-carmen` el
   2026-10-14 18:59:26 UTC, `verified=true`, responde 200 por HTTPS.
   Nombre interno `celulares-carmen` se mantiene como handle de
   instancia/proyecto; el subdominio no coincide con él y es correcto.
2. **(ALTA, nuevo 2026-10-15) Supabase Auth "Allow new users to sign up"
   ACTIVADO en celulares-carmen**: verificado por el asistente (sin
   tocar nada). Con `Confirm email` apagado, un registro público desde
   `tecnologia-accesorios.app-solcraft.com/login` crea un `auth.users`
   + un `user_profiles` vía trigger `handle_new_user()` (rol
   `vendedor`, `is_active=true`). **25 tablas tienen policy de SELECT
   con `USING(true)` para `authenticated`** (`customers`,
   `sale_payments`, `cash_movements`, `customer_credits`,
   `stock_movements`, `transfers`, `suspended_sales`, etc.), por lo
   que una cuenta anónima autoregistrada **ve datos del negocio en
   crudo**. La RPC `admin_create_user` inserta directamente en
   `auth.users` con `role='service_role'` + guard de rol admin: NO
   depende del interruptor, apagar el signup no la rompe. **Esteban
   apaga el interruptor en Dashboard → Authentication → Settings
   del proyecto `lmuuilicckgderapyxma`.** Falta verificar en Solcraft
   (`nxszaxwsrtlofqimbfig`) y Taiwy Sport (`aapchdjwpqhwsquffnxn`) —
   Esteban manda capturas.
3. **Pendiente de Esteban (post-dominio)** — infra que yo no toco:
   - `NEXT_PUBLIC_APP_URL=https://tecnologia-accesorios.app-solcraft.com`
     en Vercel proyecto `pos-celulares-carmen`, targets **Production
     + Preview**, + redeploy.
   - Supabase Auth del proyecto `lmuuilicckgderapyxma`: `Site URL` y
     `Redirect URLs` actualizados al dominio oficial.
   - Verificar que las 4 env vars estén en target **Preview** además
     de Production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`. **El MCP no
     puede listarlas (403 forbidden)** — lo verifica Esteban en dashboard.
   - Revisar cuentas inesperadas en Solcraft (`admin@solcraft.dev`,
     `admin@taiwy.com` sin perfil, `qa.multisede@solcraft.dev` y
     tres administradores Gmail): verificar si corresponden,
     desactivar / borrar las que no.
4. **Cuenta `sebitas542010@hotmail.com`**: confirmada por Esteban el
   2026-10-14 como cuenta del cliente (dueño o colaborador). Rol
   `admin` vigente; el rol definitivo (admin si es el dueño, encargado
   con sede si es colaborador) queda por confirmar con el cliente. **No
   modificar la fila.**
5. **Verificación de Auth** (`Confirm email` OFF) y **Storage global
   upload size limit en 100 MB**: Esteban dijo "ya quedó ok" sin
   verificación formal — pendiente de validar.
6. **Smoke real con el cliente**: venta en cada local, traslado
   Central→local con recepción, cierre de turno. Alta de encargados y
   vendedores. Backups diarios activos.
7. **Carga inicial** de productos por importador Excel con las 10
   categorías (sin CELULARES/TABLETS/LAPTOPS por decisión).

### Perfil de rubro IA — diseño aprobado, código pendiente (va por rama)

**Base**: `lib/rubro-profiles.ts` con 2 perfiles `ropa` y `tecnologia`.
`getRubroProfile(rubro)` **falla con excepción** si el valor no matchea
(sin fallback a 'ropa'). Perfiles 100% aislados: perfil `ropa` se mueve
TAL CUAL desde `app/api/analyze-product/route.ts` y
`components/central/ai-ingress-panel.tsx` **sin reescribir** (preserva
prompt, schema con `size` obligatorio fallback 'M', `suggested_price` +
`suggested_cost`, etiquetas CA=Camisa/PA=Pantalón..., formato
descripción, `allowCreateCategory=true` como hoy). Perfil `tecnologia`
con prompt/schema/etiquetas **propios sin fragmentos compartidos con
ropa**, `allowCreateCategory=false`, categorías leídas de la base en
cada solicitud (SELECT name FROM categories). Si la IA no devuelve una
categoría del whitelist dinámico, el campo queda vacío y el usuario
elige. Si la imagen no es del rubro (p.ej. una prenda en tecnología) →
aviso **"no corresponde al rubro"** con campos vacíos (regla NO
aplica al perfil ropa).

**Convención `tecnologia`**: código `MARCA-REFERENCIA-PRECIO(miles)-NN`.
- Prefijo marca: RM Redmi, IP iPhone, SA Samsung, HO Honor, OP Oppo,
  IN Infinix, TE Tecno. Marcas fuera de esa lista = 2 primeras letras.
- Referencia:
  - **Fundas, vidrios, cables**: modelo del EQUIPO al que corresponden
    (p.ej. funda iPhone 17 Pro Max → `IP-17PM-...`).
  - **Accesorios con marca propia** (parlantes, audífonos, powerbanks,
    relojes): nombre comercial del modelo, mayúsculas, sin espacios
    (`TUNE520BT`, `FLIP6`, `CHARGE5`, `MIBAND8`).
  - **Si el empaque no muestra el modelo**: referencia **vacía**; UI
    bloquea Guardar hasta completarla (evita `IP--35-00`).
  - **La IA NO asigna compatibilidad que el empaque no muestre** (un
    cable Lightning sin indicar iPhone compatible → referencia vacía).
- Abreviaturas de modelos: `Pro=P`, `Pro Max=PM`, `Ultra=U`, `Plus=PL`,
  `Lite=LT`, `Mini=M`, `Note=N`, `Reno=R`, `Flip=FL`, `Fold=FD`. Nada
  de caracteres especiales.
- Lista de modelos del prompt = **ejemplos ilustrativos**, no cerrada.
  El prompt genera por regla modelos nuevos.
- **Capacidad** (almacenamiento/RAM) va en `name` + `description`,
  **nunca** en `size` ni `type_prefix`.
- **Precio y costo**: los carga el usuario — se **quitan** del esquema
  de tecnología (`suggested_price` y `suggested_cost`).
- Colores en español. Descripción corta sin inventar datos.

**Verificación obligatoria antes del merge**:
a. **Test de instantánea** del perfil ropa carácter-por-carácter vs el
   código actual (prompt, schema JSON, labels).
b. **Regresión de ropa en preview**: foto de ropa → SOLO ANÁLISIS, no
   guardar; shape de salida idéntico al actual. Esteban descarta con
   "Quitar".
c. **Smoke tecnología en celulares-carmen** con 5 fotos de fundas + 1
   foto de prenda que debe devolver el aviso "no corresponde al rubro".
d. **Merge solo si a + b + c pasan**.

**Otras tareas del mismo bloque**:
- La action de `/settings/receipt` **no puede dejar `rubro` nulo** ni
  pisarlo accidentalmente — actualizar solo los campos que conoce.
- **Seed del runbook §5.5** debe incluir `rubro`.
- **Chequeo de `rubro`** en `scripts/verify_provisioning.sql` (ej.:
  fila con `rubro IN ('ropa','tecnologia')` NOT NULL).

### Migración MCP suelta `catalog_facets_by_category` recuperada (2026-10-14)

El 2026-08-31 21:57:28 UTC se aplicó por MCP una migración
`catalog_facets_by_category` a `nxszaxwsrtlofqimbfig` y
`aapchdjwpqhwsquffnxn` que reescribió `public_catalog_facets` para
agrupar por `category_id` + ajustó `public_catalog_list`. La
migración NO se versionó en `supabase/migrations/`, lo que generó
deriva silenciosa entre repo y producción (el repo quedó con la
versión del baseline que agrupa por `type_prefix`). Detectado durante
aprovisionamiento de celulares-carmen el 2026-10-14 vs hash de
referencia Taiwy Sport (`public_catalog_facets` esperado `cb9ce0a4`,
baseline producía otro valor). Recuperado el SQL exacto del
`statements[1]` de `supabase_migrations.schema_migrations` de Taiwy
Sport (versión `20260831215728`) y versionado como
`20260918000001_public_catalog_facets_by_category.sql`. **Solo la
parte de `public_catalog_facets`** — el bloque de `public_catalog_list`
del statement original se descarta porque `20260918000000` ya reescribió
esa función con un shape más completo. Aplicado a celulares-carmen; hash
coincide con Taiwy Sport. **Regla formalizada en `CONTEXT-POS.md §0.5`**:
toda migración MCP se versiona en el mismo commit.

### Deriva Taiwy Sport en 4 funciones del release 2C+D (2026-10-14)

Durante el diff estricto celulares-carmen vs Taiwy Sport vs Solcraft se
confirmó deriva cosmética en Taiwy Sport sobre `close_shift`,
`create_adjustment`, `verify_adjustment_accounting_integrity` y
`verify_credit_integrity`: `prosrc` reformateado (whitespace comprimido,
alias `AS X` ausentes en SELECT, 2 mensajes de `RAISE EXCEPTION`
levemente acortados). Lógica idéntica — guards de rol, secuencia SQL,
cálculos WAC y comportamiento de retorno son byte-por-byte iguales al
repo canónico. Origen probable: aplicación manual de los scripts desde
SQL Editor del Dashboard con reformato propio durante el aprovisionamiento
inicial (2026-08-25-26), sin registro de intervención. **Decisión
Esteban 2026-10-14**: Taiwy Sport NO se toca por diferencias cosméticas.
Solo se corregiría si un diff estricto futuro encuentra diferencia de
lógica, y con aprobación explícita.

### Decisiones adicionales (reanudación en-sesión 2026-10-13)

- **Multi-tenant (Bloque D)**: **DISEÑO PRIMERO, SIN CÓDIGO.** No se
  implementa hasta que Esteban lo pida explícitamente. El plan de 4
  fases queda como documento vivo; la primera fase ejecutable
  (`tenant_id` + RLS) requiere pedido explícito aparte.
- **IA para celulares (Bloque C)**: **DESPUÉS del aprovisionamiento**.
  El cliente arranca por el importador de Excel. El perfil de rubro
  (prompt, campos extraídos, etiquetas UI, categorías semilla) se
  diseña e implementa **por rama + preview + smoke**, no por
  configuración in-prod ni por hotfix.
- **DB password del proyecto Supabase**: **no se genera ni se
  almacena**. `create_project` del Management API no la acepta y la
  app no se conecta por `postgres://...` (todo via PostgREST/Auth).
  Si en el futuro se necesita acceso directo (`psql`, `pg_dump`),
  se resetea desde Dashboard → Settings → Database en ese momento y
  se descarta tras uso. **Runbook §1.1 actualizado.**

### Pendientes, en orden

1. **Bloque B**: aprovisionar `celulares-carmen` fase por fase con el
   runbook, pausando después de cada fase para que Esteban verifique.
   Smoke real a cargo de Esteban: una venta en cada local, un
   traslado Central → local con recepción, cierre de turno. Yo
   verifico contra la DB.
2. **Bloque C**: diseño del perfil de rubro **por instancia** para la
   IA (sin FK a `tenants`, sin CHECK de lista fija de rubros).
   Parametriza prompt, campos extraídos, etiquetas UI ("Talla" →
   "Capacidad" / "Variante"), esquema de código, categorías semilla.
   Implementación posterior por rama + preview + smoke. Cuando exista
   la tabla `tenants`, el rubro se mueve ahí.
3. **Bloque D**: `docs/CAMINO-B-MULTITENANT.md` +
   `docs/PLAN-IMPLEMENTACION-CLIENTES.md` con las 7 correcciones
   acordadas:
   - Conteo real: 36 tablas en `public` (no 29).
   - **Supabase Vault v0.3.1** está instalado — rehacer la decisión
     Wompi con credenciales **cifradas por tenant en Vault**, no env
     vars por slug ni texto plano.
   - IA: el código ya volvió al **AI Gateway pago** (ya no usa
     `GOOGLE_GENERATIVE_AI_API_KEY` ni la API directa de Google).
     Verificar en docs de Vercel si el Gateway permite atribuir
     consumo por usuario/tag.
   - Perfil de rubro: fuera de Fase 6, pasa a Bloque C. FK a
     `rubro_profiles` (no CHECK de lista fija).
   - `current_tenant()`: benchmark contra `tenant_id` como claim JWT
     y contra `(SELECT current_tenant())` en policies, en staging,
     antes de comprometer la reescritura de las 97 policies.
   - RPCs públicos: `p_tenant_id` NO es frontera de seguridad (la
     anon key es pública). Definir qué expone y qué valida cada RPC
     público (tenant activo, tienda habilitada, anti-spam).
   - Auth: comodín de redirect URLs `*.app-solcraft.com` + JWT secret
     compartido como riesgo.
   - Modelo de releases: evaluar si Vercel permite fijar rama de
     producción por proyecto. Propuesta: `main` corre Solcraft; los
     clientes usan rama `release` que se promueve tras smoke en
     Solcraft y en un cliente piloto. Solo reportar — no cambiar
     Taiwy Sport.
   Orden del plan: primero rubro y aprovisionamiento; después
   staging, suite de aislamiento y, recién entonces, `tenant_id` y
   RLS. **NO** migrar Solcraft ni Taiwy Sport. 4 fases, adaptado a:
   celulares, sin DIAN por ahora, **seis clientes en espera**.
4. **ALTA — sin tocar aún** (pendientes del backlog SECDEF/deriva):
   - Alineación de los 4 guards de rol en Solcraft
     (`apply_customer_credit`, `create_adjustment`, `create_sale`,
     `void_adjustment`): adoptar la versión de Taiwy Sport,
     `CREATE OR REPLACE` sin `DROP` (preserva REVOKE a anon). SQL no
     escrito ni aplicado. **Requisito al aplicar**: la migración debe
     usar las versiones del REPO (idénticas a celulares-carmen HOY),
     no las de Taiwy Sport. En consecuencia los `prosrc` normalizados
     NO van a cambiar en CC/TS/SC post-migración vs el baseline actual
     del gate, así que `scripts/verify_provisioning.sql` NO requiere
     actualización. **Verificar re-ejecutando el gate contra las 3
     instancias tras aplicar — si cualquier `md5_norm` cambia respecto
     a los baselines, actualizar los hashes referencia del script.**
   - Trazabilidad de anulaciones (`voided_by`, `voided_at`,
     `void_reason` + vista "Anulados"). Alcance primera pasada:
     ajustes. Diseño aprobado; migración no aplicada. **Requisito al
     aplicar**: la migración reescribe `void_adjustment` para asentar
     los nuevos campos, cambiando su `prosrc`. Esto rompe el baseline
     del gate `verify_provisioning.sql §33b md5_norm_void_adjustment`
     (hoy `58c2918a...`). En el MISMO commit que aplica la migración:
     (i) correr el gate contra celulares-carmen para capturar el nuevo
     md5 normalizado de `void_adjustment`, (ii) actualizar el baseline
     del script, (iii) verificar que CC, TS y SC post-migración dan el
     mismo md5. Si TS o SC quedan en el valor viejo, documentar como
     deriva nueva en el registro.
   - Rotación anon key en Solcraft (`nxszaxwsrtlofqimbfig`) y
     `SUPABASE_SERVICE_ROLE_KEY`: siguen pendientes, sin fecha.

