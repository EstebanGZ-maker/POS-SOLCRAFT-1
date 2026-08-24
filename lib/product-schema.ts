import { z } from "zod"

// Schema Zod para UNA fila del importador masivo de productos (s22).
//
// Los campos snake_case coinciden 1:1 con los que el RPC
// import_products_bulk_atomic espera dentro del jsonb_to_recordset —
// NO renombrar sin actualizar la migración también.
//
// row_index es 1-indexed (fila 1 = primera fila de datos después del
// header) para que los mensajes de error coincidan con lo que el usuario
// ve en el preview.
export const productImportRowSchema = z.object({
  row_index: z.number().int().positive(),

  name: z
    .string({ message: "El nombre es requerido." })
    .trim()
    .min(1, "El nombre es requerido."),

  price: z.coerce
    .number({ message: "El precio debe ser un número." })
    .refine((v) => v >= 0, "El precio no puede ser negativo."),

  category_id: z
    .string({ message: "La categoría es requerida." })
    .uuid("La categoría no existe en el sistema."),

  unit: z
    .string({ message: "La unidad de medida es requerida." })
    .trim()
    .min(1, "La unidad de medida es requerida."),

  cost: z.coerce
    .number({ message: "El costo debe ser un número." })
    .refine((v) => v >= 0, "El costo no puede ser negativo."),

  initial_stock: z.coerce
    .number({ message: "La cantidad inicial debe ser un número." })
    .int("La cantidad inicial debe ser un entero.")
    .refine((v) => v >= 0, "La cantidad inicial no puede ser negativa."),

  // Opcionales: string vacío o whitespace se normaliza a null para no
  // enviar '' a la DB (evita confundir '' con "sin descripción").
  description: z
    .union(
      [z.string(), z.null(), z.undefined()],
      { message: "El valor debe ser texto o estar vacío." },
    )
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),

  size: z
    .union(
      [z.string(), z.null(), z.undefined()],
      { message: "El valor debe ser texto o estar vacío." },
    )
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),

  code: z
    .union(
      [z.string(), z.null(), z.undefined()],
      { message: "El valor debe ser texto o estar vacío." },
    )
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),

  barcode: z
    .union(
      [z.string(), z.number(), z.null(), z.undefined()],
      { message: "El valor debe ser texto o estar vacío." },
    )
    .transform((v) => {
      if (v === null || v === undefined) return null
      // Excel a veces coerce barcodes numéricos a number; siempre lo
      // guardamos como string.
      let s = typeof v === "number" ? String(v) : v.trim()
      // Fórmulas de plantillas tipo ="*"&Referencia&"*" (Code39) traen
      // los asteriscos delimitadores en el .result. Los asteriscos NO
      // son parte del código real — son marcadores de start/stop del
      // formato Code39 — así que los quitamos para que barcode quede
      // consistente con code.
      s = s.replace(/^\*+/, "").replace(/\*+$/, "").trim()
      return s === "" ? null : s
    }),
})

export type ProductImportRow = z.infer<typeof productImportRowSchema>
