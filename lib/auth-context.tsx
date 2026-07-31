"use client"

import type React from "react"

import { createContext, useContext, useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import type { ModuleKey } from "@/lib/permissions"

export type UserRole = "admin" | "contador" | "encargado" | "vendedor"

interface UserProfile {
  role: UserRole
  site_id: string | null
  full_name: string | null
  is_active: boolean
  permissions: ModuleKey[]
}

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  role: UserRole | null
  assignedSiteId: string | null
  permissions: ModuleKey[]
  accessibleSiteIds: string[] | "all"
  hasPermission: (module: ModuleKey) => boolean
  hasSiteAccess: (siteId: string) => boolean
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signUp: (email: string, password: string) => Promise<{ error: any; needsConfirmation: boolean }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [accessibleSites, setAccessibleSites] = useState<string[] | "all">([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("user_profiles")
      .select("role, site_id, full_name, is_active, permissions")
      .eq("id", userId)
      .single()

    const p = data as any
    if (!p) {
      setProfile(null)
      setAccessibleSites([])
      return
    }
    const normalized: UserProfile = {
      ...p,
      permissions: (p.permissions || []) as ModuleKey[],
    }
    setProfile(normalized)

    if (p.role === "admin" || p.role === "contador") {
      setAccessibleSites("all")
    } else {
      const { data: sites } = await supabase
        .from("user_sites")
        .select("site_id")
        .eq("user_id", userId)
      const ids = new Set<string>()
      ;(sites || []).forEach((r: any) => ids.add(r.site_id))
      if (ids.size === 0 && p.site_id) ids.add(p.site_id)
      setAccessibleSites(Array.from(ids))
    }
  }

  useEffect(() => {
    const getInitialSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const u = session?.user ?? null
      setUser(u)
      if (u) await fetchProfile(u.id)
      setLoading(false)
    }

    getInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event: string, session: any) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        await fetchProfile(u.id)
      } else {
        setProfile(null)
        setAccessibleSites([])
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
      },
    })
    const needsConfirmation = !error && !data.session
    return { error, needsConfirmation }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setAccessibleSites([])
  }

  const hasPermission = (module: ModuleKey) => {
    if (!profile) return false
    if (profile.role === "admin") return true
    return profile.permissions?.includes(module) ?? false
  }

  const hasSiteAccess = (siteId: string) => {
    if (accessibleSites === "all") return true
    return accessibleSites.includes(siteId)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        role: profile?.role ?? null,
        assignedSiteId: profile?.site_id ?? null,
        permissions: profile?.permissions ?? [],
        accessibleSiteIds: accessibleSites,
        hasPermission,
        hasSiteAccess,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
