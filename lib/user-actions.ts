"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"
import { ROLE_DEFAULT_PERMISSIONS, type ModuleKey, type UserRole } from "@/lib/permissions"

export async function getUsers() {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, site_id, is_active, created_at, permissions, sites ( name )")
    .order("created_at", { ascending: false })
  if (error) {
    console.error("Error fetching users:", error)
    return []
  }
  return data || []
}

export async function getSitesForSelect() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("sites")
    .select("site_id, name, is_central")
    .order("name")
  return data || []
}

export async function getUserSiteIds(userId: string): Promise<string[]> {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("user_sites")
    .select("site_id")
    .eq("user_id", userId)
  return (data || []).map((r: any) => r.site_id)
}

async function replaceUserSites(userId: string, siteIds: string[]) {
  const supabase = await createServerSupabaseClient()
  await supabase.from("user_sites").delete().eq("user_id", userId)
  if (siteIds.length > 0) {
    const rows = siteIds.map((sid) => ({ user_id: userId, site_id: sid }))
    const { error } = await supabase.from("user_sites").insert(rows)
    if (error) throw new Error(error.message)
  }
}

async function assertCentralAllowed(role: UserRole, siteIds: string[]) {
  if (role === "admin" || role === "encargado") return
  if (siteIds.length === 0) return
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("sites")
    .select("site_id, is_central")
    .in("site_id", siteIds)
  const hasCentral = (data || []).some((s: any) => s.is_central)
  if (hasCentral) {
    throw new Error("Solo admin o encargado pueden tener acceso a la bodega central.")
  }
}

function normalizePermissions(role: UserRole, permissions?: ModuleKey[]): ModuleKey[] {
  if (role === "admin") return ROLE_DEFAULT_PERMISSIONS.admin
  if (permissions && permissions.length > 0) {
    return Array.from(new Set(permissions))
  }
  return ROLE_DEFAULT_PERMISSIONS[role]
}

export async function createUser(input: {
  email: string
  password: string
  full_name: string
  role: UserRole
  site_id: string | null // sede primaria (compat)
  site_ids?: string[] // sedes adicionales/múltiples
  permissions?: ModuleKey[]
}) {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()

  const perms = normalizePermissions(input.role, input.permissions)

  const { data, error } = await supabase.rpc("admin_create_user", {
    p_email: input.email.trim().toLowerCase(),
    p_password: input.password,
    p_full_name: input.full_name.trim(),
    p_role: input.role,
    p_site_id: input.site_id || null,
  })

  if (error) return { success: false, message: error.message }

  const result = data as any
  if (result?.error) return { success: false, message: result.error }

  const newUserId = result?.user_id as string | undefined

  if (newUserId) {
    const { error: permErr } = await supabase
      .from("user_profiles")
      .update({ permissions: perms })
      .eq("id", newUserId)
    if (permErr) return { success: false, message: permErr.message }

    const siteIds = input.site_ids && input.site_ids.length > 0
      ? input.site_ids
      : (input.site_id ? [input.site_id] : [])

    if (input.role !== "admin" && input.role !== "contador" && siteIds.length > 0) {
      try {
        await assertCentralAllowed(input.role, siteIds)
        await replaceUserSites(newUserId, siteIds)
      } catch (e: any) {
        return { success: false, message: `Usuario creado pero fallo al asignar sedes: ${e.message}` }
      }
    }
  }

  revalidatePath("/users")
  return { success: true, message: `Usuario ${result.email} creado correctamente.` }
}

export async function updateUserProfile(
  userId: string,
  updates: {
    role?: UserRole
    site_id?: string | null
    site_ids?: string[]
    permissions?: ModuleKey[]
    full_name?: string | null
    is_active?: boolean
  },
) {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()

  const profileUpdate: Record<string, any> = {}
  if (updates.role !== undefined) profileUpdate.role = updates.role
  if (updates.site_id !== undefined) profileUpdate.site_id = updates.site_id
  if (updates.full_name !== undefined) profileUpdate.full_name = updates.full_name
  if (updates.is_active !== undefined) profileUpdate.is_active = updates.is_active

  if (updates.permissions !== undefined && updates.role) {
    profileUpdate.permissions = normalizePermissions(updates.role, updates.permissions)
  } else if (updates.permissions !== undefined) {
    profileUpdate.permissions = Array.from(new Set(updates.permissions))
  }

  if (Object.keys(profileUpdate).length > 0) {
    const { error } = await supabase
      .from("user_profiles")
      .update(profileUpdate)
      .eq("id", userId)
    if (error) return { success: false, message: error.message }
  }

  if (updates.site_ids !== undefined) {
    const targetRole = updates.role
    if (targetRole === "admin" || targetRole === "contador") {
      // Roles globales: limpiamos sedes específicas
      await replaceUserSites(userId, [])
    } else {
      try {
        if (targetRole) await assertCentralAllowed(targetRole, updates.site_ids)
        await replaceUserSites(userId, updates.site_ids)
      } catch (e: any) {
        return { success: false, message: `Perfil actualizado pero fallo al asignar sedes: ${e.message}` }
      }
    }
  }

  revalidatePath("/users")
  return { success: true, message: "Usuario actualizado." }
}

export async function resetUserPassword(userId: string, newPassword: string) {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc("admin_reset_password", {
    p_user_id: userId,
    p_new_password: newPassword,
  })

  if (error) return { success: false, message: error.message }
  const result = data as any
  if (result?.error) return { success: false, message: result.error }
  return { success: true, message: "Contraseña actualizada." }
}
