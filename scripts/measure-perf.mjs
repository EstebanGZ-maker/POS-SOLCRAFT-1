// scripts/measure-perf.mjs
//
// Mide LCP + tiempo total de cada ruta del POS contra el servidor de desarrollo
// (Next.js en localhost:3000), con caché fría y autenticación Supabase.
//
// Uso:
//   node scripts/measure-perf.mjs                 -> mide TODAS las rutas
//   node scripts/measure-perf.mjs --route /pos    -> mide UNA sola ruta
//   node scripts/measure-perf.mjs --json          -> imprime solo JSON (sin tabla)
//
// Requisitos:
//   npm i -D playwright && npx playwright install chromium
//   pnpm dev   (la app debe estar corriendo en localhost:3000)
//
// Salida:
//   - Escribe perf-results.json (resumen compacto que Claude lee en el loop)
//   - process.exit(1) si alguna ruta supera el presupuesto

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS || 1000);
const LOGIN_PATH = '/login';

// Solo existe un usuario (sin roles implementados aún).
// Cuando se implementen roles, agregar usuarios por rol aquí.
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const USERS = {
  admin: { email: 'admin@solcraft.dev', password: PASSWORD },
};

// Rutas reales del App Router de Next.js.
// `role` = con qué usuario se autentica (todas usan admin por ahora).
// `central` = requiere tener seleccionada la Bodega Central como sede.
// `site` = requiere tener seleccionada una sede de venta (no central).
const ROUTES = [
  { path: '/login',                  role: null,    label: 'Login' },
  { path: '/dashboard',              role: 'admin', label: 'Dashboard (KPIs + gráficas)' },
  { path: '/admin',                  role: 'admin', label: 'Administración de sedes' },
  { path: '/pos',                    role: 'admin', label: 'Punto de venta', site: true },
  { path: '/inventory/products',     role: 'admin', label: 'Productos y servicios' },
  { path: '/inventory/barcodes',     role: 'admin', label: 'Códigos de barras' },
  { path: '/inventory/value',        role: 'admin', label: 'Valor de inventario' },
  { path: '/inventory/adjustments',  role: 'admin', label: 'Ajustes de inventario' },
  { path: '/inventory/warehouses',   role: 'admin', label: 'Bodegas' },
  { path: '/inventory/price-lists',  role: 'admin', label: 'Listas de precios' },
  { path: '/inventory/promotions',   role: 'admin', label: 'Promociones' },
  { path: '/inventory/management',   role: 'admin', label: 'Gestión de inventario' },
  { path: '/central',               role: 'admin', label: 'Bodega central (entradas + envíos)', central: true, heavy: true },
  { path: '/central/transfers',     role: 'admin', label: 'Historial de traslados', central: true },
  { path: '/accounting',            role: 'admin', label: 'Contabilidad (movimientos + reportes)', site: true, heavy: true },
  { path: '/sales',                 role: 'admin', label: 'Historial de ventas', site: true },
  { path: '/customers',             role: 'admin', label: 'Clientes' },
];

// ─────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const onlyRoute = args.includes('--route') ? args[args.indexOf('--route') + 1] : null;
const jsonOnly = args.includes('--json');
const targets = onlyRoute ? ROUTES.filter(r => r.path === onlyRoute) : ROUTES;
if (onlyRoute && targets.length === 0) {
  console.error(`Ruta desconocida: ${onlyRoute}`);
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function login(context, role) {
  const user = USERS[role];
  const page = await context.newPage();
  await page.goto(BASE + LOGIN_PATH, { waitUntil: 'networkidle' });

  // Selectores del LoginForm de POS-SOLCRAFT (components/login-form.tsx)
  await page.fill('input#email', user.email);
  await page.fill('input#password', user.password);
  await page.click('button[type="submit"]');

  // Esperar a que redirija al dashboard (indica login exitoso)
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  await page.waitForLoadState('networkidle');
  await page.close();
}

async function measure(context, route) {
  const page = await context.newPage();
  const start = Date.now();
  await page.goto(BASE + route.path, { waitUntil: 'networkidle' });

  const lcp = await page.evaluate(() => new Promise(resolve => {
    let last = 0;
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) last = e.startTime;
    });
    obs.observe({ type: 'largest-contentful-paint', buffered: true });
    setTimeout(() => { obs.disconnect(); resolve(last || performance.now()); }, 4000);
  }));

  const total = Date.now() - start;
  await page.close();
  return { lcp: Math.round(lcp), total };
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const results = [];

// Agrupa rutas por rol para loguear una sola vez
const byRole = new Map();
for (const r of targets) {
  const key = r.role || '__public__';
  if (!byRole.has(key)) byRole.set(key, []);
  byRole.get(key).push(r);
}

for (const [role, routes] of byRole) {
  const context = await browser.newContext();
  if (role !== '__public__') {
    try { await login(context, role); }
    catch (e) { console.error(`Login falló para rol ${role}: ${e.message}`); }
  }
  for (const route of routes) {
    const m = await measure(context, route);
    results.push({
      path: route.path,
      label: route.label,
      heavy: !!route.heavy,
      lcp: m.lcp,
      total: m.total,
      pass: m.lcp < BUDGET_MS,
    });
  }
  await context.close();
}

await browser.close();

// ─────────────────────────────────────────────────────────────
// Salida compacta
// ─────────────────────────────────────────────────────────────
const fails = results.filter(r => !r.pass).sort((a, b) => b.lcp - a.lcp);
const summary = {
  budget_ms: BUDGET_MS,
  passed: results.length - fails.length,
  total: results.length,
  slowest: fails[0] ? { path: fails[0].path, lcp: fails[0].lcp } : null,
  fails: fails.map(f => ({ path: f.path, lcp: f.lcp })),
};

writeFileSync('perf-results.json', JSON.stringify(summary, null, 0));

if (jsonOnly) {
  console.log(JSON.stringify(summary));
} else {
  console.table(results.map(r => ({
    ruta: r.path, lcp: r.lcp + 'ms', total: r.total + 'ms', ok: r.pass ? '✓' : '✗',
  })));
  console.log(`\n${summary.passed}/${summary.total} dentro de ${BUDGET_MS}ms.`);
  if (fails.length) {
    console.log(`Más lenta: ${summary.slowest.path} (${summary.slowest.lcp}ms)`);
    console.log(`Fallan: ${fails.map(f => `${f.path}:${f.lcp}ms`).join(', ')}`);
  }
}

process.exit(fails.length ? 1 : 0);
