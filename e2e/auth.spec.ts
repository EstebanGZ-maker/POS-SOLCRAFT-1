import { test, expect } from "@playwright/test"
import { login, ADMIN } from "./helpers/auth"

test.describe("Autenticación", () => {
  test("login con credenciales válidas redirige al dashboard", async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test("login con credenciales inválidas muestra error y no redirige", async ({ page }) => {
    await page.goto("/login")
    await page.locator("#email").fill(ADMIN.email || "noexiste@solcraft.dev")
    await page.locator("#password").fill("contraseña-incorrecta-123")
    await page.getByRole("button", { name: "Ingresar" }).click()
    // Debe seguir en /login y mostrar el alert de error.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/incorrect|inválid|no ha sido confirmada|Invalid/i)).toBeVisible()
  })

  test("ruta protegida sin sesión redirige a /login", async ({ page }) => {
    await page.context().clearCookies()
    await page.goto("/pos")
    await expect(page).toHaveURL(/\/login/)
  })
})
