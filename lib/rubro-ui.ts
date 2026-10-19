// Datos de interfaz del perfil IA por rubro. **Sin dependencias**: labels,
// placeholders, textos, flags y clientFallbacks. Importable desde el
// navegador (ni zod ni Supabase cruzan este módulo). El perfil completo
// con prompt y esquema vive en `lib/rubro-profiles.ts` y se consume
// server-side.
//
// Cualquier texto de dominio del rubro (literales como "Talla", "Camisas",
// "Marca (prefijo)", "FUNDAS") vive acá. El panel no hardcodea ninguno —
// el gate `--isolation` del fixture escanea `components/central/ai-ingress-panel.tsx`
// y rechaza el PR si queda un literal de rubro fuera de este archivo.

export type RubroId = "ropa" | "tecnologia"

export const RUBRO_IDS: readonly RubroId[] = ["ropa", "tecnologia"] as const

export interface UILabelPair {
  label: string
  component: "Input" | "MoneyInput" | "Textarea" | "Select"
  placeholder: string | null
  maxLength: number | null
}

// Claves de los campos del IngressItem usadas para acceder a los labels
// desde el panel. El orden canónico se preserva solo para el gate del
// fixture (`--verify`), que itera `Object.values(ui.labels)` — a nivel
// de código, el panel accede por clave.
export type UILabelKey =
  | "name"
  | "type_prefix"
  | "category"
  | "size"
  | "color"
  | "price"
  | "cost"
  | "quantity"
  | "code"
  | "description"

export type UILabels = Record<UILabelKey, UILabelPair>

export interface UIConstants {
  PREFIX_HINTS: string
  AI_MIN_INTERVAL_MS: number
}

// Fallbacks de los campos de IngressItem. Los runtime los consume el panel.
// La forma del objeto DEPENDE del rubro — ropa usa type_prefix/size,
// tecnologia usa brand_prefix/reference. Firma intencionalmente laxa:
// cada rubro expone solo los campos que su UI consume.
export type ClientFallbacks = Record<string, string | number>

export interface ClientFallbacksBag {
  initial: ClientFallbacks
  analyze: ClientFallbacks
}

export interface RubroUI {
  labels: UILabels
  constants: UIConstants
  hero: string
  codeExample: string
  codeFormat: string
  clientFallbacks: ClientFallbacksBag
}

export interface RubroUIBundle {
  rubro: RubroId
  ui: RubroUI
  allowCreateCategory: boolean
  showSuggestedPrice: boolean
  // Longitud máxima del prefijo (campo type_prefix para ropa,
  // brand_prefix para tecnologia). Fuente única: lo consume el panel para
  // el maxLength del Input, apply-analysis para el `.slice()` del
  // normalizador, inventory-actions para la regex de validateItemForRubro.
  typePrefixMaxLength: number
  // Longitud máxima del campo size (talla en ropa, referencia en tec).
  // null = sin tope (ropa). Mismo rol que typePrefixMaxLength: fuente
  // única para UI/apply-analysis/validate.
  referenceMaxLength: number | null
  // Si true, la categoría se renderiza como <Select> con la lista de la
  // base. Si false, como <Input> libre con autocompletado flexible.
  categoryIsSelect: boolean
}

// ---------- Perfil ROPA (byte-a-byte preservado) ----------------------

export const ROPA_UI: RubroUIBundle = {
  rubro: "ropa",
  allowCreateCategory: true,
  showSuggestedPrice: true,
  typePrefixMaxLength: 4,
  referenceMaxLength: null,
  categoryIsSelect: false,
  ui: {
    labels: {
      name:        { label: "Nombre del producto",       component: "Input",       placeholder: "Ej: Camisa manga larga", maxLength: null },
      type_prefix: { label: "Tipo (prefijo)",            component: "Input",       placeholder: "CA",                      maxLength: 4 },
      category:    { label: "Categoría",                 component: "Input",       placeholder: "Camisas",                 maxLength: null },
      size:        { label: "Talla",                     component: "Input",       placeholder: "M",                       maxLength: null },
      color:       { label: "Color",                     component: "Input",       placeholder: "Azul",                    maxLength: null },
      price:       { label: "Precio de venta (COP)",     component: "MoneyInput",  placeholder: "95.000",                  maxLength: null },
      cost:        { label: "Costo de adquisición (COP)",component: "MoneyInput",  placeholder: "45.000",                  maxLength: null },
      quantity:    { label: "Cantidad a ingresar",       component: "Input",       placeholder: "1",                       maxLength: null },
      code:        { label: "Código de identificación",  component: "Input",       placeholder: "Automático: ${…}",        maxLength: null },
      description: { label: "Descripción",               component: "Textarea",    placeholder: "Material, estilo, detalles…", maxLength: null },
    },
    constants: {
      PREFIX_HINTS: "CA=Camisa · PA=Pantalón · CH=Chaqueta · VE=Vestido · FA=Falda · BL=Blusa · BU=Buzo · SU=Suéter · SH=Short · ZA=Zapato · AC=Accesorio",
      AI_MIN_INTERVAL_MS: 6500,
    },
    hero: "Sube fotos de las prendas. La IA detecta el tipo, la descripción, la talla y sugiere el precio y costo. Cada producto recibe un código único como CA-M-95-00.",
    codeExample: "CA-M-95-00",
    codeFormat: "{prefix}-{size}-{thousands}-{nn}",
    clientFallbacks: {
      initial: {
        type_prefix: "XX",
        size: "M",
        color: "",
        quantity: 1,
        price: 0,
        cost: 0,
      },
      analyze: {
        name: "",
        type_prefix: "XX",
        category: "",
        description: "",
        size: "M",
        color: "",
        price: 0,
        cost: 0,
        quantity: 1,
      },
    },
  },
}

// ---------- Perfil TECNOLOGIA -----------------------------------------

export const TECNOLOGIA_UI: RubroUIBundle = {
  rubro: "tecnologia",
  allowCreateCategory: false,
  showSuggestedPrice: false,
  typePrefixMaxLength: 2,
  referenceMaxLength: 20,
  categoryIsSelect: true,
  ui: {
    labels: {
      name:        { label: "Nombre del producto",       component: "Input",       placeholder: "Ej: Funda iPhone 17 Pro Max", maxLength: null },
      type_prefix: { label: "Marca (prefijo)",           component: "Input",       placeholder: "IP",                      maxLength: 2 },
      size:        { label: "Referencia",                component: "Input",       placeholder: "17PM",                     maxLength: 20 },
      category:    { label: "Categoría",                 component: "Select",      placeholder: "Elige una categoría",     maxLength: null },
      color:       { label: "Color",                     component: "Input",       placeholder: "Negro",                    maxLength: null },
      price:       { label: "Precio de venta (COP)",     component: "MoneyInput",  placeholder: "35.000",                   maxLength: null },
      cost:        { label: "Costo de adquisición (COP)",component: "MoneyInput",  placeholder: "15.000",                   maxLength: null },
      quantity:    { label: "Cantidad a ingresar",       component: "Input",       placeholder: "1",                        maxLength: null },
      code:        { label: "Código de identificación",  component: "Input",       placeholder: "Automático: ${…}",         maxLength: null },
      description: { label: "Descripción",               component: "Textarea",    placeholder: "Modelo, características visibles…", maxLength: null },
    },
    constants: {
      PREFIX_HINTS: "RM=Redmi · IP=iPhone · SA=Samsung · HO=Honor · OP=Oppo · IN=Infinix · TE=Tecno · Otras marcas: dos primeras letras",
      AI_MIN_INTERVAL_MS: 6500,
    },
    hero: "Sube fotos de los productos de tecnología. La IA detecta la marca, la referencia del equipo o modelo, el color y arma la descripción. El precio y el costo se ingresan manualmente. Cada producto recibe un código único como IP-17PM-35-00.",
    codeExample: "IP-17PM-35-00",
    codeFormat: "{brand}-{reference}-{thousands}-{nn}",
    clientFallbacks: {
      initial: {
        brand_prefix: "",
        reference: "",
        color: "",
        quantity: 1,
        price: 0,
        cost: 0,
      },
      analyze: {
        name: "",
        brand_prefix: "",
        reference: "",
        category: "",
        description: "",
        color: "",
        quantity: 1,
      },
    },
  },
}

const BUNDLES: Record<RubroId, RubroUIBundle> = {
  ropa: ROPA_UI,
  tecnologia: TECNOLOGIA_UI,
}

/**
 * Devuelve el bundle de UI del rubro indicado. Lanza si el rubro no está
 * en el whitelist. Pensada para uso **server-side** y para el panel una
 * vez que confirmó que el fetch de rubro llegó con un valor válido.
 */
export function getRubroUIBundle(rubro: string): RubroUIBundle {
  const bundle = BUNDLES[rubro as RubroId]
  if (!bundle) {
    throw new Error(`Rubro desconocido: "${rubro}". Esperado: ${RUBRO_IDS.join(" | ")}.`)
  }
  return bundle
}

/**
 * Versión no-throw para el cliente. Si el fetch del rubro falla o devuelve
 * un valor inválido, el panel usa esta función y renderiza un estado de
 * error, nunca cae a 'ropa' como fallback.
 */
export function tryGetRubroUIBundle(rubro: string | null | undefined): { bundle: RubroUIBundle } | { error: string } {
  if (!rubro) return { error: "rubro no definido" }
  const bundle = BUNDLES[rubro as RubroId]
  if (!bundle) return { error: `rubro desconocido: "${rubro}"` }
  return { bundle }
}
