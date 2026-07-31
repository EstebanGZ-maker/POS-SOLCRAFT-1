# Plan de pendientes por módulo — POS-SOLCRAFT

> Estado verificado contra la base de datos y el código el **29/07/2026**.
> Cada módulo es un punto de control: se implementa, se revisa contigo, se ajusta.

## Estado actual (medido, no estimado)

| Indicador | Valor |
|---|---|
| Productos activos | 3 |
| Productos con foto | **0** |
| Descuadres de kardex | 0 ✅ |
| Pedidos web registrados | 2 |
| Cuentas de cliente creadas | 0 |
| RPC `receive_transfer` en DB | **no existe** (es TypeScript) |
| Envío sede → sede | **no existe en la interfaz** |

---

## M1 · Consistencia multi-sede ✅ COMPLETADO (29/07/2026)

Corregido en 7 puntos (5 previstos + 2 del frontend que aparecieron al revisar).
Verificado contra la base de datos: un encargado con La Ceja + Rionegro accede a
ambas y no a Marinilla. Kardex sigue en 0 descuadres.

<details><summary>Detalle original</summary>

**Regresión introducida al construir el acceso multi-sede.** Seis puntos del código
siguen comparando contra `profile.site_id` (la sede primaria) en vez de la lista de
sedes accesibles (`user_sites`).

Efecto real: un encargado con La Ceja + Rionegro asignadas, cuya sede primaria es
La Ceja, **no puede operar en Rionegro**. El panel de usuarios le muestra ambas, pero
el sistema lo bloquea sin mostrar error.

| Archivo | Línea | Qué rompe |
|---|---|---|
| `lib/kardex-actions.ts` | 20, 97 | Kardex solo muestra la sede primaria |
| `lib/inventory-actions.ts` | 547 | `getPendingTransfersForSite` niega recepción |
| `lib/inventory-actions.ts` | 605 | `getTransferById` niega traslados de otras sedes |
| `lib/inventory-actions.ts` | 639 | `receiveTransfer` niega recepción en otras sedes |

**Trabajo:** reemplazar esas comparaciones por `getAccessibleSiteIds()`, que ya existe
en `lib/auth-helpers.ts`.

**Criterio de aceptación:** un encargado con dos sedes asignadas puede ver kardex,
consultar traslados y recibir mercancía en ambas.

**Esfuerzo:** bajo (~1h) · **Bloquea a M2** — no tiene sentido abrir envíos entre
sedes mientras el control de acceso por sede esté a medias.

</details>

**Nota:** existe un usuario de prueba `qa.multisede@solcraft.dev` (encargado, La Ceja +
Rionegro) creado para verificar esto. Se puede borrar cuando quieras:
`DELETE FROM auth.users WHERE email = 'qa.multisede@solcraft.dev';`

---

## M2 · Envíos entre sedes ✅ COMPLETADO (29/07/2026)

Probado de punta a punta: El Carmen Damas → Marinilla, 1 unidad. El stock salió de
origen (1 → 0), entró a tránsito, y Marinilla ve el envío junto a los de la bodega
central. Kardex: `traslado_salida -1 | transito_entrada 1`, 0 descuadres.

Extra encontrado y corregido: la **bodega de Tránsito aparecía como destino elegible**.
Bloqueada en la interfaz y también en el servidor.

<details><summary>Detalle original</summary>

Hoy **una sede no puede enviar mercancía**. Solo la bodega central despacha.

Diagnóstico:

| Causa | Ubicación |
|---|---|
| El origen está hardcodeado a central | `app/central/page.tsx:217` → `from_warehouse_id: centralWarehouseId` |
| Las sedes no ven la pantalla de envíos | `dashboard-sidebar.tsx` → grupo con `centralOnly: true` |
| No se puede devolver a central | `app/central/page.tsx:106` → destinos filtrados con `!s.is_central` |
| **Sin validación de bodega origen** | `lib/inventory-actions.ts:478` → solo valida rol, no propiedad |

Ese último punto es un **hueco de seguridad**: un encargado podría despachar stock
desde la bodega central o desde otra sede manipulando la petición. Hoy es teórico
porque la pantalla no lo permite; al abrir los envíos se vuelve explotable.

**Lo bueno:** el backend ya lo soporta. `createBulkTransfer` recibe `from_warehouse_id`
como parámetro y el flujo por bodega de tránsito es agnóstico al origen. Es trabajo de
interfaz y de validación, no de arquitectura.

### Decisiones tomadas

| Decisión | Resuelto |
|---|---|
| Autorización | **Directo, sin aprobación.** El origen despacha; el destino confirma al recibir |
| Devoluciones | **Sí**, cualquier sede puede devolver a la bodega central |
| Modelo | **Push.** Solo el origen decide enviar; no hay solicitudes |

Ninguna requiere tablas ni estados nuevos.

**Trabajo:**
1. Nueva pantalla `/transfers/send`, disponible desde cualquier sede
2. Origen = bodega de la sede activa (no hardcodeado)
3. Destinos = todas las demás sedes **incluida la central**
4. Selector de productos limitado a lo que **existe en la sede origen** con su stock real
5. Validar en el servidor que el encargado tenga acceso a la bodega origen
6. Sidebar: mover "Enviar mercancía" fuera del grupo `centralOnly`

**Criterio de aceptación:** un encargado en La Ceja envía 5 unidades a Rionegro; el
stock sale de La Ceja, entra a tránsito, y Rionegro lo ve en "Recibir mercancía".
`verify_kardex_integrity()` devuelve 0 filas. Un encargado de La Ceja **no puede**
despachar desde Marinilla ni desde central.

**Retroalimentación:** ¿el encargado debe ver el stock de la sede destino al armar el
envío, para decidir cuánto mandar?

**Esfuerzo:** medio (~5h) · **Riesgo si no se hace:** alto — es operación diaria que
hoy toca resolver por fuera del sistema.

</details>

---

## M3 · Integridad de traslados ✅ COMPLETADO (29/07/2026)

La recepción vive ahora en el RPC `receive_transfer`: una sola transacción con
`FOR UPDATE` sobre el traslado, sus líneas y el saldo de tránsito.

Probado: recepción parcial 5+6 de 11 · tope estricto (pedí 999, recortó a 6) ·
doble recepción rechazada · **rollback verificado** (lote de 2 líneas donde la 2ª
falla → la 1ª tampoco se aplica) · ciclo completo por la interfaz. 0 descuadres.

**Bug adicional encontrado:** `transfers.status` era `varchar(20)` y
`'recibido_con_pendiente'` tiene 22 caracteres — **la recepción parcial nunca pudo
funcionar**. Columna ampliada a TEXT, estado legado `'completed'` normalizado a
`'recibido'` (3 filas, verificadas como completas), y constraint reafirmado.

<details><summary>Detalle original</summary>

Los bugs de la auditoría original **siguen sin corregir**. No existen las funciones
`receive_transfer` ni `reconcile_transfer` en Postgres: la recepción vive en
`lib/inventory-actions.ts:613` como server action, leyendo y escribiendo sin lock.

| # | Bug | Consecuencia |
|---|---|---|
| 1 | Sin lock de fila (`FOR UPDATE`) | Dos encargados recibiendo a la vez duplican stock |
| 2 | Sin transacción | Si falla a mitad, queda stock descuadrado |
| 6 | `received_by`/`received_at` se sobrescriben | Se pierde el rastro de la primera recepción parcial |

**Sube de prioridad con M2:** habilitar envíos entre sedes multiplica los movimientos
concurrentes, que es justo el escenario donde estos bugs muerden.

**Trabajo:** mover recepción y reconciliación a RPCs en Postgres con
`SELECT … FOR UPDATE` sobre las filas de stock, todo dentro de una transacción.

**Criterio de aceptación:** enviar 10 y recibir 8 desde dos sesiones simultáneas deja
exactamente 8 en destino y 2 en tránsito.

**Esfuerzo:** medio (~4h)

</details>

---

## M3b · Reconciliación de traslados ✅ COMPLETADO (29/07/2026)

RPC `reconcile_transfer` con la misma garantía que la recepción: una transacción,
`FOR UPDATE` sobre traslado, líneas y saldo de tránsito.

**Decisión:** solo **admin y contador** pueden reconciliar. Dar de baja faltantes es
un acto contable, y quien recibe la mercancía no debe poder ocultar un faltante.
Nuevo permiso `transfers_reconcile`, otorgado a admin y contador.

**Probado:** traslado de 8 uds, recibidas 5, quedaban 3 → declaré 1 hallada y 2
perdidas. Resultado: destino 6, tránsito **0**, estado `recibido`, 0 descuadres.
Encargado y vendedor **rechazados** por el RPC.

Rastro en kardex (todo referenciado al traslado y al usuario):

```
traslado_salida   -8   Central
transito_entrada  +8   Tránsito
transito_salida   -5   Tránsito      ← recepción parcial
traslado_entrada  +5   Rionegro
transito_salida   -1   Tránsito      ← reconciliación, hallada
traslado_entrada  +1   Rionegro
ajuste            -2   Tránsito      ← pérdida dada de baja
```

Tránsito: +8 −5 −1 −2 = **0**. Rionegro: +5 +1 = **6**.

La pantalla `/transfers/reconcile` muestra el pendiente, cuánto queda en tránsito,
la pérdida calculada y **su costo**, y avisa si el tránsito no cuadra antes de
intentar la operación.

**Pendiente menor:** la pérdida se registra en el kardex pero **no genera asiento
contable**. Si quieres que el faltante impacte el estado de resultados, hay que
crear un `accounting_entry` de egreso por el costo. Queda anotado.

---

## M4b · Optimización de rendimiento del catálogo ✅ COMPLETADO (29/07/2026)

Medido antes y después contra la app real, en dev mode:

| Métrica | Landing antes | Landing ahora | Grid antes | Grid ahora |
|---|---:|---:|---:|---:|
| TTFB | 2 558 ms | **976 ms** | 2 558 ms | **913 ms** |
| First Contentful Paint | 3 208 ms | **1 192 ms** | 3 208 ms | **1 140 ms** |
| Load completo | 3 082 ms | **1 457 ms** | 3 082 ms | **1 531 ms** |
| Fetches al cargar | 4 en serie | **3 en paralelo** | 6 (dev + strict) | **3** |

Cambios:

- **Agotados fuera por defecto** — ahorra cargar sus imágenes; el toggle
  se llama "Mostrar agotados" y añade `?ver_agotados=1` a la URL. Se pueden
  compartir enlaces con los filtros aplicados.
- **Grid convertido a Server Component + Client Component** —
  `page.tsx` precarga sitios, facetas y productos en paralelo desde el
  servidor y los inyecta al cliente vía `fallbackData` de SWR. El primer
  render ya trae datos, no skeleton. SWR solo revalida al cambiar filtros.
- **`revalidate = 60`** en el detalle del producto (`/catalog/[code]`).
- **Prefetch** en los enlaces del grid y de destacados.
- **Prioridad de imágenes**: las 8 primeras del grid con `priority`, el
  resto con `loading="lazy"`; los destacados de la landing en `lazy` para
  no competir con el LCP del hero.

### Lo que queda al llegar a producción

- **Instalar `sharp`** y poner `images.unoptimized: false` en `next.config.mjs`.
  Next reescala y convierte a AVIF/WebP automáticamente; hoy sirvo el WebP tal
  cual (ya bastante optimizado por la compresión en el navegador al subir).
  Requiere desbloquear pnpm.
- **CDN delante del bucket público**. Supabase Storage sirve las fotos con
  `cache-control: max-age=3600`; con un CDN encima quedan cerca del usuario.

---

## M4 · Fotos de producto ✅ COMPLETADO (29/07/2026)

Bucket, políticas y subida ya existían — el alcance real fue **blindarlo,
optimizar y añadir galería**.

**Hallazgo de seguridad al abrir:** `uploadProductMedia` no tenía guard de rol
y las políticas del bucket solo comprobaban el bucket, no el rol. **Un vendedor
podía subir y borrar archivos arbitrarios en un bucket público.** Corregido:
guard `admin`/`encargado` en el server action, validación de firma binaria
(no solo mime declarado), límite de 5 MB, límites a nivel de bucket, y
políticas de Storage restringidas a `is_admin_or_encargado()`.

**Compresión en el navegador** con Canvas, sin dependencias (`sharp` sigue sin
instalarse por el bloqueo de pnpm). Probado real: JPEG de 39 KB → **WebP de
8 KB** subido al bucket.

**Galería** — nueva tabla `product_images` con foto principal única, trigger
que sincroniza `products.image_url` con la principal, gestor en el POS con
drag/reorder/marcar principal/eliminar, y visor en el catálogo con miniaturas
y flechas. Probado subiendo 2 fotos a la vez: 2/8, principal marcada, ambas
navegables en el catálogo.

**Bug corregido de paso:** `GlowCard` no tenía `h-full` en su contenedor
interno, así que cualquier hijo con `fill` medía 0. Rompía el visor de galería
pero no las tarjetas del grid (aspect-square las forzaba). Corregido.

**Huérfanos del bucket** — al borrar un producto, el archivo quedaba. Nueva
función `list_orphan_product_media()` + acción `purgeOrphanProductMedia()`
que borra por la Storage API (SQL no puede tocar `storage.objects`
directamente). Margen de 1 hora para no tocar subidas en curso.

**Producción:** cuando pnpm se pueda usar, `pnpm add sharp` y cambiar
`unoptimized: true` a `false` en `next.config.mjs` activa el escalado y
conversión automática de Next. Mientras tanto next/image aporta lazy loading,
dimensionado y cero CLS, que ya es la mayor parte del beneficio.

<details><summary>Detalle original</summary>

Cero de tres productos tienen imagen. El catálogo y la landing muestran el ícono de
placeholder. El diseño está listo; le faltan las fotos.

**Trabajo:**
1. Bucket de Supabase Storage con lectura pública
2. Carga desde el POS con recorte y compresión a WebP
3. Tabla `product_images` para galería
4. Migrar el catálogo a `next/image` con blur placeholder

**Criterio de aceptación:** subir una foto desde el POS y verla en el catálogo;
LCP bajo 2.5 s.

**Retroalimentación:** ¿una foto por producto o galería? ¿Quién las sube — solo
central o también cada sede?

**Esfuerzo:** medio (~5h)

---

## M5 · Pagos con Wompi 🟡 BLOQUEADO POR CREDENCIALES

Código completo y verificado: firma de integridad, webhook con validación de checksum,
idempotencia y validación de monto. Falta solo la configuración — ver tarea **#38**.

**Esfuerzo:** 30 min tuyos · **Riesgo:** ninguno mientras esté apagado.

---

## M6 · SEO y performance 🟡 MEDIO

Hoy solo hay `generateMetadata` en landing y detalle.

**Trabajo:** `sitemap.xml` dinámico · `robots.txt` · JSON-LD `Product` ·
Meta Pixel (`1558087961571742`) · eventos `ViewContent` y `AddToCart` ·
`slug` para URLs legibles · auditoría responsive 375/768/1024/1440.

**Retroalimentación:** ¿el dominio final ya está definido? Lo necesito para el sitemap
y para `NEXT_PUBLIC_APP_URL`.

**Esfuerzo:** medio (~4h)

---

## M7 · Reproducibilidad de scripts SQL 🟠 DEUDA TÉCNICA

Buena parte del esquema se aplicó por migraciones directas y **no está en
`scripts/*.sql`**. Recrear el proyecto desde cero hoy no reproduce el sistema.

Falta versionar: `admin_create_user`, `admin_reset_password`, `user_sites`,
`permissions`, `business_settings`, `web_orders`, `web_order_items`, `payment_events`,
las funciones `public_*` del catálogo, `fulfill_web_order` y las de Wompi.

**Esfuerzo:** medio (~3h) · **Riesgo:** alto el día que necesites un entorno de
pruebas o restaurar.

---

## M8 · Recoger en tienda 🟢 BAJO

La base de datos ya lo soporta (`delivery_method = 'pickup'`, `pickup_enabled`) y el
RPC valida la sede. Falta exponerlo en el checkout — está inactivo a propósito porque
elegiste envío a domicilio únicamente.

**Esfuerzo:** bajo (~2h)

---

## M9 · Cuentas de cliente 🟢 BAJO

`customer_accounts` existe, vacía y sin interfaz. Elegiste "invitado por defecto,
cuenta si quiere"; falta la mitad opcional.

**Retroalimentación:** ¿vale la pena con el volumen actual?

**Esfuerzo:** medio (~4h)

---

## M10 · Diamante 3D con Three.js ✅ COMPLETADO (29/07/2026)

pnpm instalado globalmente, three@0.185 añadido. Motor portado desde
`taiwy-diamond-3d.jsx` sin el logo TAIWY, en `components/catalog/diamond-hero-3d.tsx`.

Se carga con `next/dynamic({ ssr: false })` — no arrastra Three.js al bundle
inicial. El switch (`diamond-hero-switch.tsx`) decide por dispositivo:

| Contexto | Versión |
|---|---|
| Móvil (<640 px) | SVG (batería) |
| prefers-reduced-motion | SVG |
| Sin WebGL | SVG |
| Desktop con WebGL | Three.js |

El SVG se muestra mientras carga el 3D → **cero CLS**. IntersectionObserver
pausa el render cuando el hero sale de vista → cero CPU/GPU cuando no se ve.

**Bonus:** aparecio `sharp` en la instalación, así que también activé la
optimización de `next/image`. AVIF + WebP automáticos con caché de 24 h.

<details><summary>Detalle original</summary>

El hero actual es SVG animado — 0 KB, funciona en todo. La versión Three.js existe en
`Downloads/taiwy-diamond-3d.jsx` pero está bloqueada: el proyecto usa pnpm, pnpm no
está instalado, y npm no puede operar sobre este `node_modules`.

**Desbloqueo:** `npm i -g pnpm` y luego `pnpm add three`. Además hay que quitarle el
logo TAIWY en base64 que trae incrustado.

**Esfuerzo:** bajo una vez desbloqueado (~2h)

</details>

---

## Orden propuesto

```
1. M1  Multi-sede          ← corrige lo roto; habilita M2
2. M2  Envíos entre sedes  ← operación diaria que falta
3. M3  Integridad traslados← protege el inventario bajo concurrencia
4. M4  Fotos               ← desbloquea la venta
5. M5  Wompi               ← cobra en línea (depende de ti)
6. M6  SEO                 ← trae tráfico
7. M7  Scripts SQL         ← asegura poder recrear
8. M8/M9/M10               ← según prioridad de negocio
```

**Razón del orden:** M1 → M2 → M3 forman una cadena. Arreglar el acceso por sede
habilita los envíos entre sedes; los envíos entre sedes aumentan la concurrencia,
que es lo que vuelve urgente el bloqueo transaccional. Después va lo que genera
ingreso (fotos, pagos) y al final lo que amplifica (SEO).

---

## Cómo trabajamos cada módulo

1. Te muestro el alcance concreto antes de tocar código
2. Implemento
3. Verifico en el navegador y contra la base de datos
4. Te muestro el resultado y las decisiones que tomé
5. Ajustamos y cerramos el módulo

Puedes reordenar, partir o descartar cualquier módulo.
