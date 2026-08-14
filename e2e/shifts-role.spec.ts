import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * S1-paso1 — verifica que open_shift / add_cash_movement / close_shift
 * ahora son SECURITY DEFINER con role/site check DENTRO de la función SQL.
 *
 * No pasa por la UI: llama las RPCs directamente con clientes Supabase
 * autenticados con sesiones distintas (admin vs encargado de Sede A) para
 * probar el path exacto que estamos endureciendo.
 */

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD
const ENC_EMAIL = process.env.E2E_ENCARGADO_EMAIL
const ENC_PW = process.env.E2E_ENCARGADO_PASSWORD
const SITE_A = process.env.E2E_SITE_A
const SITE_B = process.env.E2E_SITE_B
const WH_A = process.env.E2E_WH_A

for (const [k, v] of Object.entries({ URL, ANON, SERVICE, ADMIN_EMAIL, ADMIN_PW, ENC_EMAIL, ENC_PW, SITE_A, SITE_B, WH_A })) {
  if (!v) throw new Error(`shifts-role.spec: falta env ${k}`)
}

const admin = createClient(URL!, ANON!, { auth: { persistSession: false } })
const encargado = createClient(URL!, ANON!, { auth: { persistSession: false } })
const svc = createClient(URL!, SERVICE!, { auth: { persistSession: false } })

test.beforeAll(async () => {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    admin.auth.signInWithPassword({ email: ADMIN_EMAIL!, password: ADMIN_PW! }),
    encargado.auth.signInWithPassword({ email: ENC_EMAIL!, password: ENC_PW! }),
  ])
  expect(e1, `admin sign-in: ${e1?.message}`).toBeNull()
  expect(e2, `encargado sign-in: ${e2?.message}`).toBeNull()
})

test.afterEach(async () => {
  // Cerrar cualquier turno abierto entre tests para no romper la restricción
  // "one_open_shift_per_site". Usamos service_role para bypasear todo.
  await svc.from("pos_shifts").update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("status", "open")
})

test("Test A — admin abre turno en Sede A, registra ingreso, cierra turno", async () => {
  const { data: shiftId, error: openErr } = await admin.rpc("open_shift", {
    p_site_id: SITE_A, p_warehouse_id: WH_A, p_initial_cash: 100000,
  })
  expect(openErr, `open_shift admin: ${openErr?.message}`).toBeNull()
  expect(shiftId).toBeTruthy()

  const { error: mvErr } = await admin.rpc("add_cash_movement", {
    p_shift_id: shiftId, p_type: "income", p_amount: 25000, p_description: "test A ingreso",
  })
  expect(mvErr, `add_cash_movement admin: ${mvErr?.message}`).toBeNull()

  const { data: closeRes, error: closeErr } = await admin.rpc("close_shift", {
    p_shift_id: shiftId, p_counted_cash: 125000,
  })
  expect(closeErr, `close_shift admin: ${closeErr?.message}`).toBeNull()
  expect(closeRes).toMatchObject({
    expected_cash: 125000, counted_cash: 125000, difference: 0,
  })
})

test("Test B — encargado de Sede A NO puede abrir turno en Sede B", async () => {
  const { error } = await encargado.rpc("open_shift", {
    p_site_id: SITE_B, p_warehouse_id: WH_A, p_initial_cash: 50000,
  })
  expect(error, "esperaba fallo cross-site").not.toBeNull()
  expect(error!.message, "mensaje debe indicar restricción de sede").toMatch(/tu sede/i)
})

test("Test C — encargado de Sede A NO puede registrar movimiento en turno de Sede B", async () => {
  // admin abre turno en Sede B (con warehouse de A, ok — solo importa site_id)
  const { data: shiftBId, error: bOpenErr } = await admin.rpc("open_shift", {
    p_site_id: SITE_B, p_warehouse_id: WH_A, p_initial_cash: 10000,
  })
  expect(bOpenErr).toBeNull()

  // encargado A intenta añadir cash_movement al turno de B
  const { error } = await encargado.rpc("add_cash_movement", {
    p_shift_id: shiftBId, p_type: "expense", p_amount: 5000,
  })
  expect(error, "esperaba fallo cross-site").not.toBeNull()
  expect(error!.message, "mensaje debe indicar restricción de sede").toMatch(/tu sede/i)
})
