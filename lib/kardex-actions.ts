"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"
import { getAccessibleSiteIds } from "@/lib/auth-helpers"

/**
 * Resuelve sobre qué sedes puede consultar el usuario.
 * Devuelve null cuando no hay restricción (admin/contador sin filtro),
 * o [] cuando no tiene acceso a nada — el llamador debe cortar.
 */
async function resolveSiteScope(requestedSiteId?: string): Promise<string[] | null> {
  const accessible = await getAccessibleSiteIds()

  if (accessible === "all") {
    return requestedSiteId ? [requestedSiteId] : null
  }
  if (accessible.length === 0) return []

  // Si pide una sede concreta, tiene que estar entre las suyas
  if (requestedSiteId) {
    return accessible.includes(requestedSiteId) ? [requestedSiteId] : []
  }
  return accessible
}

export async function getStockMovements(filters?: {
  product_id?: string
  warehouse_id?: string
  movement_type?: string
  from_date?: string
  to_date?: string
  site_id?: string
  limit?: number
}) {
  await requireRole("admin", "contador", "encargado")
  const supabase = await createServerSupabaseClient()

  const siteIds = await resolveSiteScope(filters?.site_id)
  if (siteIds && siteIds.length === 0) return []

  let warehouseIds: string[] | null = null
  if (siteIds) {
    const { data: whs } = await supabase
      .from("warehouses")
      .select("warehouse_id")
      .in("site_id", siteIds)
    warehouseIds = (whs || []).map((w) => w.warehouse_id)
    if (warehouseIds.length === 0) return []
  }

  let query = supabase
    .from("stock_movements")
    .select(`
      movement_id,
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      reference_type,
      reference_id,
      user_id,
      notes,
      created_at,
      products(name, code),
      warehouses(name, site_id, sites(name))
    `)
    .order("created_at", { ascending: false })
    .limit(filters?.limit || 200)

  if (filters?.warehouse_id) {
    if (warehouseIds && !warehouseIds.includes(filters.warehouse_id)) {
      return []
    }
    query = query.eq("warehouse_id", filters.warehouse_id)
  } else if (warehouseIds) {
    query = query.in("warehouse_id", warehouseIds)
  }
  if (filters?.product_id) {
    query = query.eq("product_id", filters.product_id)
  }
  if (filters?.movement_type) {
    query = query.eq("movement_type", filters.movement_type)
  }
  if (filters?.from_date) {
    query = query.gte("created_at", filters.from_date)
  }
  if (filters?.to_date) {
    query = query.lte("created_at", filters.to_date + "T23:59:59")
  }

  const { data, error } = await query
  if (error) {
    console.error("Error fetching stock movements:", error)
    return []
  }
  return data || []
}

export async function getProductsForFilter() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("products")
    .select("product_id, name, code")
    .eq("is_active", true)
    .order("name")
  return data || []
}

export async function getWarehousesForFilter(siteId?: string) {
  await requireRole("admin", "contador", "encargado")
  const supabase = await createServerSupabaseClient()

  const siteIds = await resolveSiteScope(siteId)
  if (siteIds && siteIds.length === 0) return []

  let query = supabase
    .from("warehouses")
    .select("warehouse_id, name, site_id, sites(name)")
    .order("name")

  if (siteIds) {
    query = query.in("site_id", siteIds)
  }

  const { data } = await query
  return data || []
}

export async function verifyKardexIntegrity() {
  await requireRole("admin", "contador")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("verify_kardex_integrity")
  if (error) {
    console.error("Error verifying kardex:", error)
    return { success: false, message: error.message, discrepancies: [] }
  }
  return {
    success: true,
    message: (data || []).length === 0 ? "Kardex íntegro. Sin discrepancias." : `${data.length} discrepancia(s) encontrada(s).`,
    discrepancies: data || [],
  }
}
