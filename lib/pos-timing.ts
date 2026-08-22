// Helper temporal para diagnóstico de cold-start de /pos.
// Loggea el tiempo total de cada server action del bootstrap POS a
// Vercel Runtime Logs con prefijo [pos-timing] — filtrable en
// Observability. Remover cuando se decida la mitigación definitiva.
export async function withPosTiming<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    console.log(`[pos-timing] ${name} ${Math.round(performance.now() - t0)}ms`)
  }
}
