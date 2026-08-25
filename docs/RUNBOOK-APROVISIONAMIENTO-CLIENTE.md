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

### 2.3 Aplicar scripts sueltos que NO están en la baseline

**TODO**: consolidar lista definitiva antes de la primera ejecución.
Sospechosos por nombre (candidatos a NO aplicar porque ya están en la
baseline o son solo dev):
- `scripts/00_schema.sql`, `01_functions.sql`, `02_rls.sql`,
  `03_storage.sql` — probablemente ya en baseline.
- `scripts/13a_seed_local.sql`, `13b_drift_wompi_local.sql` — solo local.
- `scripts/17rollback_*` — solo rollback, no aplicar.

Candidatos a SÍ aplicar si no están en baseline (revisar): `05_merge_features.sql`
(⚠️ contiene un bloque que asigna admin a `admin@solcraft.dev` — hay que
borrar ese bloque o adaptarlo al email del admin del cliente antes de
correr), `06`, `08`, `09`, `10`, `11`, `12`, `13`, `14`, `15`, `16`,
`17*` (varias fases de credit sales + adjustments + COGS), `18`.

### 2.4 Verificar integridad post-schema

```sql
SELECT * FROM verify_kardex_integrity();
-- Debe devolver 0 filas (invariante del kardex OK en DB vacía).
```

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

**TODO**: verificar si hay otras env vars requeridas revisando
`process.env.*` en el código. Grep sugerido:
`grep -r "process.env" --include="*.ts" --include="*.tsx" | grep -v node_modules`.

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
3. **§2.3**: consolidar lista definitiva de scripts sueltos a aplicar
   post-migraciones (auditar `scripts/` contra la baseline). **Pendiente
   de auditoría técnica de Claude**.
4. **§3.2**: verificar si hay env vars extra requeridas por el código
   (grep de `process.env.*`). **Pendiente de auditoría técnica de Claude**.
5. ~~**§5.4**: rubro de Taiwysport.~~ Resuelto: ropa/calzado, categorías
   default aplican.

---

## Registro de la primera ejecución (a completar durante el aprovisionamiento)

- **Cliente**: Taiwysport
- **Fecha de aprovisionamiento**: <YYYY-MM-DD>
- **Duración real**: <horas>
- **Subdominio**: `taiwysport.app-solcraft.com`
- **Supabase project ref**: `<REF>` (dashboard URL:
  `https://supabase.com/dashboard/project/<REF>`)
- **Vercel project id**: `<ID>` (dashboard URL:
  `https://vercel.com/<team>/<project>`)
- **Admin inicial**: `<email>`
- **Notas y sorpresas durante la ejecución**: (llenar sobre la marcha —
  esta sección alimenta la generalización del runbook para clientes futuros)
