"use client"

import { createContext, useContext, useCallback } from "react"
import useSWR from "swr"
import { useRouter } from "next/navigation"
import { getSites, getCurrentSiteId, setCurrentSite, type Site } from "@/lib/site-actions"
import { useAuth } from "@/lib/auth-context"

type SiteContextValue = {
  sites: Site[]
  currentSite: Site | null
  isLoading: boolean
  selectSite: (site_id: string) => Promise<void>
  refresh: () => void
}

const SiteContext = createContext<SiteContextValue | null>(null)

async function bootstrap(): Promise<{ sites: Site[]; currentSiteId: string | null }> {
  const [sites, currentSiteId] = await Promise.all([getSites(), getCurrentSiteId()])
  return { sites, currentSiteId }
}

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  // Key condicional dependiente de auth: evita la carrera donde SWR fetchea
  // getSites() antes de que la cookie de sesión esté escrita (server action
  // devolvería [] por getAccessibleSiteIds() sin user, y SWR cachearía []
  // sin revalidar). Con la key ligada a user.id, SWR no dispara hasta que
  // auth resuelva y refetchea limpio al cambiar de usuario (logout/login).
  const swrKey = authLoading ? null : user ? (["site-bootstrap", user.id] as const) : null
  const { data, isLoading, mutate } = useSWR(swrKey, bootstrap, {
    revalidateOnFocus: false,
  })

  const sites = data?.sites ?? []
  const currentSite =
    sites.find((s) => s.site_id === data?.currentSiteId) ?? sites.find((s) => !s.is_central) ?? sites[0] ?? null

  const selectSite = useCallback(
    async (site_id: string) => {
      await setCurrentSite(site_id)
      await mutate({ sites, currentSiteId: site_id }, { revalidate: false })
      router.refresh()
    },
    [mutate, router, sites],
  )

  return (
    <SiteContext.Provider value={{ sites, currentSite, isLoading, selectSite, refresh: () => mutate() }}>
      {children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error("useSite must be used within SiteProvider")
  return ctx
}
