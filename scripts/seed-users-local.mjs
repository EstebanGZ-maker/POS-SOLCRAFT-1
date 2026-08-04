import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { writeFileSync } from "node:fs"

const URL = "http://127.0.0.1:54321"
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

const db = createClient(URL, SERVICE, { auth: { persistSession: false } })

const users = [
  { key: "admin",     email: "qa-admin-preview@example.invalid",     role: "admin",     site_id: null },
  { key: "encargadoA", email: "qa-encargado-a@example.invalid",       role: "encargado", site_id: "11111111-1111-1111-1111-111111111111" },
]

const out = {}
for (const u of users) {
  const password = "pw_" + randomBytes(12).toString("hex")
  const { data, error } = await db.auth.admin.createUser({
    email: u.email,
    password,
    email_confirm: true,
  })
  if (error) { console.error("createUser fail:", u.email, error.message); process.exit(1) }
  const id = data.user.id
  const { error: upErr } = await db
    .from("user_profiles")
    .upsert({ id, email: u.email, role: u.role, site_id: u.site_id, is_active: true }, { onConflict: "id" })
  if (upErr) { console.error("profile fail:", u.email, upErr.message); process.exit(1) }
  out[u.key] = { email: u.email, id, role: u.role, site_id: u.site_id, password }
  console.log("created:", u.email, "role=" + u.role)
}

writeFileSync(process.argv[2] || "./test-creds.json", JSON.stringify(out, null, 2))
console.log("wrote creds file")

// Abre un turno de caja en Sede A vía el nuevo RPC open_shift, autenticado
// como admin. Precondición requerida por e2e/pos-sale.spec.ts.
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const anonClient = createClient(URL, ANON, { auth: { persistSession: false } })
const { error: signInErr } = await anonClient.auth.signInWithPassword({
  email: out.admin.email, password: out.admin.password,
})
if (signInErr) { console.error("admin sign-in fail:", signInErr.message); process.exit(1) }

const { data: shiftId, error: openErr } = await anonClient.rpc("open_shift", {
  p_site_id: "11111111-1111-1111-1111-111111111111",
  p_warehouse_id: "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  p_initial_cash: 100000,
  p_opened_by: "seed",
})
if (openErr && !/Ya hay un turno abierto/.test(openErr.message)) {
  console.error("open_shift fail:", openErr.message); process.exit(1)
}
console.log("open_shift OK", shiftId ?? "(already open)")
