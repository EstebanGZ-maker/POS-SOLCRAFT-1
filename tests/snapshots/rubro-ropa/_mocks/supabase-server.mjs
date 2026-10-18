// Mock de `@/lib/supabase/server` controlable por globales:
//
//   globalThis.__ROPA_FIXTURE_RUBRO               -> 'ropa' por default
//                                                    null simula fila vacía / sin sesión
//   globalThis.__ROPA_FIXTURE_SUPABASE_ERROR      -> true devuelve error
//   globalThis.__ROPA_FIXTURE_CATEGORIES          -> array de categorías para
//                                                    `.from('categories').select('name')`
//   globalThis.__ROPA_FIXTURE_AUTH_USER           -> { id } por default admin
//                                                    null simula sin sesión
//   globalThis.__ROPA_FIXTURE_ROLE                -> 'admin' por default
//   globalThis.__ROPA_FIXTURE_IS_ACTIVE           -> true por default
//
// Soporta dos patrones de la cadena de supabase-js:
//   (a) termina con `.maybeSingle()` o `.single()` → objeto `{data, error}`.
//   (b) termina sin método terminal, se awaitea directo (p.ej.
//       `.select('name').order('name')` → array thenable).
// Ambas producen `{data, error}`. El shape del `data` depende de la tabla:
//   business_settings → fila `{rubro}` (o null)
//   categories        → array `[{name}]`
//   user_profiles     → fila `{role, is_active}` (o null)

function terminalForTable(table) {
  const err = globalThis.__ROPA_FIXTURE_SUPABASE_ERROR === true
  if (err) return { data: null, error: { message: "simulated supabase failure" } }

  if (table === "categories") {
    const cats = globalThis.__ROPA_FIXTURE_CATEGORIES ?? []
    return { data: cats.map((n) => ({ name: n })), error: null }
  }
  if (table === "user_profiles") {
    const rawRole = globalThis.__ROPA_FIXTURE_ROLE
    const role = rawRole === undefined ? "admin" : rawRole
    const rawActive = globalThis.__ROPA_FIXTURE_IS_ACTIVE
    const is_active = rawActive === undefined ? true : rawActive
    if (role === null) return { data: null, error: null }
    return { data: { role, is_active }, error: null }
  }
  // Default: business_settings. `??` NO sirve para diferenciar undefined
  // de null, por eso usamos `=== undefined` explícito. `null` significa
  // "no row" (RLS bloqueado / fila ausente / sin sesión), es un caso de
  // prueba distinto del default.
  const raw = globalThis.__ROPA_FIXTURE_RUBRO
  const rubro = raw === undefined ? "ropa" : raw
  if (rubro === null) return { data: null, error: null }
  return { data: { rubro }, error: null }
}

function makeBuilder(table) {
  // El builder es thenable: `await builder` resuelve con `terminalForTable(table)`.
  // Los métodos no-terminales devuelven el builder (chain). Los métodos
  // terminales `maybeSingle` / `single` devuelven una Promise con el
  // mismo shape (para single, extrae .data si es array).
  const builder = {}
  const target = {}
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop === "maybeSingle") {
        return async () => {
          const r = terminalForTable(table)
          if (table === "categories") {
            const data = Array.isArray(r.data) && r.data.length > 0 ? r.data[0] : null
            return { data, error: r.error }
          }
          return r
        }
      }
      if (prop === "single") {
        return async () => {
          const r = terminalForTable(table)
          if (r.error) return r
          if (table === "categories") {
            const data = Array.isArray(r.data) && r.data.length > 0 ? r.data[0] : null
            if (!data) return { data: null, error: { message: "no rows" } }
            return { data, error: null }
          }
          if (!r.data) return { data: null, error: { message: "no rows" } }
          return r
        }
      }
      if (prop === "then") {
        // Thenable: resuelve con el resultado terminal de la tabla.
        return (resolve, reject) => {
          try {
            resolve(terminalForTable(table))
          } catch (e) {
            if (reject) reject(e)
          }
        }
      }
      if (prop === "catch" || prop === "finally") return undefined
      // Default: método chainable, devuelve el mismo proxy.
      return () => proxy
    },
  })
  return proxy
}

function authGetUser() {
  const rawAuthErr = globalThis.__ROPA_FIXTURE_AUTH_ERROR
  if (rawAuthErr === true) {
    return { data: { user: null }, error: { message: "simulated auth failure" } }
  }
  const raw = globalThis.__ROPA_FIXTURE_AUTH_USER
  const user = raw === undefined ? { id: "fixture-user-admin" } : raw
  return { data: { user }, error: null }
}

export async function createServerSupabaseClient() {
  return {
    from: (table) => makeBuilder(table),
    auth: {
      getUser: async () => authGetUser(),
    },
  }
}

export const createServiceRoleSupabaseClient = createServerSupabaseClient
