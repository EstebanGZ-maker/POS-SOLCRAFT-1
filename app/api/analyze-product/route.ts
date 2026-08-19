import { generateObject } from "ai"
import { z } from "zod"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

const productSchema = z.object({
  name: z.string().describe("Nombre corto y comercial de la prenda, ej: 'Camisa manga larga a cuadros'"),
  type_prefix: z
    .string()
    .describe(
      "Prefijo de 2 letras del tipo de prenda EN ESPAÑOL. Ej: CA=Camisa, PA=Pantalón, CH=Chaqueta, VE=Vestido, FA=Falda, BL=Blusa, BU=Buzo, SU=Suéter, SH=Short, ZA=Zapato, AC=Accesorio",
    ),
  category: z.string().describe("Categoría general, ej: Camisas, Pantalones, Vestidos, Calzado, Accesorios"),
  description: z.string().describe("Descripción detallada: material aparente, color, patrón, estilo y detalles visibles"),
  size: z
    .string()
    .describe("Talla visible o estimada: XS, S, M, L, XL, XXL, o numérica (28, 30, 38). Si no se ve, estimar 'M'"),
  color: z.string().describe("Color principal de la prenda"),
  suggested_price: z
    .number()
    .describe("Precio de venta sugerido en pesos colombianos (COP), múltiplo de 1000, ej: 95000"),
  suggested_cost: z.number().describe("Costo de adquisición estimado en COP, típicamente 40-55% del precio de venta"),
  quantity: z
    .number()
    .int()
    .describe("Cantidad de unidades visibles de esta MISMA prenda en la imagen/video. Si solo hay una, devolver 1"),
})

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

    const { object } = await generateObject({
      model: "google/gemini-2.5-flash",
      schema: productSchema,
      instructions:
        "Eres un experto en catalogación de inventario para un almacén de ropa en Colombia. " +
        "Analizas fotos o videos de prendas y extraes la información del producto para registrarlo. " +
        "Los precios están en pesos colombianos (COP). Sé preciso con el tipo de prenda, color y talla. " +
        "Si detectas una etiqueta de precio o talla en la imagen, úsala.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                (hint ? `Contexto del usuario: ${hint}. ` : "") +
                `Analiza este ${isVideo ? "video" : "imagen"} de una prenda de ropa y devuelve los datos del producto para ingresarlo al inventario.`,
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
