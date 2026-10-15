// Mock del paquete "ai" para la captura mecánica del perfil ropa.
// Controlable vía globales:
//   globalThis.__ropa_capture               función(args) → push a captures
//   globalThis.__ropa_ai_mode               "capture" (default) | "throw"
//   globalThis.__ropa_ai_result             objeto que devuelve .object (default {})
//   globalThis.__ropa_ai_error_message      texto del error cuando mode="throw"
//
// Solo exporta lo que importa `app/api/analyze-product/route.ts`. Si el
// refactor del route importa algo más de "ai", el import re-escrito explotará
// acá — señal de que hay que actualizar este mock.
export async function generateObject(args) {
  if (typeof globalThis.__ropa_capture === "function") {
    globalThis.__ropa_capture(args)
  }
  const mode = globalThis.__ropa_ai_mode ?? "capture"
  if (mode === "throw") {
    throw new Error(globalThis.__ropa_ai_error_message ?? "simulated generateObject error")
  }
  return { object: globalThis.__ropa_ai_result ?? {} }
}
