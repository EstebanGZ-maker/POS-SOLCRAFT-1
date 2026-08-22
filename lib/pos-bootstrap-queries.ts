// Helpers puros de queries del bootstrap POS. Sin "use server" — reciben
// el supabase client ya creado y NO ejecutan requireRole. Quien las llama
// (server actions públicas + getPOSBootstrap) debe hacer el guard de rol
// antes.
//
// Extraídas para que la lógica de query + mapeo (products/stock, priceMap,
// promoMap, cálculo de shift balance) exista en UN SOLO LUGAR y no pueda
// desincronizarse entre el bootstrap consolidado y las server actions
// legacy que otros callers usan (ej. refreshData post-venta).

export interface ShiftBalance {
  shift_id: string
  number: number
  site_id: string
  warehouse_id: string | null
  status: string
  initial_cash: number
  bank_base: string | null
  opened_by: string | null
  opened_at: string
  total_sales: number
  cash_sales: number
  debit_sales: number
  credit_sales: number
  transfer_sales: number
  other_sales: number
  sales_count: number
  cash_in: number
  cash_out: number
  refunds: number
  total_movements: number
  expected_cash: number
}

export function classifyMethod(
  method: string | null,
): "cash" | "debit" | "credit" | "transfer" | "other" {
  const m = (method || "").toLowerCase()
  if (m.includes("efectivo") || m.includes("cash")) return "cash"
  if (m.includes("débito") || m.includes("debito") || m.includes("debit")) return "debit"
  if (m.includes("crédito") || m.includes("credito") || m.includes("credit")) return "credit"
  if (m.includes("transfer")) return "transfer"
  return "other"
}

export async function fetchShiftBalanceRaw(supabase: any, shift: any): Promise<ShiftBalance> {
  const { data: rpc, error: rpcErr } = await supabase.rpc("get_shift_balance", {
    p_shift_id: shift.shift_id,
  })
  if (rpcErr) {
    console.error("get_shift_balance:", rpcErr)
    throw rpcErr
  }
  const initial = Number(rpc.initial_cash) || 0
  const cash = Number(rpc.cash_in_shift) || 0
  const nonCash = Number(rpc.non_cash_in_shift) || 0
  const cashIn = Number(rpc.cash_movements_income) || 0
  const cashOut = Number(rpc.cash_movements_expense) || 0
  const refunds = Number(rpc.cash_movements_refund) || 0
  const expected = Number(rpc.expected_cash) || 0
  const total = cash + nonCash

  const { count: salesCount } = await supabase
    .from("sales")
    .select("sale_id", { count: "exact", head: true })
    .eq("shift_id", shift.shift_id)
    .eq("status", "active")

  const { data: payments } = await supabase
    .from("sale_payments")
    .select("amount, payment_method")
    .eq("shift_id", shift.shift_id)
    .eq("status", "active")

  let debit = 0, credit = 0, transfer = 0, other = 0
  for (const p of payments || []) {
    const amount = Number(p.amount) || 0
    switch (classifyMethod(p.payment_method)) {
      case "cash": break
      case "debit": debit += amount; break
      case "credit": credit += amount; break
      case "transfer": transfer += amount; break
      default: other += amount
    }
  }

  return {
    shift_id: shift.shift_id,
    number: shift.number,
    site_id: shift.site_id,
    warehouse_id: shift.warehouse_id,
    status: shift.status,
    initial_cash: initial,
    bank_base: shift.bank_base,
    opened_by: shift.opened_by,
    opened_at: shift.opened_at,
    total_sales: total,
    cash_sales: cash,
    debit_sales: debit,
    credit_sales: credit,
    transfer_sales: transfer,
    other_sales: other,
    sales_count: salesCount ?? 0,
    cash_in: cashIn,
    cash_out: cashOut,
    refunds,
    total_movements: total,
    expected_cash: expected,
  }
}

export async function fetchCurrentShiftRaw(
  supabase: any,
  site_id: string,
): Promise<ShiftBalance | null> {
  if (!site_id) return null
  const { data: shift, error } = await supabase
    .from("pos_shifts")
    .select("*")
    .eq("site_id", site_id)
    .eq("status", "open")
    .maybeSingle()
  if (error || !shift) return null
  return fetchShiftBalanceRaw(supabase, shift)
}

export async function fetchWarehouseForSiteRaw(
  supabase: any,
  site_id: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("warehouses")
    .select("warehouse_id")
    .eq("site_id", site_id)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data.warehouse_id
}

export async function fetchProductsWithStockRaw(
  supabase: any,
  warehouse_id?: string | null,
  opts?: { onlyRelevant?: boolean },
) {
  const useInner = Boolean(warehouse_id) && Boolean(opts?.onlyRelevant)
  const stockSelect = useInner
    ? "product_stock!inner ( warehouse_id, quantity, min_quantity, max_quantity )"
    : "product_stock ( warehouse_id, quantity, min_quantity, max_quantity )"
  let query = supabase
    .from("products")
    .select(`*, categories ( category_id, name ), ${stockSelect}`)
    .eq("is_active", true)
    .order("name", { ascending: true })
  if (useInner) {
    query = query.eq("product_stock.warehouse_id", warehouse_id!)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []).map((p: any) => {
    const stockRows = p.product_stock || []
    const totalStock = stockRows.reduce((s: number, r: any) => s + (r.quantity || 0), 0)
    const warehouseStock =
      warehouse_id
        ? (stockRows.find((r: any) => r.warehouse_id === warehouse_id)?.quantity ?? 0)
        : null
    return { ...p, totalStock, warehouseStock }
  })
}

export async function fetchCustomersRaw(supabase: any) {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("name", { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchCategoriesRaw(supabase: any) {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("name", { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchPriceListsForPOSRaw(supabase: any) {
  const [listsRes, pricesRes] = await Promise.all([
    supabase.from("price_lists").select("price_list_id, name, is_default").order("name"),
    supabase.from("product_prices").select("product_id, price_list_id, price"),
  ])
  if (listsRes.error) throw new Error(listsRes.error.message)
  if (pricesRes.error) throw new Error(pricesRes.error.message)
  const priceMap: Record<string, Record<string, number>> = {}
  for (const pp of pricesRes.data || []) {
    if (!priceMap[pp.price_list_id]) priceMap[pp.price_list_id] = {}
    priceMap[pp.price_list_id][pp.product_id] = Number(pp.price)
  }
  return { lists: listsRes.data || [], priceMap }
}

export async function fetchActivePromotionsForPOSRaw(
  supabase: any,
  siteId: string | null,
) {
  const today = new Date().toISOString().split("T")[0]
  let query = supabase
    .from("promotions")
    .select("promotion_id, name, discount_percent, site_id, promotion_products ( product_id )")
    .eq("is_active", true)
    .or(`start_date.is.null,start_date.lte.${today}`)
    .or(`end_date.is.null,end_date.gte.${today}`)
  if (siteId) {
    query = query.or(`site_id.is.null,site_id.eq.${siteId}`)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const promoMap: Record<string, { name: string; discount: number }> = {}
  for (const promo of data || []) {
    const linked = (promo.promotion_products as any[]) || []
    if (linked.length === 0) continue
    for (const link of linked) {
      const existing = promoMap[link.product_id]
      if (!existing || promo.discount_percent > existing.discount) {
        promoMap[link.product_id] = { name: promo.name, discount: Number(promo.discount_percent) }
      }
    }
  }
  return { promotions: data || [], promoMap }
}
