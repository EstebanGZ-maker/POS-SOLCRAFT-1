"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"
import { withPosTiming } from "@/lib/pos-timing"
import {
  fetchWarehouseForSiteRaw,
  fetchCurrentShiftRaw,
  fetchProductsWithStockRaw,
  fetchCustomersRaw,
  fetchCategoriesRaw,
  fetchPriceListsForPOSRaw,
  fetchActivePromotionsForPOSRaw,
  type ShiftBalance,
} from "@/lib/pos-bootstrap-queries"

export interface POSBootstrapErrors {
  warehouse?: string
  shift?: string
  products?: string
  customers?: string
  categories?: string
  priceLists?: string
  promotions?: string
}

export interface POSBootstrap {
  warehouse_id: string | null
  shift: ShiftBalance | null
  products: any[]
  customers: any[]
  categories: any[]
  priceLists: {
    lists: any[]
    priceMap: Record<string, Record<string, number>>
  }
  promotions: {
    promotions: any[]
    promoMap: Record<string, { name: string; discount: number }>
  }
  errors: POSBootstrapErrors
}

const emptyBoot: POSBootstrap = {
  warehouse_id: null,
  shift: null,
  products: [],
  customers: [],
  categories: [],
  priceLists: { lists: [], priceMap: {} },
  promotions: { promotions: [], promoMap: {} },
  errors: {},
}

// Bootstrap consolidado del POS. Reemplaza el waterfall de 6 server actions
// separadas (que Next.js serializa cuando usan cookies) por 1 sola respuesta
// HTTP con Promise.allSettled real server-side sobre supabase-js.
//
// - warehouse_id se resuelve primero (input de products). Si falla, retorno
//   temprano con el resto vacío + errors.warehouse.
// - Los 6 restantes en Promise.allSettled: cada uno decodifica independiente.
//   Falla de una NO afecta a las otras. UI degrada por pieza.
export async function getPOSBootstrap(sid: string): Promise<POSBootstrap> {
  return withPosTiming("getPOSBootstrap", async () => {
    await requireRole("admin", "contador", "encargado", "vendedor")
    const supabase = await createServerSupabaseClient()

    if (!sid) return { ...emptyBoot, errors: { warehouse: "Falta el site_id." } }

    const errors: POSBootstrapErrors = {}

    // Paso 1: warehouse (bloqueante duro — sin él el resto es inútil).
    let warehouse_id: string | null = null
    try {
      warehouse_id = await fetchWarehouseForSiteRaw(supabase, sid)
    } catch (e: any) {
      errors.warehouse = e?.message ?? String(e)
    }
    if (!warehouse_id) {
      return {
        ...emptyBoot,
        errors: {
          warehouse: errors.warehouse ?? "Esta sede no tiene bodega asignada.",
        },
      }
    }

    // Paso 2: allSettled real. Server-to-Supabase HTTP/2 pool paraleliza sin
    // el bloqueo de cookies de Next.js Server Actions.
    const [shiftR, productsR, customersR, categoriesR, priceListsR, promotionsR] =
      await Promise.allSettled([
        fetchCurrentShiftRaw(supabase, sid),
        fetchProductsWithStockRaw(supabase, warehouse_id, { onlyRelevant: true }),
        fetchCustomersRaw(supabase),
        fetchCategoriesRaw(supabase),
        fetchPriceListsForPOSRaw(supabase),
        fetchActivePromotionsForPOSRaw(supabase, sid),
      ])

    function pick<T>(
      r: PromiseSettledResult<T>,
      key: keyof POSBootstrapErrors,
      fallback: T,
    ): T {
      if (r.status === "fulfilled") return r.value
      errors[key] = r.reason?.message ?? String(r.reason)
      return fallback
    }

    return {
      warehouse_id,
      shift: pick(shiftR, "shift", null),
      products: pick(productsR, "products", []),
      customers: pick(customersR, "customers", []),
      categories: pick(categoriesR, "categories", []),
      priceLists: pick(priceListsR, "priceLists", { lists: [], priceMap: {} }),
      promotions: pick(promotionsR, "promotions", {
        promotions: [],
        promoMap: {} as Record<string, { name: string; discount: number }>,
      }),
      errors,
    }
  })
}
