import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { AUTH_STATE_PATH } from "./helpers/global-setup"

/**
 * Venta por el POS (Módulo A) — end-to-end.
 *
 * Flujo:
 *  1. Snapshot: verify_kardex_integrity() debe estar en 0 antes de arrancar.
 *  2. UI: /pos → agregar primer producto con stock → Vender → Efectivo → Continuar.
 *  3. Registra el sale_id que quedó en `sales` (ordenado desc por created_at).
 *  4. Anula vía RPC `void_sale(p_sale_id, p_user_id)` con service_role.
 *  5. Verifica que verify_kardex_integrity() vuelva a 0.
 *
 * Precondición:
 *   Turno de caja ABIERTO en la sede activa del admin. Si no lo hay, el botón
 *   "Vender" queda deshabilitado y el test se skipea con un mensaje que dice
 *   cómo abrirlo manualmente: /pos → "Abrir caja" → base inicial → "Abrir".
 *
 * Garantías de invariantes (venta atómica, kardex, sobreventa) ya están
 * cubiertas de forma reproducible por scripts/smoke-core.mjs.
 */

test.use({ storageState: AUTH_STATE_PATH })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error("pos-sale.spec: faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY")
}
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

test("venta por POS descuenta stock, se anula y kardex queda en 0", async ({ page }) => {
  // ─── 1) kardex limpio antes ──────────────────────────────────────────────
  {
    const { data, error } = await db.rpc("verify_kardex_integrity")
    expect(error, "verify_kardex_integrity (pre) error").toBeNull()
    expect(data ?? [], "kardex con descuadres antes de arrancar").toHaveLength(0)
  }

  // ─── 2) UI ───────────────────────────────────────────────────────────────
  // Pre-lookup en DB: una sede no-central, con producto físico (no servicio)
  // con stock > 0, Y turno de caja abierto.
  const { data: openShifts } = await db.from("pos_shifts").select("site_id").eq("status", "open")
  const openShiftSiteIds = new Set((openShifts ?? []).map((r: any) => r.site_id))
  expect(openShiftSiteIds.size, "no hay ningún turno abierto en ninguna sede").toBeGreaterThan(0)

  const { data: stockRows } = await db
    .from("product_stock")
    .select(
      "quantity, warehouse:warehouses!inner(is_system, sites!inner(site_id, name, is_central)), products!inner(is_service)",
    )
    .gt("quantity", 0)
    .limit(500)
  const candidate = (stockRows as any[] | null)?.find(
    (r) =>
      r.warehouse?.is_system === false &&
      r.warehouse?.sites?.is_central === false &&
      r.products?.is_service === false &&
      openShiftSiteIds.has(r.warehouse.sites.site_id),
  )
  expect(
    candidate,
    "no hay ninguna sede con (stock físico > 0) Y (turno abierto). Abre un turno en alguna sede con inventario.",
  ).toBeTruthy()
  const targetSiteName = candidate!.warehouse.sites.name as string

  await page.goto("/pos")

  // Cambiar a la sede con stock si aún no lo estamos.
  const sedeCombo = page.getByRole("combobox").first()
  await expect(sedeCombo).toBeVisible()
  const currentSite = (await sedeCombo.innerText()).trim()
  if (!currentSite.includes(targetSiteName)) {
    await sedeCombo.click()
    await page.getByRole("option", { name: targetSiteName }).click()
  }

  // Esperar a que el UI refleje el turno abierto en la sede activa. El texto
  // "Turno abierto" aparece cuando el hook interno de shift terminó de cargar.
  // Sin esta espera, startSale() puede ver `shift` en null (race con SWR) y
  // abrir el OpenShiftDialog aunque en DB haya turno abierto.
  await expect(page.getByText(/Turno abierto/i), `no hay turno abierto en "${targetSiteName}"`).toBeVisible({
    timeout: 15_000,
  })

  // Buscar cualquier producto. La tarjeta es <button> y su texto arranca por el
  // código (p.ej. "PA-32-120-00"). Se filtra por producto no deshabilitado
  // (los sin stock traen disabled=true y texto "Agotado").
  await expect(page.getByPlaceholder("Buscar productos")).toBeVisible()
  const firstProduct = page
    .locator("main button:not([disabled])")
    .filter({ hasText: /^[A-Z]{2}-/ })
    .filter({ hasNotText: /Agotado/i })
    .first()
  await expect(firstProduct, `no hay producto con stock en la grid de "${targetSiteName}"`).toBeVisible({
    timeout: 10_000,
  })
  await firstProduct.click()

  // Esperar a que el botón Vender muestre un total NO cero. Es aserción
  // directa sobre el mismo botón que vamos a clickear: si vender.$0, no
  // proseguir. Cubre el caso flake en que el click en el producto no
  // registró y el cart quedó vacío.
  const vender = page.getByRole("button", { name: /^Vender \$[1-9]/i })
  await expect(vender, "el click en el producto no populó el carrito").toBeVisible({ timeout: 10_000 })
  await expect(vender).toBeEnabled()

  // Snapshot pre-venta
  const before = await db
    .from("sales")
    .select("sale_id, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
  const beforeSaleId = before.data?.[0]?.sale_id ?? null

  await vender.click()

  // Paso 1 del PaymentDialog: elegir Efectivo (MethodCard con texto "Efectivo")
  await page.getByRole("button", { name: "Efectivo" }).click()

  // Paso 2: llenar valor del pago = total. Scopeamos al dialog para no
  // capturar otros text-3xl del layout (ej. "Ventas hoy: $95.000" del header).
  const totalStr = await page.locator('[role="dialog"] p.text-3xl.font-bold').first().innerText()
  const total = Number(totalStr.replace(/[^\d]/g, "")) || 0
  expect(total, "el total del carrito no debería ser 0").toBeGreaterThan(0)
  await page.locator('[role="dialog"] input[type="number"][placeholder="0"]').fill(String(total))

  // Continuar → confirmPayment → create_sale
  await page.getByRole("button", { name: /^continuar$/i }).click()

  // Toast de éxito. `getByText` matchea el título del toast + el aria-live del
  // sr-only, así que uso el título directo con exact match.
  await expect(page.getByText("Venta realizada", { exact: true })).toBeVisible({ timeout: 20_000 })

  // ─── 3) recuperar la venta nueva ─────────────────────────────────────────
  const after = await db
    .from("sales")
    .select("sale_id, status, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
  const newSaleId = after.data?.[0]?.sale_id
  expect(newSaleId, "no se creó nueva venta en `sales`").toBeTruthy()
  expect(newSaleId).not.toBe(beforeSaleId)
  expect(after.data?.[0]?.status).toBe("active")

  // ─── 4) anular ───────────────────────────────────────────────────────────
  const { error: voidErr } = await db.rpc("void_sale", { p_sale_id: newSaleId })
  expect(voidErr, `void_sale error: ${voidErr?.message}`).toBeNull()

  // Confirmar que la venta quedó marcada como voided
  const voided = await db.from("sales").select("status").eq("sale_id", newSaleId).single()
  expect(voided.data?.status).toBe("voided")

  // ─── 5) kardex vuelve a 0 ────────────────────────────────────────────────
  const { data: post, error: postErr } = await db.rpc("verify_kardex_integrity")
  expect(postErr, "verify_kardex_integrity (post) error").toBeNull()
  expect(post ?? [], "kardex con descuadres tras anular la venta").toHaveLength(0)
})
