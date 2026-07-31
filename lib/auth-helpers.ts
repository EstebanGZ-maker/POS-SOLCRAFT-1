"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { ModuleKey, UserRole } from "@/lib/permissions"

export type { UserRole } from "@/lib/permissions"

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  site_id: string | null
  is_active: boolean
  permissions: ModuleKey[]
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, site_id, is_active, permissions")
    .eq("id", user.id)
    .single()

  if (!data) return null
  return {
    ...(data as any),
    permissions: (data as any).permissions || [],
  } as UserProfile
}

// Devuelve los site_ids a los que el usuario actual tiene acceso.
// admin/contador: todas las sedes; encargado/vendedor: sus sedes asignadas
// (user_sites) más el site_id de user_profiles como fallback.
export async function getAccessibleSiteIds(): Promise<string[] | "all"> {
  const supabase = await createServerSupabaseClient()
  const profile = await getUserProfile()
  if (!profile) return []

  if (profile.role === "admin" || profile.role === "contador") return "all"

  const { data: linked } = await supabase
    .from("user_sites")
    .select("site_id")
    .eq("user_id", profile.id)

  const ids = new Set<string>()
  ;(linked || []).forEach((r: any) => ids.add(r.site_id))
  if (ids.size === 0 && profile.site_id) ids.add(profile.site_id)
  return Array.from(ids)
}
