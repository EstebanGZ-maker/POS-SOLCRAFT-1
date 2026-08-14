"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

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
  // Ventas del turno por método
  total_sales: number
  cash_sales: number
  debit_sales: number
  credit_sales: number
  transfer_sales: number
  other_sales: number
  sales_count: number
  // Movimientos manuales de efectivo
  cash_in: number
  cash_out: number
  refunds: number
  // Calculados
  total_movements: number
  expected_cash: number
}

function classifyMethod(method: string | null): "cash" | "debit" | "credit" | "transfer" | "other" {
  const m = (method || "").toLowerCase()
  if (m.includes("efectivo") || m.includes("cash")) return "cash"
  if (m.includes("débito") || m.includes("debito") || m.includes("debit")) return "debit"
  if (m.includes("crédito") || m.includes("credito") || m.includes("credit")) return "credit"
  if (m.includes("transfer")) return "transfer"
  return "other"
}

// Obtiene el turno abierto de una sede junto con su balance del día
export async function getCurrentShift(site_id: string): Promise<ShiftBalance | null> {
  if (!site_id) return null
  const supabase = await createServerSupabaseClient()

  const { data: shift, error } = await supabase
    .from("pos_shifts")
    .select("*")
    .eq("site_id", site_id)
    .eq("status", "open")
    .maybeSingle()

  if (error || !shift) return null

  return buildBalance(supabase, shift)
}

async function buildBalance(supabase: any, shift: any): Promise<ShiftBalance> {
  // Ventas del turno
  const { data: sales } = await supabase
    .from("sales")
    .select("total_amount, payment_method")
    .eq("shift_id", shift.shift_id)

  let cash = 0,
    debit = 0,
    credit = 0,
    transfer = 0,
    other = 0,
    total = 0
  for (const s of sales || []) {
    const amount = Number(s.total_amount) || 0
    total += amount
    switch (classifyMethod(s.payment_method)) {
      case "cash":
        cash += amount
        break
      case "debit":
        debit += amount
        break
      case "credit":
        credit += amount
        break
      case "transfer":
        transfer += amount
        break
      default:
        other += amount
    }
  }

  // Movimientos manuales de efectivo
  const { data: movements } = await supabase
    .from("cash_movements")
    .select("type, amount")
    .eq("shift_id", shift.shift_id)

  let cashIn = 0,
    cashOut = 0,
    refunds = 0
  for (const m of movements || []) {
    const amount = Number(m.amount) || 0
    if (m.type === "income") cashIn += amount
    else if (m.type === "expense") cashOut += amount
    else if (m.type === "refund") refunds += amount
  }

  const initial = Number(shift.initial_cash) || 0
  const expected = initial + cash + cashIn - cashOut - refunds

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
    sales_count: (sales || []).length,
    cash_in: cashIn,
    cash_out: cashOut,
    refunds,
    total_movements: total,
    expected_cash: expected,
  }
}

export async function openShift(input: {
  site_id: string
  warehouse_id?: string | null
  initial_cash: number
  bank_base?: string
  opened_by?: string | null
}) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("open_shift", {
    p_site_id: input.site_id,
    p_warehouse_id: input.warehouse_id ?? null,
    p_initial_cash: input.initial_cash,
    p_bank_base: input.bank_base ?? null,
    p_opened_by: input.opened_by ?? null,
  })
  if (error) return { success: false, message: error.message }
  revalidatePath("/pos")
  return { success: true, message: "Turno abierto." }
}

export async function addCashMovement(input: {
  shift_id: string
  type: "income" | "expense" | "refund"
  amount: number
  description?: string | null
}) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("add_cash_movement", {
    p_shift_id: input.shift_id,
    p_type: input.type,
    p_amount: input.amount,
    p_description: input.description ?? null,
  })
  if (error) return { success: false, message: error.message }
  revalidatePath("/pos")
  return { success: true, message: "Movimiento registrado." }
}

export async function closeShift(input: {
  shift_id: string
  counted_cash: number
  closed_by?: string | null
  notes?: string | null
}) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("close_shift", {
    p_shift_id: input.shift_id,
    p_counted_cash: input.counted_cash,
    p_closed_by: input.closed_by ?? null,
    p_notes: input.notes ?? null,
  })
  if (error) return { success: false, message: error.message }

  revalidatePath("/pos")
  revalidatePath("/accounting")
  const summary = (data ?? {}) as { expected_cash?: number; difference?: number }
  return {
    success: true,
    message: "Turno cerrado.",
    difference: Number(summary.difference ?? 0),
    expected_cash: Number(summary.expected_cash ?? 0),
  }
}

// Historial de turnos por sede
export async function getShiftHistory(site_id: string, limit = 30) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("pos_shifts")
    .select("*")
    .eq("site_id", site_id)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(limit)
  return data || []
}
