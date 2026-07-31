"use client"

import { createContext, useContext, useCallback } from "react"
import useSWR from "swr"
import { useRouter } from "next/navigation"
import { getSites, getCurrentSiteId, setCurrentSite, type Site } from "@/lib/site-actions"

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
  const { data, isLoading, mutate } = useSWR("site-bootstrap", bootstrap, {
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
