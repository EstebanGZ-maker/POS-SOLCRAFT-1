# Runbook — Release triple 2C v2 + COGS + 2D

**Objetivo**: aplicar en una sola ventana coordinada las 3 piezas del método
contable aprobado 2026-08-17 (capitalización + COGS al vender). Ver
[docs/INVENTORY-ADJUSTMENTS-SPEC.md §6.2/§6.4/§6.5](INVENTORY-ADJUSTMENTS-SPEC.md)
y [docs/ESTADO-PENDIENTES.md §0 "GATE CONTADOR RESUELTO"](ESTADO-PENDIENTES.md).

**Release inseparable**:
- `scripts/17c_v2_adjustments_no_expense.sql`
- `scripts/17e_cogs_in_sales.sql`
- Commit TS 2D `034f441` (refactor `createAdjustment`/`receiveMerchandise`/
  `ingressNewProduct` + UI adjustment-dialog con motivo/WAC + validación
  cost>0 en product-form-dialog).

**Rollback**: `scripts/17rollback_2c_v2_and_cogs.sql` (probado en branch
`validate-2c-v2-cogs` 2026-08-17 — restaura las 3 funciones al estado
post-2A+2B sin dropear columnas nuevas).

---

## 0. Prerequisitos

- [ ] Contador dio OK explícito por escrito (email/mensaje). Documentar en
  el commit del release.
- [ ] `git status` limpio en main + al día con origin.
- [ ] Vercel deploy actual READY y estable.
- [ ] `verify_kardex_integrity()` y `verify_credit_integrity()` = 0 filas
  en prod pre-corte.
- [ ] Nadie más está haciendo cambios simultáneos a prod (coordinación
  humana con el equipo).
- [ ] **Smoke test visual local hecho** — ver §5 más abajo. NO se pudo
  hacer desde el sandbox (dev server no arrancó); el usuario debe
  hacerlo localmente antes del corte.

## 1. Ventana de corte — momento sugerido

- **Duración total estimada**: 8-12 min desde el primer `apply_migration`
  hasta smoke test post-deploy completo.
  - SQL apply (17c_v2 → 17e): ~30s.
  - Push del commit TS 2D: ~10s.
  - Vercel build + deploy: 60-90s (baseline actual del proyecto).
  - Smoke test manual en prod: 5-8 min (crear compra, crear venta,
    verificar COGS, anular ambos).

### 1.1 Límite duro del smoke test post-deploy — 10 min → rollback

**Cronómetro arranca cuando Vercel reporta READY y comenzás el §3.1**
(navegar a `/central` → "Recibir mercancía").

Si a los **10 minutos** el smoke test §3 completo no pasó limpio,
**ejecutar rollback §4 de inmediato**. No seguir diagnosticando en prod
en vivo — la ventana de datos operativos comprometidos crece con cada
minuto adicional (cada venta o ajuste creado durante el intervalo
triple-activo persiste `sale_items.unit_cost` y asientos COGS que
después complican el rollback — ver riesgo residual en §4).

**Quién decide el corte**: el usuario (el operador que ejecuta el
runbook). No delegar la decisión "esperemos 5 minutos más" — el límite
es duro.

**Criterio exacto de "no pasó" (cualquiera dispara rollback)**:

1. **Integridad rota**: cualquiera de estas queries en prod devuelve
   ≥ 1 fila post-smoke:
   - `SELECT COUNT(*) FROM verify_kardex_integrity()` > 0
   - `SELECT COUNT(*) FROM verify_credit_integrity()` > 0
   - `SELECT COUNT(*) FROM verify_adjustment_accounting_integrity()` > 0

2. **Error visible en UI** durante los pasos §3.1-§3.3:
   - Toast rojo de error al confirmar compra Central, venta, o
     anulación.
   - Página en blanco o 500.
   - Runtime error en la consola del navegador que corresponde a los
     RPCs (`create_adjustment`, `create_sale`, `void_sale`).

3. **Comportamiento contable inesperado**:
   - Compra desde Central genera asiento inmediato "Compra de
     mercancía" (método NUEVO no debe hacerlo).
   - Venta contado NO genera asiento COGS ni el asiento income.
   - Cantidad del COGS ≠ `quantity × products.cost` al momento de la
     venta.
   - Anular venta y quedar con `SELECT SUM(income) - SUM(expense)
     FROM accounting_entries WHERE sale_id=<id>` ≠ 0.

4. **Runtime logs en Vercel** con ≥ 1 error nuevo en el intervalo
   post-deploy relacionado con los 3 RPCs afectados.

**Si dispara rollback**: correr §4 sin dudar. La reversibilidad es la
red de seguridad. Diagnóstico posterior con calma en el branch de
validación, no en prod. Ver §4 para el procedimiento exacto y la
compensación manual si hubo ventas creadas durante el intervalo.

**Si el smoke pasa limpio antes de 10 min**: continuar con §6
(registro post-corte). No hay premio por ir más rápido.
- **Ventana recomendada**: bajo tráfico. Almacén Taiwy típicamente
  cierra 20:00-08:00 (Colombia UTC-5). Ideal: 21:00-22:00, después de
  cierre POS del día.
- **Riesgo de traer prod**: durante la ventana, la app en Vercel puede
  quedar servida con TS viejo mientras el RPC ya cambió, o al revés,
  por ~90s (build de Vercel). En ese intervalo:
  - Si SQL corrió pero TS viejo: `receiveMerchandise` falla con RAISE
    "Motivo obligatorio con incrementos" (usuario ve error toast).
  - Si TS nuevo pero SQL viejo: `createAdjustment` con motivo falla
    con "function does not exist" (PGRST202).
  - Ambos casos: usuario ve error, sin corrupción de datos. Sin cambio
    persistido irreversible.

## 2. Secuencia exacta del corte

Ejecutar en este orden estricto. NO fasear.

### 2.1 Pre-corte — snapshot y sanity
```
[via MCP] mcp__a16720c7-c1af-4446-8d67-4c23e6fc2b0b__execute_sql \
  --project_id nxszaxwsrtlofqimbfig \
  --query "
    SELECT COUNT(*) AS kardex_diffs FROM verify_kardex_integrity();
    SELECT COUNT(*) AS credit_diffs FROM verify_credit_integrity();
    SELECT COUNT(*) AS adj_open FROM inventory_adjustments WHERE status='active';
    SELECT COUNT(*) AS sales_open FROM sales WHERE status='active';
  "
```
Todos los valores deben ser esperados. Si `kardex_diffs` o
`credit_diffs` > 0, **abortar y diagnosticar** antes de proceder.

### 2.2 Aplicar 17c v2
```
[via MCP] apply_migration --project_id nxszaxwsrtlofqimbfig \
  --name apply_17c_v2_adjustments_no_expense \
  --query <contenido de scripts/17c_v2_adjustments_no_expense.sql sin BEGIN/COMMIT>
```
Verificación inmediata:
```
SELECT pronargs FROM pg_proc WHERE proname='create_adjustment';
-- Esperado: 4
```

### 2.3 Aplicar 17e
```
[via MCP] apply_migration --project_id nxszaxwsrtlofqimbfig \
  --name apply_17e_cogs_in_sales \
  --query <contenido de scripts/17e_cogs_in_sales.sql sin BEGIN/COMMIT>
```
Verificación inmediata:
```
SELECT column_name FROM information_schema.columns
 WHERE table_name='sale_items' AND column_name='unit_cost';
-- Esperado: 1 fila
```

### 2.4 Push del TS a main
```bash
cd C:/POS-SOLCRAFT
git push origin main
```
El commit `034f441` (o su cabeza actual con `git log --oneline -1`) sale
al remote. Vercel detecta el push y comienza build automático.

### 2.5 Esperar Vercel deploy READY
Monitorear en Vercel dashboard. El deploy completa cuando aparece
"READY" y `GET /api/wompi/webhook` responde 200 con
`{configured: false}`. Ventana típica: 60-90s.

## 3. Smoke test post-deploy (en prod)

Todo lo siguiente debe hacerse con un admin real logueado en
`https://pos-solcraft-1.vercel.app`.

### 3.1 Compra desde Central
1. Navegar a `/central` → "Recibir mercancía".
2. Seleccionar bodega Central.
3. Agregar 1 producto real (p.ej. Pantalón jean clásico), qty=1,
   costo=60000 (mismo WAC actual — WAC no debe cambiar).
4. Confirmar. Debe crear ajuste con `motivo='compra'`.
5. **Verificar en Contabilidad** (`/accounting`): NO debe aparecer
   asiento "Compra de mercancía" nuevo (método nuevo capitaliza sin
   asentar).

### 3.2 Venta contado
1. `/pos` → agregar 1 unidad del mismo producto vendido a $80000.
2. Pagar en efectivo. Confirmar venta.
3. **Verificar en Contabilidad**: la venta debe generar DOS asientos
   con el mismo `sale_id`:
   - `+1 income "Ventas POS" amount=80000`
   - `+1 expense "Costo de mercancía vendida" amount=60000`
4. Utilidad bruta reportada: `80000 - 60000 = 20000`.

### 3.3 Anular ambos (limpieza + verificación reversa)
1. `/sales` → anular la venta creada. Debe generar 2 asientos
   compensatorios (`expense "Anulación venta" 80000` +
   `income "Reversión Costo de mercancía vendida" 60000`). Neto
   post-void = 0.
2. `/inventory/adjustments` → anular el ajuste de compra. Sin
   asientos compensatorios (no había asiento original que compensar).
3. Verificar integridad final:
   ```
   SELECT COUNT(*) FROM verify_kardex_integrity();
   SELECT COUNT(*) FROM verify_credit_integrity();
   SELECT COUNT(*) FROM verify_adjustment_accounting_integrity();
   ```
   Los 3 deben devolver 0 filas.

## 4. Rollback — cuándo y cómo

**Trigger** (aplicar rollback si CUALQUIERA de estos):
- SQL apply falla a mitad (17c_v2 aplicado, 17e falla).
- Post-deploy: smoke test §3 reporta comportamiento inesperado
  reproducible (no un flake).
- Producción reporta errores masivos en `create_sale`/`create_adjustment`
  runtime logs (Vercel + Supabase logs).

**Comando**:
```
[via MCP] apply_migration --project_id nxszaxwsrtlofqimbfig \
  --name rollback_2c_v2_and_cogs \
  --query <contenido de scripts/17rollback_2c_v2_and_cogs.sql sin BEGIN/COMMIT>
```

**Después del rollback SQL**, revertir el TS:
```bash
cd C:/POS-SOLCRAFT
git revert 034f441
git push origin main
```
Esto restaura los callers TS al estado pre-triple. Vercel redeploy
automático.

**Riesgo residual documentado**: ventas creadas durante el intervalo
triple-activo persistieron `sale_items.unit_cost` y emitieron asiento
COGS. Al anular esas ventas post-rollback, `void_sale` viejo NO reversa
el COGS → queda expense huérfano. Ver header de
`scripts/17rollback_2c_v2_and_cogs.sql` para el procedimiento manual
de compensación.

## 5. Smoke test visual local — PENDIENTE PARA EL USUARIO

**No se pudo hacer desde el sandbox** — el dev server de Next.js no
arrancó vía `preview_start` (limitación del entorno). El usuario debe
hacerlo antes del corte, en su máquina, para validar los cambios TS
contra el branch de validación.

Pasos:

```bash
cd C:/POS-SOLCRAFT
# Backup del .env.local actual
cp .env.local .env.local.prod-backup-triple

# Override a branch validate-2c-v2-cogs
# (URL + anon key: pedir vía "mcp get_project_url" y "get_publishable_keys"
#  con project_id qqnpdhjxzfiwzbrtywym, o desde Supabase dashboard)
sed -i 's|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=https://qqnpdhjxzfiwzbrtywym.supabase.co|' .env.local
sed -i 's|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key_del_branch>|' .env.local

# Levantar dev server
pnpm dev
```

Login con un admin real (crear uno vía SQL en el branch si no hay:
`INSERT INTO auth.users` + `INSERT INTO user_profiles(role='admin')`).

Casos a verificar visualmente:

**A. adjustment-dialog** (`/inventory/adjustments` → botón "Nuevo ajuste"):
- Selector de motivo visible con opciones Compra/Sobrante/Corrección.
- Agregar 1 producto con objective="incrementar" → motivo obligatorio
  (mensaje si intentas guardar sin motivo).
- Cambiar todos los items a objective="disminuir" → selector de motivo
  deshabilitado con placeholder "No aplica (100% merma)".
- Seleccionar motivo=Corrección + notes vacío → guardar debe rechazar
  con "Justificación requerida".
- Cada fila muestra "WAC actual: $X" bajo el input de costo, con el
  valor de `products.cost` del producto (referencia, no autocompleta).

**B. product-form-dialog** (`/inventory/products` → "Nuevo producto"):
- Producto NUEVO físico (is_service=OFF) + cost=0 → botón "Guardar"
  deshabilitado + mensaje "Requerido > 0 para productos físicos" bajo
  el input.
- Producto NUEVO servicio (is_service=ON) + cost=0 → botón habilitado
  (servicios exentos).
- EDITAR producto físico existente + bajar cost a 0 → botón habilitado
  (edición sin validación).

**C. receiveMerchandise end-to-end** (`/central` → "Recibir mercancía"):
- Recibir 1 producto real, qty=1, costo>0.
- Debe crear ajuste con motivo='compra' visible en detalle
  `/inventory/adjustments/<id>`.
- SIN asiento nuevo en `/accounting` (método nuevo capitaliza sin
  asentar).
- `products.cost` recalculado según fórmula WAC.

**Restaurar env después**:
```bash
mv .env.local.prod-backup-triple .env.local
```

---

## 6. Registro post-corte

Después del §3 exitoso, actualizar:

- **Commit final del release** en main: mensaje debe documentar:
  - Fecha del OK del contador (2026-08-17).
  - Que 17c_v2, 17e y TS 2D se aplicaron juntos.
  - Confirmación de smoke test §3 completo con neto=0.
- **`docs/ESTADO-PENDIENTES.md`**: marcar el bloque §0 "CERRADO Y
  DEPLOYED — Release triple 2C v2 + COGS + 2D" (mover de "gate
  resuelto" a "cerrado y deployed"). Actualizar §1.3 y §3.
- **Cerrar branch `validate-2c-v2-cogs`** (`qqnpdhjxzfiwzbrtywym`)
  con `mcp__a16720c7-c1af-4446-8d67-4c23e6fc2b0b__delete_branch`
  — ya cumplió su propósito, ~$0.32/día si se olvida.
