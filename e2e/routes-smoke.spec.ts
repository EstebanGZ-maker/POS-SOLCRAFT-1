import { test, expect } from "@playwright/test"
import { AUTH_STATE_PATH } from "./helpers/global-setup"

test.use({ storageState: AUTH_STATE_PATH })

/**
 * Humo de rutas: un admin autenticado debe poder abrir cada módulo del núcleo
 * sin error de aplicación ni redirección a /login.
 */
const CORE_ROUTES = [
  "/dashboard",
  "/pos",
  "/sales",
  "/inventory/products",
  "/inventory/kardex",
  "/central",
  "/transfers/receive",
  "/accounting",
  "/users",
]

test.describe("Humo de rutas (admin)", () => {
  for (const route of CORE_ROUTES) {
    test(`carga ${route} sin error`, async ({ page }) => {
      const resp = await page.goto(route)
      // No debe rebotar a login
      await expect(page).not.toHaveURL(/\/login/)
      // Respuesta HTTP sana
      expect(resp?.status(), `status de ${route}`).toBeLessThan(400)
      // Sin overlay de error de Next / crash de React
      await expect(page.getByText(/Application error|Unhandled Runtime Error|500/i)).toHaveCount(0)
      // Algo se renderizó
      await expect(page.locator("body")).not.toBeEmpty()
    })
  }
})
