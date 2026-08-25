import ExcelJS from "exceljs"
import { productImportRowSchema, type ProductImportRow } from "@/lib/product-schema"

// =====================================================================
// Lógica compartida del importador masivo de productos (s22).
//
// Pura, sin side effects, sin "use server". Se usa desde el cliente
// (parsing, validación en memoria, generación de plantilla) y desde el
// server action que hace el submit final.
//
// Ver también:
//   - lib/product-schema.ts       — validación Zod por fila
//   - lib/product-import-actions.ts — server actions (bootstrap + RPC call)
//   - RPC import_products_bulk_atomic (migración 20260824000001)
// =====================================================================

// ----- Config global -----

/** Máximo de filas por archivo. Ver ESTADO-PENDIENTES §0 (s22). */
export const IMPORT_MAX_ROWS = 1000

/** Límite de tamaño del archivo subido (bytes). Alineado con Alegra. */
export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024

// ----- Definición de campos internos + metadata para la UI de mapeo -----

export type ImportFieldKey =
  | "name"
  | "price"
  | "category"
  | "unit"
  | "cost"
  | "initial_stock"
  | "description"
  | "size"
  | "code"
  | "barcode"
  | "_ignore"

export const IMPORT_FIELDS: Record<
  ImportFieldKey,
  { label: string; required: boolean }
> = {
  name: { label: "Nombre", required: true },
  price: { label: "Precio Total", required: true },
  category: { label: "Categoría", required: true },
  unit: { label: "Unidad de Medida", required: true },
  cost: { label: "Costo unitario", required: true },
  initial_stock: { label: "Cantidad inicial", required: true },
  description: { label: "Descripción", required: false },
  size: { label: "Talla", required: false },
  code: { label: "Referencia (código)", required: false },
  barcode: { label: "Código de barras", required: false },
  _ignore: { label: "(Ignorar esta columna)", required: false },
}

// ----- Plantilla oficial de columnas (fuente de referencia) -----

/**
 * Encabezados EXACTOS de la plantilla oficial de Alegra que replicamos.
 * Nota: "Venta en negativo" está en la plantilla pero se IGNORA
 * intencionalmente — no hay columna equivalente en products ni
 * funcionalidad relacionada en el sistema (decisión de scope s22).
 * Se lee la columna pero se descarta.
 */
export const TEMPLATE_HEADERS: string[] = [
  "Nombre (Requerido)",
  "Precio Total (Requerido)",
  "CATEGORIA",
  "Unidad de Medida (Requerido)",
  "Costo unitario (Requerido para inventariables)",
  "Cantidad inicial en bodega Principal (Requerido para inventariables)",
  "Descripción (Opcional)",
  "TALLA",
  "Referencia (Opcional)",
  "CODIGO",
  "Venta en negativo",
]

// Mapa de encabezado normalizado → campo interno. Sirve para auto-detectar
// el mapping cuando el usuario sube un archivo con las columnas oficiales.
const DEFAULT_HEADER_MAP: Record<string, ImportFieldKey> = {
  "nombre (requerido)": "name",
  "precio total (requerido)": "price",
  categoria: "category",
  "unidad de medida (requerido)": "unit",
  "costo unitario (requerido para inventariables)": "cost",
  "cantidad inicial en bodega principal (requerido para inventariables)":
    "initial_stock",
  "descripcion (opcional)": "description",
  talla: "size",
  "referencia (opcional)": "code",
  codigo: "barcode",
  "venta en negativo": "_ignore",
}

/** Normaliza para comparación: lowercase, trim, quita tildes. */
function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
}

/**
 * Dado los headers detectados en la primera fila del archivo, devuelve
 * un mapping tentativo (headerIndex → ImportFieldKey). Las columnas no
 * reconocidas quedan sin mapear (undefined) — el usuario las asigna a
 * mano en la Pantalla 2.
 */
export function autoMapColumns(
  headers: unknown[],
): Record<number, ImportFieldKey | undefined> {
  const out: Record<number, ImportFieldKey | undefined> = {}
  headers.forEach((h, idx) => {
    const key = DEFAULT_HEADER_MAP[normalizeHeader(h)]
    out[idx] = key
  })
  return out
}

// ----- Parse de archivo .xlsx a filas crudas -----

export type RawSheet = {
  headers: string[]
  rows: unknown[][]
}

/**
 * Lee un .xlsx y retorna la primera hoja como { headers, rows } donde
 * rows son arrays alineados con headers por posición.
 *
 * Solo se usa desde el cliente (recibe un File). exceljs corre en
 * browser sin problemas.
 */
/**
 * exceljs a veces devuelve la celda como un objeto tipado (richText,
 * hyperlink, formula, error, mergeCell) en vez de una primitiva. Si
 * dejamos pasar el objeto tal cual, Zod lo rechaza con "Invalid input"
 * genérico. Esta función lo colapsa a string/number/boolean/null/Date
 * antes de que llegue a la validación.
 */
function normalizeCellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === "string") {
    const t = v.trim()
    return t === "" ? null : t
  }
  if (typeof v === "number" || typeof v === "boolean") return v
  if (v instanceof Date) return v
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    // Formula computada por Excel — cubre formula, sharedFormula y
    // arrayFormula. exceljs siempre expone el valor calculado como
    // .result, así que basta con la presencia de esa key.
    if ("result" in o) return normalizeCellValue(o.result)
    // Rich text: concatenar los fragmentos .text.
    if (Array.isArray(o.richText)) {
      const s = (o.richText as Array<{ text?: unknown }>)
        .map((f) => String(f?.text ?? ""))
        .join("")
        .trim()
      return s === "" ? null : s
    }
    // Hyperlink: usar el .text visible.
    if ("hyperlink" in o && "text" in o) return normalizeCellValue(o.text)
    // Error cell (#REF!, #VALUE!, etc.).
    if ("error" in o) return String(o.error)
    // SharedString u otro: fallback razonable.
    if ("text" in o) return normalizeCellValue(o.text)
  }
  return v
}

export async function parseWorkbook(file: File): Promise<RawSheet> {
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) {
    throw new Error("El archivo no tiene ninguna hoja.")
  }

  const rows: unknown[][] = []
  let headers: string[] = []

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // ExcelJS incluye el índice 0 vacío por convención; slice(1) lo saca.
    const values = (row.values as unknown[]).slice(1).map(normalizeCellValue)
    if (rowNumber === 1) {
      headers = values.map((v) => String(v ?? "").trim())
    } else {
      rows.push(values)
    }
  })

  return { headers, rows }
}

// ----- Generación de plantilla descargable -----

/**
 * Genera el .xlsx de plantilla (headers oficiales + 1 fila de ejemplo)
 * como Buffer para descarga desde el cliente.
 */
export async function buildTemplateWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Productos")
  ws.addRow(TEMPLATE_HEADERS)
  // Fila de ejemplo — valores plausibles para que el usuario vea el formato.
  ws.addRow([
    "Camisa manga corta",
    50000,
    "Ropa",
    "Unidad",
    30000,
    10,
    "Descripción opcional",
    "M",
    "CAM-M-001",
    "7701234567890",
    "", // Venta en negativo — se ignora
  ])
  // Estilo mínimo: negrita para headers.
  ws.getRow(1).font = { bold: true }
  ws.columns.forEach((c) => (c.width = 28))
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf)
}

// ----- Validación de todas las filas (Capa 1) -----

export type ImportBootstrapData = {
  // Mapa code → is_active. Ver comentario en product-import-actions.ts:
  // el estado importa para distinguir el mensaje de conflicto entre un
  // producto ACTIVO ("ya existe") y uno INACTIVO ("reactivalo o usá otro").
  existingCodes: Record<string, boolean>
  existingBarcodes: Record<string, boolean>
  categories: Array<{ category_id: string; name: string }>
}

export type ValidatedRow = {
  row_index: number
  raw: unknown[]
  product: ProductImportRow | null
  errors: string[]
}

/**
 * Aplica el mapping a las filas crudas, resuelve la categoría por nombre
 * contra bootstrap, corre Zod, y detecta duplicados intra-archivo y
 * choques con la DB. Retorna un array 1:1 con las filas de entrada,
 * cada una con sus errores (colecta todos, no corta en el primero).
 */
export function validateRows(
  rows: unknown[][],
  mapping: Record<number, ImportFieldKey | undefined>,
  bootstrap: ImportBootstrapData,
): ValidatedRow[] {
  // Los mapas del bootstrap ya llegan como Record<code, is_active>.
  const codeStatus = bootstrap.existingCodes
  const barcodeStatus = bootstrap.existingBarcodes
  const categoryByName = new Map(
    bootstrap.categories.map((c) => [normalizeHeader(c.name), c.category_id]),
  )

  // Índice inverso: field → header index del archivo. Un mismo field solo
  // puede venir de una columna; si el usuario mapeó dos columnas al mismo
  // field, tomamos la última (la UI de mapeo debería evitarlo con un
  // check aparte, pero acá igual no rompe).
  const fieldToIdx: Partial<Record<ImportFieldKey, number>> = {}
  for (const [idxStr, field] of Object.entries(mapping)) {
    if (field && field !== "_ignore") fieldToIdx[field] = Number(idxStr)
  }

  // Primera pasada: parse + Zod + resolve category. Guarda code/barcode
  // para detectar duplicados intra-archivo en la segunda pasada.
  const seenCodes = new Map<string, number>() // code → primer row_index visto
  const seenBarcodes = new Map<string, number>()

  const results: ValidatedRow[] = rows.map((raw, i) => {
    const row_index = i + 1
    const errors: string[] = []

    const cellAt = (field: ImportFieldKey): unknown => {
      const idx = fieldToIdx[field]
      return idx !== undefined ? raw[idx] : undefined
    }

    // Chequeo temprano: campos requeridos que ni siquiera están mapeados.
    for (const f of ["name", "price", "category", "unit", "cost", "initial_stock"] as ImportFieldKey[]) {
      if (fieldToIdx[f] === undefined) {
        errors.push(`Falta mapear la columna "${IMPORT_FIELDS[f].label}".`)
      }
    }

    // Resolver categoría por nombre. Si el usuario mapeó la columna
    // pero el nombre no existe en el sistema → error específico.
    const categoryName = cellAt("category")
    let category_id: string | undefined
    if (fieldToIdx.category !== undefined) {
      const norm = normalizeHeader(categoryName)
      if (!norm) {
        errors.push("La categoría es requerida.")
      } else {
        category_id = categoryByName.get(norm)
        if (!category_id) {
          errors.push(`La categoría "${categoryName}" no existe en el sistema.`)
        }
      }
    }

    // Armar el candidato y correr Zod.
    let product: ProductImportRow | null = null
    if (errors.length === 0) {
      const candidate = {
        row_index,
        name: cellAt("name"),
        price: cellAt("price"),
        category_id,
        unit: cellAt("unit"),
        cost: cellAt("cost"),
        initial_stock: cellAt("initial_stock"),
        description: cellAt("description"),
        size: cellAt("size"),
        code: cellAt("code"),
        barcode: cellAt("barcode"),
      }
      // TEMP s22: logging fila-a-fila pre-Zod para diagnosticar el bug de
      // "14/14 con error" del archivo real. Remover en commit de limpieza
      // una vez validado el fix de normalización de celdas exceljs.
      if (typeof window !== "undefined") {
        // eslint-disable-next-line no-console
        console.log("[product-import] row", row_index, {
          candidate,
          types: Object.fromEntries(
            Object.entries(candidate).map(([k, v]) => [
              k,
              v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
            ]),
          ),
        })
      }
      const parsed = productImportRowSchema.safeParse(candidate)
      if (parsed.success) {
        product = parsed.data
      } else {
        // TEMP s22: log detallado de issues Zod (path + message + code)
        // para diagnosticar mensajes genéricos "Invalid input".
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log("[product-import] row", row_index, "zod-issues",
            parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              code: i.code,
              message: i.message,
            })),
          )
        }
        for (const issue of parsed.error.issues) {
          const fieldLabel = issue.path[0]
            ? ` (campo "${String(issue.path[0])}")`
            : ""
          errors.push(`${issue.message}${fieldLabel}`)
        }
      }
    }

    // Duplicados intra-archivo (solo si la fila pasó Zod).
    if (product) {
      if (product.code) {
        const prev = seenCodes.get(product.code)
        if (prev !== undefined) {
          errors.push(
            `La referencia "${product.code}" está duplicada en el archivo (también aparece en la fila ${prev}).`,
          )
        } else {
          seenCodes.set(product.code, row_index)
        }
      }
      if (product.barcode) {
        const prev = seenBarcodes.get(product.barcode)
        if (prev !== undefined) {
          errors.push(
            `El código de barras "${product.barcode}" está duplicado en el archivo (también aparece en la fila ${prev}).`,
          )
        } else {
          seenBarcodes.set(product.barcode, row_index)
        }
      }

      // Choque con DB — el mensaje distingue entre producto activo e
      // inactivo. Los constraints UNIQUE aplican a los dos casos por
      // igual (evita que dos filas activa/inactiva compartan código y
      // rompan lookups por barcode en el POS).
      if (product.code && product.code in codeStatus) {
        if (codeStatus[product.code]) {
          errors.push(
            `La referencia "${product.code}" ya existe en el sistema.`,
          )
        } else {
          errors.push(
            `La referencia "${product.code}" pertenece a un producto inactivo. Reactivalo desde /inventory/products (mostrar inactivos) o usá otro código en el archivo.`,
          )
        }
      }
      if (product.barcode && product.barcode in barcodeStatus) {
        if (barcodeStatus[product.barcode]) {
          errors.push(
            `El código de barras "${product.barcode}" ya existe en el sistema.`,
          )
        } else {
          errors.push(
            `El código de barras "${product.barcode}" pertenece a un producto inactivo. Reactivalo desde /inventory/products (mostrar inactivos) o usá otro código en el archivo.`,
          )
        }
      }
    }

    return {
      row_index,
      raw,
      product: errors.length === 0 ? product : null,
      errors,
    }
  })

  return results
}

/** True si TODAS las filas están limpias. Usado por el botón "Importar". */
export function allValid(results: ValidatedRow[]): boolean {
  return results.length > 0 && results.every((r) => r.errors.length === 0 && r.product !== null)
}
