import { chromium, type FullConfig } from "@playwright/test"
import { login } from "./auth"
import path from "node:path"

/**
 * Un login por corrida completa: guarda cookies/localStorage en
 * auth-state.json. Los specs lo consumen con test.use({ storageState }).
 * Evita que cada test re-visite /login (lento y frágil ante Fast Refresh
 * de Next dev).
 */
export const AUTH_STATE_PATH = path.resolve(__dirname, "..", ".auth-state.json")

export default async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.BASE_URL || "http://localhost:3000"
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await login(page)
  await context.storageState({ path: AUTH_STATE_PATH })
  await browser.close()
}
