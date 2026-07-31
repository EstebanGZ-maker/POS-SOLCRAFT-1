"use client"

import type React from "react"
import { SWRConfig } from "swr"

/**
 * Global SWR defaults tuned for a POS/admin dashboard:
 * - revalidateOnFocus off: avoids a burst of refetches every time the
 *   window regains focus (common when switching tabs at the counter).
 * - dedupingInterval: collapses identical requests fired within 5s into one,
 *   so multiple components asking for the same data hit the server once.
 * - keepPreviousData: keeps showing the last result while a new key loads
 *   (e.g. switching site or date range) so the UI doesn't flash a spinner.
 * - errorRetryCount capped so a failing action doesn't hammer the server.
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateIfStale: false,
        dedupingInterval: 5000,
        keepPreviousData: true,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  )
}
