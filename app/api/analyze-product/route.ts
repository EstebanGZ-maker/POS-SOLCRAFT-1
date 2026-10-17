import { generateObject } from "ai"
// import { google } from "@ai-sdk/google"  // ver bloque comentado abajo — vía inactiva
import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getRubroProfile } from "@/lib/rubro-profiles"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const { dataUrl, mediaType, hint } = await req.json()

    if (!dataUrl || typeof dataUrl !== "string") {
      return NextResponse.json({ error: "No se recibió el archivo." }, { status: 400 })
    }

    const isVideo = (mediaType || "").startsWith("video")

    // Gemini solo acepta image/{jpeg,png,webp,heic,heif}. Si el browser mandó
    // application/octet-stream (cámara Android vía intent, archivos sin
    // extensión) o cualquier otro tipo raro, normalizamos a image/jpeg — el
    // panel IA solo sube imágenes, así que es seguro.
    const GEMINI_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
    const rawType = (mediaType || "").toLowerCase()
    const normalizedMediaType = isVideo || GEMINI_IMAGE_TYPES.has(rawType) ? mediaType || "image/jpeg" : "image/jpeg"

    // Lectura del rubro con la sesión del usuario ANTES de llamar al modelo.
    // Si falla (sin sesión, rubro vacío, rubro inválido) la ruta cierra con
    // error visible y no consume créditos del AI Gateway. Nunca cae a 'ropa'
    // por default — el guard explícito 401 va en commit aparte (ver
    // ESTADO-PENDIENTES §0 "/api/analyze-product sin autenticación").
    const supabase = await createServerSupabaseClient()
    const { data: cfg, error: cfgError } = await supabase
      .from("business_settings")
      .select("rubro")
      .eq("id", 1)
      .maybeSingle()
    if (cfgError) {
      return NextResponse.json(
        { error: "No se pudo leer la configuración del negocio.", code: "rubro_read_error" },
        { status: 503 },
      )
    }
    const rubro = cfg?.rubro
    if (!rubro || typeof rubro !== "string") {
      return NextResponse.json(
        { error: "La sesión no está autorizada o la configuración del negocio no está disponible.", code: "rubro_missing" },
        { status: 401 },
      )
    }
    let profile
    try {
      profile = getRubroProfile(rubro)
    } catch {
      return NextResponse.json(
        { error: `Rubro inválido configurado para este negocio: "${rubro}".`, code: "rubro_invalid" },
        { status: 500 },
      )
    }

    // Para rubros que lo requieren (tecnología) cargamos la lista de
    // categorías del tenant y la inyectamos al prompt. Comparación
    // case-insensitive la hace el modelo según la regla del prompt; nosotros
    // solo le damos la whitelist.
    let categoriesList: string[] | undefined
    if (profile.needsCategoriesList) {
      const { data: cats } = await supabase.from("categories").select("name").order("name")
      categoriesList = (cats || []).map((c: any) => String(c.name))
    }

    const medium: "imagen" | "video" = isVideo ? "video" : "imagen"
    const userText = (hint ? `Contexto del usuario: ${hint}. ` : "") + profile.messageTemplate(medium)

    // 2026-09-08: **camino activo = AI Gateway de Vercel con créditos pagos**.
    // Se intentó migrar a la API nativa de Google (@ai-sdk/google) para usar
    // la capa gratuita permanente, pero el free tier real medido en AI Studio
    // para proyectos nuevos resultó ser 5 RPM / 20 RPD por proyecto Cloud —
    // insuficiente para uso real de negocio. Volvemos al Gateway; la ruta
    // directa a Google queda como fallback comentado abajo por si en el
    // futuro Google flexibiliza el free tier o queremos evaluarla otra vez.
    //
    // maxRetries: 0 — la Vercel AI SDK NO respeta el retry-after de los
    // providers (issue vercel/ai#7247): al chocar contra rate-limit dispara
    // reintentos con su propio backoff corto (~2s, 4s) ignorando la sugerencia
    // del servidor. Con maxRetries:2 cada request user-visible se convertía
    // en hasta 3 llamadas reales — amplificación silenciosa que agotaba la
    // cuota más rápido. Con 0 reintentos, un 429 aparece como error en la
    // card y el usuario aprieta "Re-analizar" (que pasa por la cola con
    // AI_MIN_INTERVAL_MS del panel). Sin retries agresivos automáticos.
    //
    // --- Ruta inactiva: Google directo (dejar comentada, es trabajo real) ---
    // import { google } from "@ai-sdk/google"  (línea al tope del archivo)
    // + env var GOOGLE_GENERATIVE_AI_API_KEY por instancia en Vercel
    // + reemplazar la línea `model:` de abajo por: model: google("gemini-3.6-flash"),
    // Para volver: descomentar el import + swap del modelo. El resto queda igual.
    const { object } = await generateObject({
      model: profile.model,
      maxRetries: profile.maxRetries,
      schema: profile.schema,
      instructions: profile.buildInstructions({ categories: categoriesList }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userText,
            },
            {
              type: "file",
              data: dataUrl,
              mediaType: normalizedMediaType,
            },
          ],
        },
      ],
    })

    return NextResponse.json({ product: object })
  } catch (error: any) {
    console.error("[v0] analyze-product error:", error?.message || error)
    return NextResponse.json(
      {
        error: "No se pudo analizar el archivo. Intenta con otra foto o completa los datos manualmente.",
        debug: error?.message || String(error),
      },
      { status: 500 },
    )
  }
}
