"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"
import type { ProductImportRow } from "@/lib/product-schema"

// =====================================================================
// Server actions del importador masivo de productos (s22).
//
// - getImportBootstrap(): carga en 1 sola action todo el estado del
//   sistema que la Capa 1 (validación en el cliente) necesita para
//   validar sin N+1 queries: códigos/barcodes existentes, categorías
//   disponibles y bodegas destino permitidas por el rol/sede del user.
//
// - runProductImport(): thin wrapper del RPC import_products_bulk_atomic.
//   Toda la atomicidad y los mensajes de error específicos viven en el
//   RPC — este TS solo hace auth y propaga el mensaje.
// =====================================================================

export type ImportBootstrap = {
  existingCodes: string[]
  existingBarcodes: string[]
  categories: Array<{ category_id: string; name: string }>
  warehouses: Array<{
    warehouse_id: string
    name: string
    site_id: string
    site_name: string
  }>
}

export async function getImportBootstrap(): Promise<ImportBootstrap> {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  // Todas las queries en paralelo. RLS filtra sites por rol/sede, así
  // que la lista de warehouses ya viene acotada al scope del user.
  const [codesRes, barcodesRes, catsRes, sitesRes] = await Promise.all([
    supabase.from("products").select("code").not("code", "is", null),
    supabase.from("products").select("barcode").not("barcode", "is", null),
    supabase.from("categories").select("category_id, name").order("name"),
    supabase
      .from("sites")
      .select("site_id, name, warehouses ( warehouse_id, name, is_system )")
      .order("is_central", { ascending: false })
      .order("name"),
  ])

  const existingCodes = ((codesRes.data ?? []) as Array<{ code: string | null }>)
    .map((r) => r.code)
    .filter((v): v is string => !!v)

  const existingBarcodes = (
    (barcodesRes.data ?? []) as Array<{ barcode: string | null }>
  )
    .map((r) => r.barcode)
    .filter((v): v is string => !!v)

  const categories =
    (catsRes.data ?? []) as Array<{ category_id: string; name: string }>

  const warehouses: ImportBootstrap["warehouses"] = []
  for (const site of (sitesRes.data ?? []) as Array<{
    site_id: string
    name: string
    warehouses: Array<{ warehouse_id: string; name: string; is_system: boolean }>
  }>) {
    for (const w of site.warehouses ?? []) {
      // Tránsito y otras bodegas del sistema no son destinos válidos de import.
      if (w.is_system) continue
      warehouses.push({
        warehouse_id: w.warehouse_id,
        name: w.name,
        site_id: site.site_id,
        site_name: site.name,
      })
    }
  }

  return { existingCodes, existingBarcodes, categories, warehouses }
}

export async function runProductImport(
  rows: ProductImportRow[],
  warehouse_id: string,
): Promise<{ success: boolean; message: string; inserted_count?: number }> {
  const profile = await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  if (!rows.length) {
    return { success: false, message: "No hay filas para importar." }
  }

  const { data, error } = await supabase.rpc("import_products_bulk_atomic", {
    p_rows: rows,
    p_warehouse_id: warehouse_id,
    p_user_id: profile.id,
  })

  if (error) {
    // El RPC construye mensajes humanos (fila + campo + valor) y los emite
    // via RAISE EXCEPTION. supabase-js los expone tal cual en error.message,
    // así que se muestran directo al usuario sin regex ni parsing.
    return { success: false, message: error.message }
  }

  const res = (data ?? {}) as { success?: boolean; inserted_count?: number }
  revalidatePath("/inventory/products")
  return {
    success: true,
    message: `Se importaron ${res.inserted_count ?? 0} producto(s).`,
    inserted_count: res.inserted_count,
  }
}
