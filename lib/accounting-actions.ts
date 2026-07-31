"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"

export async function getAccountingEntries(site_id: string, opts?: { from?: string; to?: string; type?: string }) {
  await requireRole("admin", "contador", "encargado")
  const supabase = await createServerSupabaseClient()
  let query = supabase.from("accounting_entries").select("*").eq("site_id", site_id).order("entry_date", { ascending: false })
  if (opts?.from) query = query.gte("entry_date", opts.from)
  if (opts?.to) query = query.lte("entry_date", opts.to)
  if (opts?.type && opts.type !== "all") query = query.eq("entry_type", opts.type)
  const { data, error } = await query
  if (error) {
    console.error("Error fetching accounting entries:", error)
    return []
  }
  return data || []
}

export async function createAccountingEntry(input: {
  site_id: string
  entry_type: "income" | "expense"
  category?: string | null
  description?: string | null
  amount: number
  entry_date?: string | null
  sale_id?: string | null
}) {
  await requireRole("admin", "contador")
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("accounting_entries").insert({
    site_id: input.site_id,
    entry_type: input.entry_type,
    category: input.category?.trim() || null,
    description: input.description?.trim() || null,
    amount: input.amount,
    entry_date: input.entry_date || new Date().toISOString(),
    sale_id: input.sale_id || null,
  })
  if (error) return { success: false, message: error.message }
  revalidatePath("/accounting")
  return { success: true, message: "Movimiento registrado." }
}

export async function deleteAccountingEntry(entry_id: string) {
  await requireRole("admin", "contador")
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("accounting_entries").delete().eq("entry_id", entry_id).is("sale_id", null)
  if (error) return { success: false, message: "No se pueden eliminar movimientos de ventas automáticas." }
  revalidatePath("/accounting")
  return { success: true, message: "Movimiento eliminado." }
}

// Intermediate reports: summary + monthly breakdown + balance
export async function getAccountingReport(site_id: string, opts?: { from?: string; to?: string }) {
  const supabase = await createServerSupabaseClient()
  let query = supabase.from("accounting_entries").select("entry_type, category, amount, entry_date").eq("site_id", site_id)
  if (opts?.from) query = query.gte("entry_date", opts.from)
  if (opts?.to) query = query.lte("entry_date", opts.to)
  const { data, error } = await query
  if (error) {
    console.error("Error building report:", error)
    return { income: 0, expense: 0, balance: 0, byMonth: [], byCategory: [] }
  }
  const entries = data || []
  const income = entries.filter((e) => e.entry_type === "income").reduce((s, e) => s + Number(e.amount), 0)
  const expense = entries.filter((e) => e.entry_type === "expense").reduce((s, e) => s + Number(e.amount), 0)

  const monthMap = new Map<string, { month: string; income: number; expense: number }>()
  for (const e of entries) {
    const d = new Date(e.entry_date as string)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const row = monthMap.get(key) || { month: key, income: 0, expense: 0 }
    if (e.entry_type === "income") row.income += Number(e.amount)
    else row.expense += Number(e.amount)
    monthMap.set(key, row)
  }
  const byMonth = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month))

  const catMap = new Map<string, number>()
  for (const e of entries.filter((x) => x.entry_type === "expense")) {
    const key = e.category || "Sin categoría"
    catMap.set(key, (catMap.get(key) || 0) + Number(e.amount))
  }
  const byCategory = Array.from(catMap.entries()).map(([category, amount]) => ({ category, amount }))

  return { income, expense, balance: income - expense, byMonth, byCategory }
}

// Consolidated report across all sites for the admin
export async function getConsolidatedReport() {
  const supabase = await createServerSupabaseClient()
  const { data: sites } = await supabase.from("sites").select("site_id, name, is_central")
  const { data: entries } = await supabase.from("accounting_entries").select("site_id, entry_type, amount")
  const rows = (sites || []).map((s) => {
    const siteEntries = (entries || []).filter((e) => e.site_id === s.site_id)
    const income = siteEntries.filter((e) => e.entry_type === "income").reduce((sum, e) => sum + Number(e.amount), 0)
    const expense = siteEntries.filter((e) => e.entry_type === "expense").reduce((sum, e) => sum + Number(e.amount), 0)
    return { site_id: s.site_id, name: s.name, is_central: s.is_central, income, expense, balance: income - expense }
  })
  return rows
}
