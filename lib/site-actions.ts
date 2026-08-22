"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"
import { getAccessibleSiteIds, getUserProfile } from "@/lib/auth-helpers"
import { withPosTiming } from "@/lib/pos-timing"

const SITE_COOKIE = "current_site_id"

export type Site = {
  site_id: string
  name: string
  code: string
  is_central: boolean
  address: string | null
}

export type Warehouse = {
  warehouse_id: string
  site_id: string
  name: string
  is_primary: boolean
}

export async function getSites(): Promise<Site[]> {
  return withPosTiming("getSites", async () => {
    const supabase = await createServerSupabaseClient()
    const { data, error } = await supabase
      .from("sites")
      .select("*")
      .order("is_central", { ascending: false })
      .order("name", { ascending: true })
    if (error) {
      console.error("Error fetching sites:", error)
      return []
    }
    const all = data || []

    // Filtrar por acceso del usuario. Admin/contador ven todas.
    // Bodega central se muestra siempre (para vistas cross-site como recibir mercancía)
    // solo si el usuario tiene acceso a alguna sede del sistema.
    const accessible = await getAccessibleSiteIds()
    if (accessible === "all") return all
    if (accessible.length === 0) return []
    const allowed = new Set(accessible)
    return all.filter((s) => allowed.has(s.site_id))
  })
}

export async function getSitesWithWarehouses() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("sites")
    .select("*, warehouses ( warehouse_id, name, is_primary, is_system )")
    .order("is_central", { ascending: false })
    .order("name", { ascending: true })
  if (error) {
    console.error("Error fetching sites with warehouses:", error)
    return []
  }
  return data || []
}

export async function getWarehouses(): Promise<Warehouse[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from("warehouses").select("*").order("name", { ascending: true })
  if (error) {
    console.error("Error fetching warehouses:", error)
    return []
  }
  return data || []
}

// Returns the primary warehouse id for a given site
export async function getWarehouseForSite(site_id: string): Promise<string | null> {
  return withPosTiming("getWarehouseForSite", async () => {
    const supabase = await createServerSupabaseClient()
    const { data, error } = await supabase
      .from("warehouses")
      .select("warehouse_id")
      .eq("site_id", site_id)
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle()
    if (error || !data) {
      console.error("Error fetching warehouse for site:", error)
      return null
    }
    return data.warehouse_id
  })
}

export async function getCentralWarehouse(): Promise<{ site: Site; warehouse_id: string } | null> {
  const supabase = await createServerSupabaseClient()
  const { data: site } = await supabase.from("sites").select("*").eq("is_central", true).limit(1).maybeSingle()
  if (!site) return null
  const warehouse_id = await getWarehouseForSite(site.site_id)
  if (!warehouse_id) return null
  return { site, warehouse_id }
}

// --- Current site cookie ---
export async function getCurrentSiteId(): Promise<string | null> {
  const store = await cookies()
  return store.get(SITE_COOKIE)?.value ?? null
}

export async function getCurrentSite(): Promise<Site | null> {
  const id = await getCurrentSiteId()
  const sites = await getSites()
  if (!sites.length) return null
  const found = sites.find((s) => s.site_id === id)
  // default to first non-central site, else first site
  return found ?? sites.find((s) => !s.is_central) ?? sites[0]
}

export async function setCurrentSite(site_id: string) {
  const store = await cookies()
  store.set(SITE_COOKIE, site_id, { path: "/", maxAge: 60 * 60 * 24 * 365 })
  revalidatePath("/", "layout")
  return { success: true }
}

// --- Site CRUD ---
export async function saveSite(input: { site_id?: string | null; name: string; code: string; address?: string | null }) {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()
  const payload = {
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    address: input.address?.trim() || null,
  }
  if (input.site_id) {
    const { error } = await supabase.from("sites").update(payload).eq("site_id", input.site_id)
    if (error) return { success: false, message: error.message }
  } else {
    const { data, error } = await supabase.from("sites").insert(payload).select("site_id").single()
    if (error) return { success: false, message: error.message }
    // create a primary warehouse for the new site
    await supabase.from("warehouses").insert({ site_id: data.site_id, name: "Principal", is_primary: true })
    // create a sale counter for the new site
    await supabase.from("site_counters").insert({ site_id: data.site_id, last_numero: 0 })
  }
  revalidatePath("/admin")
  revalidatePath("/inventory/warehouses")
  return { success: true, message: "Sede guardada." }
}

// --- Warehouse CRUD ---
export async function saveWarehouse(input: {
  warehouse_id?: string | null
  site_id: string
  name: string
  is_primary?: boolean
}) {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()
  const payload = { site_id: input.site_id, name: input.name.trim(), is_primary: input.is_primary ?? false }
  if (input.warehouse_id) {
    const { error } = await supabase.from("warehouses").update(payload).eq("warehouse_id", input.warehouse_id)
    if (error) return { success: false, message: error.message }
  } else {
    const { error } = await supabase.from("warehouses").insert(payload)
    if (error) return { success: false, message: error.message }
  }
  revalidatePath("/inventory/warehouses")
  return { success: true, message: "Bodega guardada." }
}

export async function deleteWarehouse(warehouse_id: string) {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("warehouses").delete().eq("warehouse_id", warehouse_id).eq("is_primary", false)
  if (error) return { success: false, message: "No se puede eliminar la bodega principal o con movimientos." }
  revalidatePath("/inventory/warehouses")
  return { success: true, message: "Bodega eliminada." }
}
