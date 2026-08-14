import { expect, type Page } from "@playwright/test"

export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL || "",
  password: process.env.E2E_ADMIN_PASSWORD || "",
}

/**
 * Inicia sesión por la UI de /login y espera la redirección a /dashboard.
 * Selectores tomados de components/login-form.tsx (#email, #password, botón "Ingresar").
 */
export async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
  if (!email || !password) {
    throw new Error(
      "Faltan credenciales de prueba: define E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD (ver e2e/README.md).",
    )
  }
  await page.goto("/login")
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "Ingresar" }).click()
  await page.waitForURL("**/dashboard", { timeout: 20_000 })
  await expect(page).toHaveURL(/\/dashboard/)
}
