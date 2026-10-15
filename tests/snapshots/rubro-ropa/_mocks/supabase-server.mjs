// Mock de `@/lib/supabase/server` para el modo post-refactor.
//
// Pre-emptivo: el route de main @ 1aff84b NO lo importa. Lo dejamos
// listo para que, tras el refactor, `createServerSupabaseClient()`
// devuelva un stub determinista que el script controle vía globales:
//
//   globalThis.__ROPA_FIXTURE_RUBRO               -> 'ropa' por default
//                                                    null simula fila vacía
//   globalThis.__ROPA_FIXTURE_SUPABASE_ERROR      -> true devuelve error
//
// La cadena de llamadas `.from().select()...` se absorbe con un Proxy;
// los métodos terminales (`maybeSingle` / `single`) resuelven con la
// forma `{ data, error }` que usa supabase-js.

function makeTerminal() {
  const rubro = globalThis.__ROPA_FIXTURE_RUBRO ?? "ropa"
  const simulatedError = globalThis.__ROPA_FIXTURE_SUPABASE_ERROR === true
  return async () => {
    if (simulatedError) {
      return { data: null, error: { message: "simulated supabase failure" } }
    }
    if (rubro === null) {
      return { data: null, error: null }
    }
    return { data: { rubro }, error: null }
  }
}

export async function createServerSupabaseClient() {
  const terminal = makeTerminal()
  const builder = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "maybeSingle" || prop === "single") return terminal
        if (prop === "then") return undefined // not a thenable
        return () => builder
      },
    },
  )
  return {
    from: () => builder,
  }
}

// Export también `createServiceRoleSupabaseClient` por si el refactor
// decide usarla; mismo comportamiento.
export const createServiceRoleSupabaseClient = createServerSupabaseClient
