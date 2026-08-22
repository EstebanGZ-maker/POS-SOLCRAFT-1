"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { withPosTiming } from "@/lib/pos-timing"
import {
  fetchCurrentShiftRaw,
  fetchShiftBalanceRaw,
  type ShiftBalance,
} from "@/lib/pos-bootstrap-queries"

// Re-export para consumidores externos que importaban ShiftBalance desde aquí.
export type { ShiftBalance }

// Obtiene el turno abierto de una sede junto con su balance del día.
// La lógica pura vive en lib/pos-bootstrap-queries.ts (compartida con
// getPOSBootstrap consolidado); esta es solo el wrapper con auth + client.
export async function getCurrentShift(site_id: string): Promise<ShiftBalance | null> {
  return withPosTiming("getCurrentShift", async () => {
    const supabase = await createServerSupabaseClient()
    return fetchCurrentShiftRaw(supabase, site_id)
  })
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
