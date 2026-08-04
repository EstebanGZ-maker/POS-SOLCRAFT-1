import { defineConfig, devices } from "@playwright/test"

/**
 * Config de Playwright para POS-SOLCRAFT.
 * Requiere: `pnpm add -D @playwright/test` y `pnpm exec playwright install chromium`.
 *
 * Variables de entorno (ver e2e/README.md):
 *   BASE_URL              (default http://localhost:3000)
 *   E2E_ADMIN_EMAIL       correo de un usuario admin de prueba
 *   E2E_ADMIN_PASSWORD    su contraseña
 */
const BASE_URL = process.env.BASE_URL || "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/helpers/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Levanta el dev server automáticamente si no está corriendo.
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
