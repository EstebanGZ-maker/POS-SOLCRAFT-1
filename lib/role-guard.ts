"use server"

import { getUserProfile, getAccessibleSiteIds, type UserRole } from "@/lib/auth-helpers"
import type { ModuleKey } from "@/lib/permissions"

export async function requireRole(...roles: UserRole[]) {
  const profile = await getUserProfile()
  if (!profile) {
    throw new Error("No autenticado.")
  }
  if (!profile.is_active) {
    throw new Error("Usuario desactivado.")
  }
  if (!roles.includes(profile.role)) {
    throw new Error(`Permiso denegado. Se requiere rol: ${roles.join(" o ")}.`)
  }
  return profile
}

export async function requirePermission(module: ModuleKey) {
  const profile = await getUserProfile()
  if (!profile) throw new Error("No autenticado.")
  if (!profile.is_active) throw new Error("Usuario desactivado.")
  if (profile.role === "admin") return profile
  if (!profile.permissions?.includes(module)) {
    throw new Error(`Permiso denegado. Módulo requerido: ${module}.`)
  }
  return profile
}

export async function requireSite(siteId: string) {
  return requireSiteAccess(siteId)
}

export async function requireSiteAccess(siteId: string) {
  const profile = await getUserProfile()
  if (!profile) throw new Error("No autenticado.")
  if (!profile.is_active) throw new Error("Usuario desactivado.")
  if (profile.role === "admin" || profile.role === "contador") return profile
  const accessible = await getAccessibleSiteIds()
  if (accessible === "all") return profile
  if (!accessible.includes(siteId)) {
    throw new Error("No tienes acceso a esta sede.")
  }
  return profile
}
