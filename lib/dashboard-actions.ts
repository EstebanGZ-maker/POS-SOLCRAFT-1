"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"

export type DashboardOverview = {
  range: { days: number; from: string; to: string }
  kpis: {
    revenue: number
    revenueChange: number // fraction vs previous period
    salesCount: number
    salesCountChange: number
    avgTicket: number
    avgTicketChange: number
    unitsSold: number
    unitsSoldChange: number
  }
  revenueSparkline: number[]
  salesCountSparkline: number[]
  salesByDay: { date: string; revenue: number; sales: number }[]
  paymentBreakdown: { method: string; amount: number }[]
  topProducts: { name: string; units: number; revenue: number }[]
  categoryBreakdown: { category: string; revenue: number }[]
  lowStock: { name: string; quantity: number; min: number | null }[]
  accounting: { income: number; expense: number; balance: number }
  recentSales: { sale_id: string; customer: string; total: number; method: string | null; date: string }[]
  inventoryValue: number
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 1 : 0
  return (current - previous) / previous
}

export async function getDashboardOverview(site_id: string, days = 30): Promise<DashboardOverview> {
  const supabase = await createServerSupabaseClient()

  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (days - 1))
  from.setHours(0, 0, 0, 0)

  // Previous period (same length, immediately before)
  const prevTo = new Date(from)
  prevTo.setMilliseconds(prevTo.getMilliseconds() - 1)
  const prevFrom = new Date(from)
  prevFrom.setDate(prevFrom.getDate() - days)

  // These four queries are independent of each other: run them in parallel
  // instead of awaiting one after another (was 4 sequential round trips).
  const [warehousesRes, salesRes, prevSalesRes, entriesRes] = await Promise.all([
    // Resolve the site's warehouses for stock/inventory value
    supabase.from("warehouses").select("warehouse_id").eq("site_id", site_id),
    // Current-period sales for this site
    supabase
      .from("sales")
      .select(
        "sale_id, total_amount, payment_method, sale_date, customer_id, customers ( name ), sale_items ( quantity, unit_price, products ( name, categories ( name ) ) )",
      )
      .eq("site_id", site_id)
      .gte("sale_date", from.toISOString())
      .lte("sale_date", to.toISOString())
      .order("sale_date", { ascending: false }),
    // Previous-period sales (totals only, for % change)
    supabase
      .from("sales")
      .select("total_amount, sale_items ( quantity )")
      .eq("site_id", site_id)
      .gte("sale_date", prevFrom.toISOString())
      .lte("sale_date", prevTo.toISOString()),
    // Accounting for the period
    supabase
      .from("accounting_entries")
      .select("entry_type, amount")
      .eq("site_id", site_id)
      .gte("entry_date", from.toISOString())
      .lte("entry_date", to.toISOString()),
  ])

  const warehouseIds = (warehousesRes.data || []).map((w) => w.warehouse_id)
  const sales = salesRes.data
  const prevSales = prevSalesRes.data
  const entries = entriesRes.data

  const curSales = sales || []

  // KPIs
  const revenue = curSales.reduce((s, x) => s + Number(x.total_amount), 0)
  const salesCount = curSales.length
  const unitsSold = curSales.reduce(
    (s, x) => s + (x.sale_items || []).reduce((u: number, i: any) => u + Number(i.quantity || 0), 0),
    0,
  )
  const avgTicket = salesCount > 0 ? revenue / salesCount : 0

  const prevRevenue = (prevSales || []).reduce((s, x) => s + Number(x.total_amount), 0)
  const prevCount = (prevSales || []).length
  const prevUnits = (prevSales || []).reduce(
    (s, x) => s + (x.sale_items || []).reduce((u: number, i: any) => u + Number(i.quantity || 0), 0),
    0,
  )
  const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0

  // Sales by day (fill gaps)
  const byDay = new Map<string, { revenue: number; sales: number }>()
  for (let i = 0; i < days; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    byDay.set(dayKey(d), { revenue: 0, sales: 0 })
  }
  for (const s of curSales) {
    const key = dayKey(new Date(s.sale_date as string))
    const row = byDay.get(key)
    if (row) {
      row.revenue += Number(s.total_amount)
      row.sales += 1
    }
  }
  const salesByDay = Array.from(byDay.entries()).map(([date, v]) => ({ date, revenue: v.revenue, sales: v.sales }))
  const revenueSparkline = salesByDay.map((d) => d.revenue)
  const salesCountSparkline = salesByDay.map((d) => d.sales)

  // Payment breakdown
  const payMap = new Map<string, number>()
  for (const s of curSales) {
    const key = s.payment_method || "Sin especificar"
    payMap.set(key, (payMap.get(key) || 0) + Number(s.total_amount))
  }
  const paymentBreakdown = Array.from(payMap.entries()).map(([method, amount]) => ({ method, amount }))

  // Top products + category breakdown
  const prodMap = new Map<string, { units: number; revenue: number }>()
  const catMap = new Map<string, number>()
  for (const s of curSales) {
    for (const item of (s.sale_items || []) as any[]) {
      const name = item.products?.name || "Producto"
      const lineRevenue = Number(item.unit_price) * Number(item.quantity)
      const p = prodMap.get(name) || { units: 0, revenue: 0 }
      p.units += Number(item.quantity)
      p.revenue += lineRevenue
      prodMap.set(name, p)
      const cat = item.products?.categories?.name || "Sin categoría"
      catMap.set(cat, (catMap.get(cat) || 0) + lineRevenue)
    }
  }
  const topProducts = Array.from(prodMap.entries())
    .map(([name, v]) => ({ name, units: v.units, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
  const categoryBreakdown = Array.from(catMap.entries())
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue)

  // Low stock + inventory value for the site's warehouses
  let lowStock: { name: string; quantity: number; min: number | null }[] = []
  let inventoryValue = 0
  if (warehouseIds.length > 0) {
    const { data: stock } = await supabase
      .from("product_stock")
      .select("quantity, min_quantity, products ( name, cost )")
      .in("warehouse_id", warehouseIds)
    for (const row of (stock || []) as any[]) {
      const qty = Number(row.quantity || 0)
      const min = row.min_quantity != null ? Number(row.min_quantity) : null
      inventoryValue += qty * Number(row.products?.cost || 0)
      const threshold = min ?? 5
      if (qty <= threshold) {
        lowStock.push({ name: row.products?.name || "Producto", quantity: qty, min })
      }
    }
    lowStock = lowStock.sort((a, b) => a.quantity - b.quantity).slice(0, 6)
  }

  // Accounting for the period (fetched in parallel above)
  const income = (entries || []).filter((e) => e.entry_type === "income").reduce((s, e) => s + Number(e.amount), 0)
  const expense = (entries || []).filter((e) => e.entry_type === "expense").reduce((s, e) => s + Number(e.amount), 0)

  // Recent sales
  const recentSales = curSales.slice(0, 6).map((s: any) => ({
    sale_id: s.sale_id,
    customer: s.customers?.name || "Consumidor final",
    total: Number(s.total_amount),
    method: s.payment_method,
    date: s.sale_date,
  }))

  return {
    range: { days, from: from.toISOString(), to: to.toISOString() },
    kpis: {
      revenue,
      revenueChange: pctChange(revenue, prevRevenue),
      salesCount,
      salesCountChange: pctChange(salesCount, prevCount),
      avgTicket,
      avgTicketChange: pctChange(avgTicket, prevAvg),
      unitsSold,
      unitsSoldChange: pctChange(unitsSold, prevUnits),
    },
    revenueSparkline,
    salesCountSparkline,
    salesByDay,
    paymentBreakdown,
    topProducts,
    categoryBreakdown,
    lowStock,
    accounting: { income, expense, balance: income - expense },
    recentSales,
    inventoryValue,
  }
}
