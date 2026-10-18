// Perfil IA server-side por rubro. Importa `rubro-ui.ts` (datos) + `zod`
// (esquema). **No importar desde el navegador** — el esquema zod no cruza
// la frontera cliente/servidor.
//
// Para la UI del navegador, usar `lib/rubro-ui.ts` directo.

import { z } from "zod"
import { ROPA_UI, TECNOLOGIA_UI, RUBRO_IDS, type RubroId, type RubroUIBundle } from "@/lib/rubro-ui"

export type { RubroId, RubroUIBundle }
export { RUBRO_IDS }

// Medio de la foto para la plantilla del mensaje de usuario. "imagen" o
// "video" — concordancia de género en español.
export type Medium = "imagen" | "video"

export interface InstructionsContext {
  // Lista de nombres de categoría del tenant. Solo se usa cuando el perfil
  // tiene `needsCategoriesList: true` (tecnología). Para ropa se ignora.
  categories?: string[]
}

export interface RubroProfile {
  rubro: RubroId
  model: string
  maxRetries: number
  schema: z.ZodObject<any>
  // Construye el prompt final. Permite inyectar lista de categorías
  // para rubros que lo requieren (tecnología). Ropa devuelve siempre
  // la misma cadena, byte-a-byte con el main pre-refactor.
  buildInstructions(ctx?: InstructionsContext): string
  // Mensaje al usuario. Función (no template string con placeholder)
  // porque tecnología necesita concordancia de género ("esta imagen" /
  // "este video") y ropa mantiene su error de género histórico.
  messageTemplate(medium: Medium): string
  needsCategoriesList: boolean
  // Frase que la IA emite cuando la foto no corresponde al rubro.
  // Solo tecnología la expone; ropa es `null`. El gate --isolation
  // exige: tecnología contiene esta frase, ropa NO.
  rejectionPhrase: string | null
  ui: RubroUIBundle["ui"]
  allowCreateCategory: boolean
  showSuggestedPrice: boolean
  typePrefixMaxLength: number
  referenceMaxLength: number | null
  categoryIsSelect: boolean
}

// ---------- Instructions: ROPA (byte-a-byte vs main pre-refactor) ------

const ROPA_INSTRUCTIONS =
  "Eres un catalogador de inventario para un almacén de ropa en Colombia. " +
  "Analizas fotos de prendas y extraes SOLO datos que puedas verificar visualmente de la imagen. " +
  "Los precios están en pesos colombianos (COP).\n\n" +
  "REGLA CRÍTICA — no inventes: si un atributo no es determinable con certeza a partir de la imagen " +
  "(material, composición textil, marca no visible, país de origen, temporada), NO lo incluyas en la descripción " +
  "y NO lo pongas en `color`/`name`. Es preferible una descripción más corta que una con datos falsos. " +
  "Nunca infieras 'algodón', 'poliéster', 'lino' o cualquier otro material a menos que veas la etiqueta de composición en la foto.\n\n" +
  "DESCRIPCIÓN — corta y directa, formato: '[tipo] [línea/estilo si es visible] [color principal] [detalles visibles breves]'. " +
  "Ejemplos válidos: 'Camisa monastery roja con detalles blancos', 'Pantalón cargo negro con bolsillos laterales', " +
  "'Buzo oversize gris con capucha'. NO uses oraciones completas, adjetivos vagos ('elegante', 'cómoda', 'moderna', 'versátil') " +
  "ni descripciones sensoriales ('suave al tacto', 'de excelente calidad'). Máximo ~12 palabras.\n\n" +
  "Si detectas una etiqueta de precio o talla en la imagen, úsala. La talla es obligatoria para generar el código del producto — " +
  "si no es visible ni deducible, devuelve 'M' como fallback."

// ---------- Instructions: TECNOLOGIA ----------------------------------

// Regla de rubro — vive en su propia constante. Se concatena al prompt
// de tecnología. El gate --isolation la excluye del escaneo negativo y
// verifica aparte: debe aparecer en tecnología y NO en ropa.
export const REJECTION_RULE_TECNOLOGIA =
  "REGLA DE RUBRO: si la foto es claramente de prendas de vestir, de comida, " +
  "o de cualquier otro rubro ajeno a tecnología, devuelve el campo `rejection` " +
  "con el texto exacto 'no corresponde al rubro' y deja el resto de los campos " +
  "vacíos. En ese caso no inventes valores."

const TECNOLOGIA_INSTRUCTIONS_BASE =
  "Eres un catalogador de inventario para una tienda de tecnología y accesorios en Colombia. " +
  "Analizas fotos de productos (fundas, vidrios templados, cables, cargadores, audífonos, " +
  "powerbanks, parlantes, relojes inteligentes, soportes) y extraes SOLO datos verificables " +
  "en la imagen. El precio y el costo se ingresan manualmente — no los estimes.\n\n" +
  "{REJECTION_RULE}\n\n" +
  "REGLA CRÍTICA — no inventes compatibilidad: si el empaque NO indica a qué equipo " +
  "corresponde (p.ej. una funda sin modelo visible, un cable sin indicación de iPhone/" +
  "Android/USB-C), el campo `reference` queda vacío. Nunca asumas compatibilidad por " +
  "forma, color, apertura de cámara o número de pines. Si no está escrito en el empaque, " +
  "no está.\n\n" +
  "MARCA (`brand_prefix`): dos letras mayúsculas. En fundas, vidrios templados y cables, " +
  "la marca es la del EQUIPO al que corresponde el accesorio, NO la del fabricante del " +
  "accesorio. Ejemplo: una funda Spigen para iPhone 17 Pro Max tiene `brand_prefix='IP'`, " +
  "no 'SP'. En accesorios con marca propia (audífonos, parlantes, powerbanks, relojes " +
  "inteligentes), la marca es la del producto mismo (JBL → JB, Xiaomi → XI).\n\n" +
  "Marcas conocidas: RM=Redmi, IP=iPhone, SA=Samsung, HO=Honor, OP=Oppo, IN=Infinix, " +
  "TE=Tecno. Para una marca fuera de esa lista, usa las dos primeras letras en mayúsculas " +
  "(ej: Motorola → MO, Realme → RE, JBL → JB). Si el empaque no muestra marca → " +
  "`brand_prefix` vacío.\n\n" +
  "REFERENCIA (`reference`):\n" +
  "- Fundas, vidrios templados y cables: nombre del EQUIPO al que corresponden según el " +
  "empaque. Ejemplos: funda iPhone 17 Pro Max → '17PM'; vidrio Samsung Galaxy A54 → 'A54'; " +
  "cable para iPhone 15 → '15'.\n" +
  "- Accesorios con marca propia (audífonos, parlantes, powerbanks, relojes inteligentes): " +
  "el nombre comercial del modelo en mayúsculas, sin espacios. Ejemplos: 'TUNE520BT', " +
  "'FLIP6', 'CHARGE5', 'MIBAND8'.\n" +
  "- Si el empaque NO muestra el modelo del equipo o del accesorio: `reference` vacío. La " +
  "UI bloquea Guardar hasta que el operador complete el campo manualmente.\n\n" +
  "ABREVIATURAS DE MODELOS (aplica en `reference`): Pro → P; Pro Max → PM; Ultra → U; " +
  "Plus → PL; Lite → LT; Mini → M; Note → N; Reno → R; Flip → FL; Fold → FD. Sin espacios " +
  "ni caracteres especiales. Sufijos sin abreviatura definida (FE, Neo, Edge, SE, etc.) se " +
  "mantienen tal cual, en mayúsculas y sin espacios. Ejemplos: 'iPhone 15 Pro Max' → '15PM'; " +
  "'Galaxy S24 Ultra' → 'S24U'; 'Redmi Note 13 Pro' → 'N13P'; 'Galaxy S23 FE' → 'S23FE'; " +
  "'Pixel 9 Pro XL' → '9PXL'.\n\n" +
  "NOMBRE (`name`): nombre comercial corto en español, incluyendo capacidad si aparece en " +
  "el empaque. Ejemplos: 'Funda iPhone 17 Pro Max', 'Cable USB-C a Lightning 1m', " +
  "'Audífonos JBL Tune 520BT', 'Powerbank 20000 mAh USB-C'. No inventes capacidad; si el " +
  "empaque no la muestra, omítela.\n\n" +
  "CAPACIDAD (almacenamiento, RAM, mAh, metros): si aparece en el empaque, inclúyela en " +
  "`name` y `description`. NUNCA en `reference` ni en `brand_prefix`.\n\n" +
  "DESCRIPCIÓN (`description`): oración corta en español, formato '[tipo de producto] " +
  "[características visibles del empaque]'. Máximo ~15 palabras. Sin adjetivos de marketing " +
  "('premium', 'excelente', 'de alta calidad'). Sin suposiciones.\n\n" +
  "COLOR (`color`): color principal del producto o del empaque, en español. Si hay varios " +
  "colores visibles, el predominante. Si no es determinable, deja vacío.\n\n" +
  "CATEGORÍA (`category`): devuelve el nombre de la categoría EXACTAMENTE como aparece en " +
  "la lista que recibes al final del prompt. Comparación insensible a mayúsculas. Si " +
  "ninguna aplica, deja `category` vacío (el operador la elige). No inventes categorías " +
  "ni combines nombres.\n\n" +
  "CANTIDAD (`quantity`): número de unidades visibles del MISMO producto en la foto. Si " +
  "solo hay un producto, devuelve 1."

// ---------- Esquemas Zod ----------------------------------------------

const ropaSchema = z.object({
  name: z.string().describe("Nombre corto y comercial de la prenda, ej: 'Camisa manga larga a cuadros'"),
  type_prefix: z
    .string()
    .describe(
      "Prefijo de 2 letras del tipo de prenda EN ESPAÑOL. Ej: CA=Camisa, PA=Pantalón, CH=Chaqueta, VE=Vestido, FA=Falda, BL=Blusa, BU=Buzo, SU=Suéter, SH=Short, ZA=Zapato, AC=Accesorio",
    ),
  category: z.string().describe("Categoría general, ej: Camisas, Pantalones, Vestidos, Calzado, Accesorios"),
  description: z
    .string()
    .describe(
      "Descripción corta y factual en el formato: '[tipo de prenda] [estilo/línea si es visible en la imagen] [color principal] [detalles visibles breves]'. Sin oraciones completas, sin adjetivos de marketing, sin adivinar material ni composición. Máximo ~12 palabras",
    ),
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

const tecnologiaSchema = z.object({
  name: z.string().describe("Nombre comercial del producto en español, incluyendo capacidad si está en el empaque. Ejemplos: 'Funda iPhone 17 Pro Max', 'Audífonos JBL Tune 520BT'"),
  brand_prefix: z.string().describe("Dos letras mayúsculas de la marca. Marcas conocidas: RM, IP, SA, HO, OP, IN, TE. Otras marcas: dos primeras letras en mayúsculas. Vacío si el empaque no muestra marca"),
  reference: z.string().describe("Modelo del equipo (fundas/vidrios/cables) o nombre comercial del accesorio (audífonos/parlantes/powerbanks/relojes). Aplica abreviaturas (Pro→P, Pro Max→PM, Ultra→U, Plus→PL, Lite→LT, Mini→M, Note→N, Reno→R, Flip→FL, Fold→FD). Vacío si el empaque no muestra modelo"),
  category: z.string().describe("Categoría del producto EXACTAMENTE como aparece en la lista provista en el prompt. Vacío si ninguna de la lista aplica"),
  description: z.string().describe("Descripción corta en español, formato '[tipo] [características visibles]'. Máximo ~15 palabras. Sin adjetivos de marketing ni suposiciones"),
  color: z.string().describe("Color principal del producto en español. Vacío si no es determinable"),
  quantity: z.number().int().describe("Cantidad de unidades visibles del MISMO producto. 1 si solo hay uno"),
  rejection: z.string().optional().describe("Texto 'no corresponde al rubro' SOLO si la foto es de un rubro ajeno a tecnología. Vacío en caso normal"),
})

// ---------- Perfiles ---------------------------------------------------

const ropaProfile: RubroProfile = {
  rubro: "ropa",
  model: "google/gemini-2.5-flash",
  maxRetries: 0,
  schema: ropaSchema,
  needsCategoriesList: false,
  rejectionPhrase: null,
  buildInstructions: () => ROPA_INSTRUCTIONS,
  messageTemplate: (medium) =>
    // Preserva byte-a-byte el error de género "Analiza este imagen" del main
    // pre-refactor. Fix de este error va en commit aparte (ver
    // tests/snapshots/rubro-ropa/README.md § "error de género").
    `Analiza este ${medium} de una prenda de ropa y devuelve los datos del producto para ingresarlo al inventario.`,
  ui: ROPA_UI.ui,
  allowCreateCategory: ROPA_UI.allowCreateCategory,
  showSuggestedPrice: ROPA_UI.showSuggestedPrice,
  typePrefixMaxLength: ROPA_UI.typePrefixMaxLength,
  referenceMaxLength: ROPA_UI.referenceMaxLength,
  categoryIsSelect: ROPA_UI.categoryIsSelect,
}

const tecnologiaProfile: RubroProfile = {
  rubro: "tecnologia",
  model: "google/gemini-2.5-flash",
  maxRetries: 0,
  schema: tecnologiaSchema,
  needsCategoriesList: true,
  rejectionPhrase: "no corresponde al rubro",
  buildInstructions: (ctx) => {
    const cats = ctx?.categories ?? []
    const base = TECNOLOGIA_INSTRUCTIONS_BASE.replace("{REJECTION_RULE}", REJECTION_RULE_TECNOLOGIA)
    const catsLine = cats.length > 0
      ? `\n\nCategorías disponibles para esta solicitud: ${cats.join(", ")}.`
      : "\n\nCategorías disponibles para esta solicitud: (ninguna cargada; deja `category` vacío)."
    return base + catsLine
  },
  messageTemplate: (medium) => {
    const demonstrative = medium === "imagen" ? "esta" : "este"
    return `Analiza ${demonstrative} ${medium} del producto y devuelve los datos para ingresarlo al inventario de la tienda de tecnología.`
  },
  ui: TECNOLOGIA_UI.ui,
  allowCreateCategory: TECNOLOGIA_UI.allowCreateCategory,
  showSuggestedPrice: TECNOLOGIA_UI.showSuggestedPrice,
  typePrefixMaxLength: TECNOLOGIA_UI.typePrefixMaxLength,
  referenceMaxLength: TECNOLOGIA_UI.referenceMaxLength,
  categoryIsSelect: TECNOLOGIA_UI.categoryIsSelect,
}

const PROFILES: Record<RubroId, RubroProfile> = {
  ropa: ropaProfile,
  tecnologia: tecnologiaProfile,
}

/**
 * Devuelve el perfil IA del rubro indicado. **Lanza** si el rubro no está
 * en el whitelist. La ruta `/api/analyze-product` cuenta con esta semántica
 * para fallar cerrado — nunca cae a 'ropa' por default.
 */
export function getRubroProfile(rubro: string): RubroProfile {
  const profile = PROFILES[rubro as RubroId]
  if (!profile) {
    throw new Error(`Rubro desconocido: "${rubro}". Esperado: ${RUBRO_IDS.join(" | ")}.`)
  }
  return profile
}
