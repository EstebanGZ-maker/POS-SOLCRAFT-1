"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"
import { getUserProfile } from "@/lib/auth-helpers"

export type WebOrderStatus =
  | "pending_payment" | "paid" | "preparing" | "shipped" | "delivered" | "cancelled"

export interface WebOrderRow {
  order_id: string
  order_number: string
  numero: number
  guest_name: string
  guest_phone: string
  guest_email: string | null
  shipping_address: string | null
  shipping_city: string | null
  delivery_method: "pickup" | "delivery"
  payment_method: string
  status: WebOrderStatus
  subtotal: number
  tax_total: number
  shipping_cost: number
  total: number
  notes: string | null
  created_at: string
  sale_id: string | null
  fulfillment_site_id: string | null
  payment_status: "pending" | "approved" | "declined" | "voided" | "error"
  wompi_transaction_id: string | null
  wompi_reference: string | null
  paid_at: string | null
  sites?: { name: string } | null
}

export async function getWebOrders(status?: WebOrderStatus | "all") {
  await requireRole("admin", "encargado", "contador")
  const supabase = await createServerSupabaseClient()
  let q = supabase
    .from("web_orders")
    .select("*, sites:fulfillment_site_id ( name )")
    .order("created_at", { ascending: false })
    .limit(200)

  if (status && status !== "all") q = q.eq("status", status)

  const { data, error } = await q
  if (error) {
    console.error("getWebOrders:", error)
    return []
  }
  return (data || []) as unknown as WebOrderRow[]
}

export async function getWebOrderDetail(orderId: string) {
  await requireRole("admin", "encargado", "contador")
  const supabase = await createServerSupabaseClient()
  const { data: order } = await supabase
    .from("web_orders")
    .select("*, sites:fulfillment_site_id ( name )")
    .eq("order_id", orderId)
    .single()
  if (!order) return null

  const { data: items } = await supabase
    .from("web_order_items")
    .select("*")
    .eq("order_id", orderId)

  return { order: order as unknown as WebOrderRow, items: items || [] }
}

export async function updateWebOrderStatus(orderId: string, status: WebOrderStatus) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("web_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
  if (error) return { success: false, message: error.message }
  revalidatePath("/web-orders")
  return { success: true, message: "Estado actualizado." }
}

// Convierte el pedido en venta real y descuenta stock de la sede elegida
export async function fulfillWebOrder(orderId: string, siteId: string) {
  const profile = await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("fulfill_web_order", {
    p_order_id: orderId,
    p_site_id: siteId,
    p_user_id: profile.id,
  })
  if (error) return { success: false, message: error.message }
  const res = data as any
  if (res?.error) return { success: false, message: res.error }
  revalidatePath("/web-orders")
  revalidatePath("/sales")
  revalidatePath("/inventory/products")
  return { success: true, message: "Pedido convertido en venta. Stock descontado." }
}

export async function getWebOrderCounts() {
  await requireRole("admin", "encargado", "contador")
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from("web_orders").select("status")
  const counts: Record<string, number> = {
    pending_payment: 0, paid: 0, preparing: 0, shipped: 0, delivered: 0, cancelled: 0,
  }
  for (const r of (data || []) as any[]) {
    if (counts[r.status] !== undefined) counts[r.status]++
  }
  return counts
}
