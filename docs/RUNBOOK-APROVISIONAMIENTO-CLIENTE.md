# RUNBOOK-APROVISIONAMIENTO-CLIENTE.md

> **Propósito**: proceso paso-a-paso para desplegar una instancia nueva del
> POS para un cliente específico bajo el modelo **Camino A** (instancia
> separada por cliente: Supabase + Vercel propios, mismo código, cliente
> nunca crea una segunda sede).
>
> **Estado**: **borrador — primer cliente (Taiwysport)**. La primera
> ejecución real se hace con este documento en la mano; al terminar se
> generaliza a placeholders para clientes futuros.
>
> **Convención de valores por cliente**: los valores específicos
> (subdominio, credenciales, IDs de proyecto) van marcados como
> `<VALOR: descripción>` en este doc. **Los reales viven en el gestor de
> passwords de Esteban** bajo la entrada del cliente, no en git.

---

## 0. Pre-requisitos

- [ ] Acceso admin al dashboard de Supabase (cuenta de Esteban).
- [ ] Acceso admin al dashboard de Vercel (cuenta de Esteban).
- [ ] Acceso al panel DNS de `app-solcraft.com` para configurar el subdominio.
- [ ] Cuenta Wompi del cliente creada (o decisión de arrancar en sandbox).
- [ ] Repo `POS-SOLCRAFT` clonado localmente, en `main` actualizado.
- [ ] Ventana de tiempo estimada: **2-4 horas** de trabajo sin interrupciones.

**Datos que necesitás recolectar del cliente ANTES de empezar** (guardar en
gestor de passwords, entrada nueva para el cliente):

- Nombre comercial del negocio (`business_name`, ej: "Taiwysport").
- Nombre legal + NIT + régimen tributario + dirección + teléfono + email.
- Subdominio deseado (formato: `<slug>.app-solcraft.com`).
- Email del admin inicial (el dueño del negocio).
- Contraseña temporal para ese admin (el dueño la cambia al primer login).
- Wompi: sandbox o prod, y si prod: `public_key`, `private_key`,
  `integrity_secret`, `events_secret`.

---

## 1. Crear proyecto Supabase nuevo

### 1.1 Crear el proyecto

En el dashboard de Supabase → `New Project`:

- **Name**: `pos-<slug-del-cliente>` (ej: `pos-taiwysport`).
- **Database Password**: generar uno fuerte, **guardar en el gestor de
  passwords**.
- **Region**: `South America (São Paulo)` — latencia más baja para clientes
  en Colombia (verificar si el cliente está en otra región y ajustar).
- **Plan**: **Pro**. Decisión ya tomada. Razones:
  - El auto-pausado del plan Free tras 1 semana de inactividad es un
    riesgo real de mala experiencia para un cliente de pago (viernes de
    puente = lunes prendiendo Supabase manualmente).
  - Backups diarios automáticos no son opcionales para datos reales de
    otro negocio.
  - Los límites de conexiones de Free se rozan con tráfico medio.

Esperar ~2 minutos a que el proyecto quede provisioned.

### 1.2 Copiar credenciales del proyecto

En `Project Settings → API`:

- **Project URL** → copiar y guardar como `NEXT_PUBLIC_SUPABASE_URL`.
- **anon public** → copiar y guardar como `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **service_role** → copiar y guardar como `SUPABASE_SERVICE_ROLE_KEY`
  (⚠️ nunca commitear, nunca compartir por email/Slack).

Guardar los 3 valores en el gestor de passwords bajo la entrada del cliente.

### 1.3 Configurar Auth

En `Authentication → URL Configuration`:

- **Site URL**: `https://<slug>.app-solcraft.com`
- **Redirect URLs**: agregar `https://<slug>.app-solcraft.com/**`

⚠️ **Crítico**: sin esto los links de reset-password del email llevan al
proyecto de dev o rebotan.

En `Authentication → Providers → Email`:

- **Enable Email provider**: ON.
- **Confirm email**: **OFF**. Decisión ya tomada. Alineado con el modelo de
  servicio administrado: Esteban crea la cuenta del admin en Supabase y le
  pasa la contraseña temporal al cliente, sin pasar por el ciclo de email
  de confirmación. Si el cliente después quiere cambiar el email a uno
  suyo, hace el flujo normal desde el panel.

### 1.4 Configurar CORS (si aplica)

Supabase por defecto acepta requests de cualquier origen con la anon key
válida. Si el cliente requiere CORS restringido, en `Project Settings → API
→ CORS` agregar `https://<slug>.app-solcraft.com`.

---

## 2. Aplicar schema y RPCs a la nueva DB

### 2.1 Verificar orden de scripts

El schema del sistema vive en dos lugares que se aplican en orden:

1. **`supabase/migrations/`** — migraciones versionadas (baseline + deltas
   posteriores). Estado actual (2026-08-25):
   - `20260812000000_baseline_canonical_from_prod.sql` — schema completo.
   - `20260822000000_add_dispatch_transfer_atomic.sql` — s21.
   - `20260824000000_add_unique_barcode.sql` — s22.
   - `20260824000001_add_import_products_bulk_rpc.sql` — s22.
   - `20260824000002_update_import_products_bulk_rpc_inactive_message.sql` — s22.

2. **`scripts/`** — scripts sueltos aplicados históricamente. **Verificar
   con `@SUPABASE.md` cuáles ya están incluidos en la baseline y cuáles
   siguen sueltos** antes de correr todo a ciegas.

⚠️ **`scripts/04_seed.sql` está intencionalmente VACÍO** (stub). NO buscar
sembrar datos ahí — los datos iniciales del cliente se aprovisionan a mano
en el paso 6.

### 2.2 Aplicar migraciones

Opción A (recomendada): usar el Supabase MCP (`apply_migration`) desde
Claude Code, apuntando al proyecto nuevo. Aplicar cada archivo de
`supabase/migrations/` en orden.

Opción B: `supabase db push` con el CLI apuntando al proyecto nuevo.

Verificar al final:
- `list_tables` devuelve todas las tablas esperadas (sites, warehouses,
  products, product_stock, sales, transfers, business_settings, etc.).
- `list_migrations` refleja las 5 migraciones aplicadas.

### 2.3 ⚠️ CRÍTICO — aplicar scripts release 2C+2D después del baseline

**La baseline canónica `20260812000000` está INCOMPLETA.** Falta el release
2C+2D (scripts 15→18) que introdujo credit sales + inventory adjustments +
COGS. Sin estos scripts el sistema arranca aparentemente OK pero SE ROMPE
EN SILENCIO al primer intento de: crear un producto vía panel IA, hacer un
ajuste de inventario, registrar un abono a crédito, redimir saldo a favor,
o cerrar un turno.

Historia: descubierto en la primera ejecución del runbook (Taiwy Sport,
2026-08-25) cuando `/central` reportó `Could not find the function
public.create_adjustment(...)` al intentar ingresar el primer producto.
Los scripts 15-18 existían en `scripts/` pero la baseline dumpeada del
12-08 no los introspectó (razón exacta desconocida — probablemente el
dump generador tenía filtros o el estado de prod al 12-08 no los tenía
todos consolidados).

**Aplicar EN ESTE ORDEN EXACTO** (todo vía Supabase MCP `apply_migration`
o SQL editor del dashboard), después de las migraciones de §2.2:

| Orden | Script | Qué aporta |
|---|---|---|
| 1 | `scripts/15_credit_sales_phase1.sql` | Columnas `sales.is_on_account/amount_paid/balance_due`, tablas `sale_payments` + `customer_credits`, RPC `create_sale` v2 (13 args), `close_shift` v2, `get_shift_balance`, `void_sale` v2, `verify_credit_integrity`. Bootstrapea "Consumidor final" como `is_walk_in=TRUE`. |
| 2 | `scripts/16_inventory_adjustments_phase1.sql` | Columnas `inventory_adjustments.site_id/numero/status/motivo/created_by/updated_at`, RPC `create_adjustment` v1 (3 args), `void_adjustment`. |
| 3 | `scripts/17a_adjustments_numeracion.sql` | Tabla `adjustment_counters`, `create_adjustment` v2a con numeración atómica. |
| 4 | `scripts/17b_adjustments_wac.sql` | `create_adjustment` v2b con recálculo de WAC en incrementos. |
| 5 | `scripts/17c_v2_adjustments_no_expense.sql` | **⚠️ NO usar `17c_adjustments_contabilidad.sql` v1 — está INVALIDADO por design.** v2 agrega `create_adjustment` v2c-2 (4 args con `p_motivo`), `void_adjustment` con compensación de asientos, `accounting_entries.adjustment_id` FK, `verify_adjustment_accounting_integrity`. Método aprobado 2026-08-17: capitalización + COGS al vender. |
| 6 | `scripts/17e_cogs_in_sales.sql` | `sale_items.unit_cost`, `create_sale` v3 con persistencia de unit_cost + asiento COGS agregado, `void_sale` v3 con reversa COGS. |
| 7 | `scripts/18_credit_phase3.sql` **PARCIAL** | Aplicar SOLO `register_payment` y `apply_customer_credit`. **El bloque `create_sale` de este script se DESCARTA** porque 17e ya lo dejó en su versión final con COGS + guard D9. Aplicar 18 completo revierte el COGS del bloque de create_sale. |

Scripts que **NO** aplicar (bajo ninguna circunstancia):
- `17c_adjustments_contabilidad.sql` (v1, INVALIDADO por 17c_v2).
- `13a_seed_local.sql`, `13b_drift_wompi_local.sql` (marcados LOCAL-ONLY).
- `17rollback_2c_v2_and_cogs.sql` (solo emergencia).
- `05_merge_features.sql` completo (contiene bootstrap de admin con
  `admin@solcraft.dev`, dev email). Si se necesita algo puntual de ese
  script, extraer y adaptar antes de aplicar.
- `04_seed.sql` — es stub intencionalmente vacío desde commit `17aa2cb`.
- `00_schema.sql`, `01_functions.sql`, `02_rls.sql`, `03_storage.sql`,
  `06`, `08-14` — ya cubiertos por la baseline.
- Scripts `_validation` (`15_validation_phase1.sql`, `16_validation_phase1.sql`,
  `17_validation_phase2.sql`) — solo verificaciones para test manual, no
  cambian schema.

Deltas post-baseline via `supabase/migrations/*.sql` (aplicar ANTES de
los scripts 15-18, no después):
- s21 (`20260822...`) — `dispatch_transfer_atomic`.
- s22/s23 (`20260824*`) — importador masivo + permiso.

Además, aplicar como delta manual el trigger `on_auth_user_created` sobre
`auth.users` (no está en el baseline dump porque `auth` es schema
Supabase-managed):
```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 2.4 Chequeos automáticos post-schema — no negociables

**No confiar en "smoke test manual detectará los gaps"** — los gaps del
release 2C se manifestaron solo al hacer ajustes de inventario, que ni
siquiera son parte del smoke básico del POS. Ejecutar SIEMPRE estos
chequeos antes de pasar a Fase 3:

```sql
-- Integridad del kardex: 0 filas = OK
SELECT COUNT(*) AS kardex_violations FROM verify_kardex_integrity();

-- Integridad contable de ajustes voided: 0 filas = OK
SELECT COUNT(*) AS adj_accounting_violations FROM verify_adjustment_accounting_integrity();

-- Verificar RPCs críticos del release 2C+D presentes con las firmas correctas
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('create_adjustment','void_adjustment','create_sale','void_sale',
                  'register_payment','apply_customer_credit','get_shift_balance',
                  'close_shift','verify_credit_integrity','verify_adjustment_accounting_integrity',
                  'dispatch_transfer_atomic','import_products_bulk_atomic',
                  'handle_new_user','has_permission','has_site_access','is_admin',
                  'is_admin_or_encargado','is_global_role','user_role','user_site_id',
                  'user_accessible_sites','open_shift','add_cash_movement',
                  'adjust_warehouse_stock','decrement_product_stock','next_product_code',
                  'verify_kardex_integrity','fulfill_web_order','receive_transfer',
                  'reconcile_transfer','send_transfer_via_transit','transfer_stock')
ORDER BY proname;
```

La query de RPCs debe listar 30 funciones. Contrastar contra este número.
Firma esperada de las 3 críticas del release 2C+D:
- `create_adjustment(p_warehouse_id uuid, p_notes text, p_items jsonb, p_motivo text)` — 4 args.
- `create_sale(...13 args incluyendo p_is_on_account boolean, p_initial_payment numeric)`.
- `register_payment(p_sale_id uuid, p_amount numeric, p_payment_method text, p_shift_id uuid, p_notes text)`.

Si alguna falta o tiene firma distinta: alguno de los scripts 15-18 no se
aplicó o se aplicó en orden incorrecto (típicamente 17c v1 en vez de v2, o
18 completo pisando el COGS de 17e). Corregir antes de continuar.

---

## 3. Crear proyecto Vercel nuevo

### 3.1 Importar el repo

En Vercel → `Add New → Project` → importar `POS-SOLCRAFT` del GitHub de
Esteban.

- **Project Name**: `pos-<slug-del-cliente>` (mismo formato que Supabase).
- **Framework Preset**: Next.js (auto-detect).
- **Root Directory**: `./` (raíz).
- **Build Command**: default (`pnpm build`).
- **Install Command**: default (`pnpm install`).

**NO deployar todavía** — primero configurar env vars (paso 3.2), sino el
primer build falla por falta de `NEXT_PUBLIC_SUPABASE_URL`.

### 3.2 Configurar env vars

En `Project Settings → Environment Variables`, agregar (todas para
`Production` y `Preview`; `Development` es opcional):

| Variable | Valor | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | del paso 1.2 | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | del paso 1.2 | |
| `SUPABASE_SERVICE_ROLE_KEY` | del paso 1.2 | ⚠️ **Sensitive**, marcar |
| `NEXT_PUBLIC_APP_URL` | `https://<slug>.app-solcraft.com` | Requerido para redirect Wompi |
| `WOMPI_PRIVATE_KEY` | del cliente (o vacío si sandbox sin cuenta prod) | |
| `WOMPI_INTEGRITY_SECRET` | del cliente | |
| `WOMPI_EVENTS_SECRET` | del cliente | |
| `NEXT_PUBLIC_WOMPI_PUBLIC_KEY` | del cliente (opcional, también se puede meter en business_settings vía UI) | |

**Env vars opcionales** (defaults sirven, incluir solo si hay razón):
- `NEXT_PUBLIC_SITE_URL` — fallback secundario de `NEXT_PUBLIC_APP_URL`
  para el redirect Wompi. Redundante si `NEXT_PUBLIC_APP_URL` está bien
  seteado.
- `WOMPI_API_BASE`, `WOMPI_CHECKOUT_URL` — solo si Wompi cambia sus URLs
  oficiales (defaults en `lib/wompi.ts` apuntan a las URLs actuales).

**Env vars NO requeridas por el runtime** (solo tests y scripts locales):
- `SUPABASE_URL`, `E2E_*`, `TEST_PASSWORD`, `BASE_URL`, `PERF_BUDGET_MS` —
  usados por `e2e/*.spec.ts`, `scripts/measure-perf.mjs`, `scripts/smoke-core.mjs`.
  El cliente no corre estos, se saltean.

**Consideración especial — AI Gateway (Vercel) para `/api/analyze-product`**:

El panel IA de ingreso usa `generateObject` del SDK `ai` v7 con modelo
`google/gemini-2.5-flash`. Cuando la app corre en Vercel, la
autenticación del AI Gateway es automática vía OIDC del proyecto — no
requiere env var explícita, **PERO el consumo se factura al team
propietario del proyecto Vercel**. Si el proyecto Vercel del cliente
está bajo la misma cuenta de Esteban (recomendado para modelo
administrado), los créditos AI Gateway salen del billing de Esteban. Si
en algún cliente futuro se decide separar cuentas, hay que crear una API
key de AI Gateway en el team del cliente y setearla como
`AI_GATEWAY_API_KEY`.

### 3.3 Primer deploy

Trigger deploy manual desde Vercel dashboard. Esperar READY.

Verificar en Vercel logs: sin errores de build, sin runtime errors en el
primer request.

---

## 4. Configurar subdominio

### 4.1 Vercel: agregar el dominio al proyecto

En `Project Settings → Domains → Add`:

- Dominio: `<slug>.app-solcraft.com`.
- Vercel devuelve un valor CNAME o A record que hay que agregar al DNS.

### 4.2 DNS: crear el registro CNAME

En el proveedor DNS de `app-solcraft.com`:

- Tipo: `CNAME`.
- Name: `<slug>` (Vercel a veces pide `<slug>.app-solcraft.com`, verificar).
- Value: lo que Vercel devolvió (típicamente `cname.vercel-dns.com`).
- TTL: 3600 (o el default del proveedor).

Esperar propagación (5-30 min). Vercel muestra un check verde cuando
detecta el CNAME correctamente resuelto y emite el certificado SSL
automáticamente.

### 4.3 Verificar HTTPS

Abrir `https://<slug>.app-solcraft.com` en el browser. Debería cargar el
login del POS con certificado SSL válido.

---

## 5. Aprovisionar datos iniciales en la DB

Ejecutar los siguientes INSERTs desde el SQL Editor de Supabase (o vía
Supabase MCP `execute_sql` desde Claude Code). Reemplazar los placeholders
con los datos del cliente.

### 5.1 Lista de precios por defecto

```sql
INSERT INTO price_lists (name, is_default) VALUES ('General', TRUE);
```

### 5.2 Sedes virtuales (patrón "una sede física, dos sedes virtuales")

**Decisión de diseño confirmada** (ver auditoría 2026-08-25):

El sistema actual asume ≥2 sedes con una `is_central=TRUE` y al menos una
`is_central=FALSE`. Con una sola sede, romper esa asunción con un parche al
sidebar (`isCentral` gate) crea deuda arquitectónica que otros módulos
futuros heredarían. **Solución**: crear dos sedes virtuales que representan
la misma tienda física — una "Bodega Central" (donde ingresa la mercancía
inicial vía panel IA o importador) y una "Sede de venta" (donde ocurren
las ventas POS). El cliente hace un traslado inicial central → venta al
arrancar y después opera solo en la sede de venta.

Fricción operativa: **un traslado por ingreso de mercancía nueva**. A cambio
se evita introducir excepciones al modelo de `is_central` que después
habría que revertir cuando aparezca un segundo cliente con configuración
similar.

```sql
-- Sede central (virtual, solo para ingreso de mercancía)
INSERT INTO sites (name, code, is_central, address) VALUES
  ('Bodega Central', 'CENTRAL', TRUE, NULL);

-- Sede de venta real (donde ocurre el POS)
INSERT INTO sites (name, code, is_central, address) VALUES
  ('<NOMBRE_TIENDA>', '<CODIGO_3_LETRAS>', FALSE, '<DIRECCION>');

-- Warehouse primaria para cada sede (transparente al usuario)
INSERT INTO warehouses (site_id, name, is_primary)
SELECT site_id, 'Principal', TRUE FROM sites;
```

### 5.3 Cliente por defecto del POS

```sql
INSERT INTO customers (name) VALUES ('Consumidor final');
```

### 5.4 Categorías base

**Taiwysport es rubro ropa/calzado**, así que las 5 categorías default
aplican tal cual:

```sql
INSERT INTO categories (name) VALUES
  ('Camisas'), ('Pantalones'), ('Vestidos'), ('Calzado'), ('Accesorios');
```

**Para clientes futuros de otro rubro**: adaptar la lista al negocio del
cliente. Nota: el panel IA de `/central` seguirá devolviendo `type_prefix`
de ropa (`CA`, `PA`, `VE`, ...) porque el prompt está hardcodeado — deuda
técnica documentada.

### 5.5 `business_settings` con datos del cliente

```sql
INSERT INTO business_settings (
  id, business_name, legal_name, tax_id, phone, email, regime,
  address, template_style, header_alignment, paper_width_mm,
  show_description, show_unit_price, show_logo,
  whatsapp_number, whatsapp_enabled, cod_enabled,
  wompi_enabled, wompi_sandbox, pickup_enabled, delivery_enabled
) VALUES (
  1,
  '<BUSINESS_NAME>',
  '<LEGAL_NAME>',
  '<NIT>',
  '<PHONE>',
  '<EMAIL>',
  '<REGIMEN>',                -- ej: 'Responsable de IVA' o 'No responsable de IVA'
  '<ADDRESS>',
  'clasico', 'center', 80,
  false, true, false,
  '<WHATSAPP>', true, true,
  <WOMPI_ENABLED>, <WOMPI_SANDBOX>, true, true
);
```

### 5.6 Usuario admin inicial

**Paso A** — crear el usuario en Supabase Auth:

Desde `Authentication → Users → Add user → Create new user`:
- Email: del cliente (o del dueño del negocio).
- Password: contraseña temporal fuerte (guardar en gestor).
- ✅ Auto Confirm User.

Copiar el `id` (UUID) del usuario recién creado.

**Paso B** — insertar el `user_profile` con role admin:

```sql
INSERT INTO user_profiles (id, email, full_name, role, site_id)
VALUES (
  '<UUID_DEL_PASO_A>',
  '<EMAIL_DEL_ADMIN>',
  '<NOMBRE_COMPLETO>',
  'admin',
  NULL  -- admin es global, sin site_id
);
```

---

## 6. Smoke test end-to-end

Con los datos iniciales cargados, ejecutar en el navegador contra
`https://<slug>.app-solcraft.com`:

- [ ] **Login**: entrar con el admin creado. El header dice "Solcraft POS"
      (branding de plataforma), el nombre del negocio del cliente aparece
      en `/settings/receipt` y en el catálogo público.
- [ ] **Ingresar producto vía panel IA** (`/central`): subir una foto,
      completar campos sugeridos, crear con stock inicial en Bodega Central.
      Verificar `stock_movements` tiene 1 fila con `reference_type =
      'ai_ingress'` (o el equivalente que aplique).
- [ ] **Traslado central → sede de venta** (`/transfers/send`): enviar
      el producto recién creado. Recibir en `/transfers/receive` desde la
      sede de venta. Verificar `stock_movements` (salida central + entrada
      tránsito + entrada venta = 3 filas por producto).
- [ ] **`SELECT * FROM verify_kardex_integrity()`**: devuelve 0 filas.
- [ ] **Abrir turno** en `/pos` desde la sede de venta.
- [ ] **Vender 1 unidad al Consumidor final**, pago en efectivo. Verificar
      el recibo impreso muestra los datos del cliente.
- [ ] **Cerrar turno**. Verificar cuadre = 0.
- [ ] **(Si Wompi activo)** Probar checkout público en `/catalog`:
      agregar producto al carrito, checkout, redirect a Wompi, pagar en
      sandbox, redirect de vuelta a `/catalog/order/*/pago`. Verificar
      webhook procesado en `payment_events` tabla.

---

## 7. Handoff al cliente

- [ ] Enviar al cliente: URL (`https://<slug>.app-solcraft.com`), email
      del admin, contraseña temporal, instrucción de cambiar contraseña al
      primer login.
- [ ] Explicar la fricción del "traslado central→venta" para ingresar
      mercancía nueva (limitación temporal del modelo de una sede).
- [ ] Documentar en el gestor de passwords: URL Supabase project, URL
      Vercel project, DNS record, quién es el contacto principal del
      cliente.

---

## Deuda técnica documentada (aceptada, no bloquea el aprovisionamiento)

1. **Sistema asume ≥2 sedes** (`is_central=TRUE` + no-central). Cliente
   de sede única se aprovisiona con dos sedes virtuales — ver §5.2.
   Revisar cuando aparezca un segundo cliente con este patrón si se
   justifica arreglar quirúrgicamente.
2. **Panel IA de ingreso** (`/api/analyze-product`) hardcodeado a rubro
   ropa (categorías, `type_prefix`, prompt Gemini). Deuda futura si un
   cliente no-ropa entra al pipeline.
3. **Catálogo público** (`/catalog`, componentes en `components/catalog/`)
   mantiene branding "Taiwy" hardcodeado + asset `public/taiwy-logo.png`
   + `public/hero-logo.glb`. Cada cliente re-brand su storefront al deploy
   (decisión híbrida ya tomada — ver auditoría 2026-08-25).
4. **Moneda COP hardcodeada** en formateo (`lib/utils.ts`,
   `components/ui/money-input.tsx`, Wompi actions). OK para clientes
   colombianos, deuda para multi-país.
5. **Pasarela = Wompi (Colombia only)**. Cliente no-colombiano necesita
   integrar otra pasarela — deuda futura.

---

## TODOs pendientes en este runbook (resolver antes de la primera ejecución real)

1. ~~**§1.1**: plan Supabase.~~ Resuelto: **Pro**.
2. ~~**§1.3**: política "Confirm email".~~ Resuelto: **OFF**.
3. ~~**§2.3**: scripts sueltos vs baseline.~~ Resuelto: aplicar SOLO
   `supabase/migrations/*.sql`, ignorar `scripts/` completo para
   clientes nuevos.
4. ~~**§3.2**: env vars extra.~~ Resuelto: tabla de §3.2 completa +
   opcionales documentadas + nota sobre AI Gateway.
5. ~~**§5.4**: rubro de Taiwysport.~~ Resuelto: ropa/calzado, categorías
   default aplican.

---

## Registro de la primera ejecución (a completar durante el aprovisionamiento)

- **Cliente**: Taiwy Sport
- **Fecha de aprovisionamiento**: 2026-08-25 (en curso)
- **Subdominio**: `taiwysport.app-solcraft.com`
- **Supabase project ref**: `aapchdjwpqhwsquffnxn` (dashboard:
  `https://supabase.com/dashboard/project/aapchdjwpqhwsquffnxn`)
- **Supabase region**: sa-east-1 (São Paulo)
- **Vercel project id**: `prj_x9tjLwW4RXltN4P2FfXRWeycNLTo` (dashboard:
  `https://vercel.com/estebangz-makers-projects/pos-taiwysport`)
- **Vercel team id**: `team_NYfI1cmi7rmw2rG6BEP7Ws2p`
- **Admin inicial**: Estebangz070@gmail.com

### Sorpresas y hallazgos durante la ejecución (a re-integrar en el runbook)

Cada una de estas cosas costó una iteración de debug real durante el
primer aprovisionamiento. Todas están accionadas — el runbook actual ya
las contempla — pero se listan acá como el registro histórico de qué
falló y por qué las secciones respectivas quedaron como están.

**0. ⚠️ MÁS CRÍTICO — Baseline canónica INCOMPLETA sin release 2C+2D**
(Fase 2). La afirmación original del runbook "aplicar solo migrations/,
ignorar scripts/" era FALSA. La baseline dumpeada el 12-08 no capturó ~10
RPCs del release 2C+D (scripts 15-18: credit sales, inventory
adjustments, COGS). Sin ellos el sistema arranca APARENTEMENTE OK pero
rompe en silencio al primer intento de: ajuste de inventario, ingreso via
panel IA (usa `create_adjustment`), abono a crédito, redención saldo a
favor, cierre de turno con abonos. Descubierto solo porque Esteban
tropezó con el error de `create_adjustment` al ingresar el primer
producto. Un cliente futuro que no haya intentado ingresar via IA jamás
lo habría notado hasta rot-en-producción real. Runbook §2.3 ahora tiene
la lista definitiva y ordenada de scripts a aplicar; §2.4 agrega
chequeos automáticos post-schema (verify_kardex_integrity +
verify_adjustment_accounting_integrity + conteo de RPCs) que ejecutarse
SIEMPRE antes de pasar a Fase 3. Estos chequeos hubieran detectado el
gap sin depender de detección manual.

**1. pnpm packageManager pin obligatorio** (Fase 3, la más crítica de
build).
El repo no tenía `packageManager` en `package.json`. Vercel usó pnpm
11.22 (la última que traía su build image ese día), que aplica una
política estricta: `ERR_PNPM_IGNORED_BUILDS` si algún dep con install
script no está en `onlyBuiltDependencies` (whitelist explícito). El
prod actual (`pos-solcraft-1-a1x2`) venía funcionando solo por cache
de builds viejos previos a pnpm 10 — cualquier "clear cache and
redeploy" o instancia nueva pegaba el mismo error. Además la config
que existía estaba en dos lugares equivocados (`pnpm.onlyBuiltDependencies`
en `package.json`, ubicación deprecada + `pnpm-workspace.yaml` con keys
inválidas `ignoredBuiltDependencies` y `allowBuilds`). Fix en dos
commits: `742165a` (limpiar workspace file, dejar como fuente única de
verdad con sharp+unrs-resolver en `onlyBuiltDependencies`) y `f45d638`
(pinear `packageManager: pnpm@9.15.9`). Sin esos fixes en `main`,
CUALQUIER cliente nuevo hubiera pegado el mismo error el día 1.
**Regla para runbook**: revisar `packageManager` antes de aprovisionar;
si Vercel bump a una versión mayor de pnpm en el futuro, re-validar
que el build sigue funcionando o mantener el pin actualizado.

**2. MCP `create_git_project` de Vercel reutiliza el proyecto ya
linked al repo** (Fase 3). Al intentar crear el proyecto nuevo apuntando
al mismo repo `EstebanGZ-maker/POS-SOLCRAFT-1`, el MCP reutilizó el
`pos-solcraft-1-a1x2` existente (prod actual) en vez de crear uno
nuevo — la relación es 1:1 por repo, no por nombre de proyecto. **NO
se rompió nada** porque no se pushearon env vars nuevas (habría
sobreescrito las de prod), pero el flag confirma que:
- **Cliente actual**: se creó el proyecto Vercel a mano desde el
  dashboard (permite múltiples proyectos apuntando al mismo repo, cosa
  que el MCP no).
- **Cliente futuro (2do en adelante)**: fork el repo por cliente. El
  patrón "N proyectos Vercel apuntando al mismo main" genera N builds
  por cada push, desperdicia recursos y arriesga config cruzada entre
  clientes. Con fork por cliente cada uno tiene su rama `main` propia
  y su ciclo de deploy independiente. Los fixes al código base se
  propagan vía `git remote add upstream` + pull selectivo.

**3. Orden de creación de funciones SQL importa** (Fase 2). Las
funciones LANGUAGE sql como `has_permission` y `has_site_access` llaman
a `is_admin()` / `is_global_role()`. Postgres valida referencias al
parsear el body de funciones SQL — hay que declarar los helpers PRIMERO.
En prod real la baseline se aplicó de una-vez en un solo transaction
post-dump y el orden importó. Al pasar por MCP como chunks separados
(por el límite de tokens del MCP), tuve que reordenar: `part2a`
(helpers auth) → `part2b` (RPCs core) → `part2c` (web/catalog).
**Regla para runbook**: si se aplica la baseline por chunks, `is_admin`
/`is_admin_or_encargado`/`is_global_role`/`user_role`/`user_site_id`/
`user_accessible_sites` van ANTES que cualquier función que las use.

**4. Trigger `on_auth_user_created` faltante en baseline** (Fase 2).
La baseline dumpeó solo el schema `public`; el trigger vive en
`auth.users` (schema Supabase-managed) que no se introspecta. Sin este
trigger, crear un user via Supabase Auth NO genera automáticamente el
`user_profile` correspondiente. Se aplicó como migración delta
`auth_trigger_on_new_user`:
```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

**5. `create_project` de Supabase MCP no expone DB password ni
service_role key** (Fase 1). Supabase genera el password de DB al
crear el proyecto y solo lo muestra una vez en el dashboard al crear
vía UI — cuando se crea vía MCP, no se ve nunca. El service_role key
tampoco está en `get_publishable_keys` (que solo devuelve anon y
publishable). Ambos se traen manualmente del dashboard → Settings →
API cuando se necesitan. El password no lo necesita la app (usa el
JWT); el service_role sí lo necesita cualquier flow que bypasee RLS
(webhook Wompi, importador de productos).

**6. `apply_migration` del MCP Supabase tiene límite de tokens por
call** (Fase 2). La baseline entera (3299 líneas) no cabe en un solo
call. La partí en 5 chunks lógicos siguiendo los section markers del
archivo (`-- ---- Extensions`, `-- ---- Tables`, etc.). Para clientes
futuros, el mismo split funciona sin cambios.
