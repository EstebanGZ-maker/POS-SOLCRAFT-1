// Mock de `next/server` para la captura mecánica. Solo cubre lo que usa
// `app/api/analyze-product/route.ts`: `NextResponse.json(body, init)`.
// Devuelve un Response plano para que `routeMod.POST()` tenga un retorno
// válido que el script pueda inspeccionar (status + body).
export class NextResponse {
  static json(body, init) {
    const headers = { "content-type": "application/json" }
    if (init && init.headers) Object.assign(headers, init.headers)
    return new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers,
    })
  }
}
