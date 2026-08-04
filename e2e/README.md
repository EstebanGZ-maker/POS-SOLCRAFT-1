# Tests E2E y de invariantes — POS-SOLCRAFT

Dos capas de prueba:

1. **Playwright (UI)** — `e2e/*.spec.ts`: login, humo de rutas del núcleo y el flujo de venta.
2. **Invariantes DB** — `scripts/smoke-core.mjs`: kardex cuadrado y bloqueo de sobreventa, no destructivo. Corre contra la DB real en segundos.

## Instalación (una vez)

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

## Variables de entorno

Crea `.env.test` (o expórtalas en tu shell):

```bash
BASE_URL=http://localhost:3000
E2E_ADMIN_EMAIL=admin@tu-dominio.dev      # un usuario admin de prueba
E2E_ADMIN_PASSWORD=********

# Para el smoke de invariantes DB:
SUPABASE_URL=https://nxszaxwsrtlofqimbfig.supabase.co
SUPABASE_SERVICE_ROLE_KEY=********        # NUNCA subir a git
```

> Recomendado: crea un admin dedicado a QA en vez de usar uno real.
> Puedes reutilizar el usuario `qa.multisede@solcraft.dev` mencionado en `PLAN-PENDIENTES.md`.

## Correr

```bash
# UI (levanta pnpm dev solo si no está corriendo)
pnpm exec playwright test                 # todos
pnpm exec playwright test auth            # solo login
pnpm exec playwright test routes-smoke    # humo de rutas
pnpm exec playwright test --ui            # modo interactivo (para afinar selectores)

# Invariantes DB (no destructivo)
node scripts/smoke-core.mjs
```

## Estado de los specs

| Spec | Estado | Nota |
|---|---|---|
| `auth.spec.ts` | listo | login ok / login inválido / ruta protegida |
| `routes-smoke.spec.ts` | listo | 9 rutas del núcleo cargan sin error para admin |
| `pos-sale.spec.ts` | `skip` | esqueleto; completa el selector del diálogo de pago tras un run `--ui` y quita el `skip` |
| `scripts/smoke-core.mjs` | listo | kardex + sobreventa |

## Próximo

Cuando `pos-sale` esté verde y `smoke-core` pase, se aplica la migración **S1**
(RLS de escritura en tablas de dinero/inventario) con su rollback, y se re-corre
la suite como red de seguridad.
