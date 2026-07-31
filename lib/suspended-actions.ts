"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getUserProfile } from "@/lib/auth-helpers"
import { requireRole } from "@/lib/role-guard"

export async function suspendSale(input: {
  site_id: string
  customer_id: string | null
  price_list: string
  items: {
    product_id: string
    name: string
    code: string | null
    quantity: number
    base_price: number
    tax_rate: number
    price: number
    discount: number
  }[]
  notes?: string | null
}) {
  await requireRole("admin", "encargado", "vendedor")
  const profile = await getUserProfile()
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.from("suspended_sales").insert({
    site_id: input.site_id,
    customer_id: input.customer_id || null,
    price_list: input.price_list,
    items: input.items,
    notes: input.notes || null,
    suspended_by: profile?.id ?? null,
  })

  if (error) return { success: false, message: error.message }

  revalidatePath("/pos")
  return { success: true, message: "Venta suspendida correctamente." }
}

export async function getSuspendedSales(siteId: string) {
  await requireRole("admin", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from("suspended_sales")
    .select("*, customers(name)")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching suspended sales:", error)
    return []
  }
  return data || []
}

export async function resumeSuspendedSale(suspendedSaleId: string) {
  await requireRole("admin", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from("suspended_sales")
    .select("*")
    .eq("suspended_sale_id", suspendedSaleId)
    .single()

  if (error || !data) return { success: false, message: "Venta suspendida no encontrada.", sale: null }

  const items = (data.items as any[]) || []
  const productIds = items.map((i) => i.product_id)

  const { data: products } = await supabase
    .from("products")
    .select("product_id, price, wholesale_price, tax_rate, is_active")
    .in("product_id", productIds)

  const productMap = new Map((products || []).map((p) => [p.product_id, p]))

  const revalidated = items
    .filter((item) => {
      const p = productMap.get(item.product_id)
      return p && p.is_active
    })
    .map((item) => {
      const p = productMap.get(item.product_id)!
      let base = Number(item.base_price)
      if (data.price_list === "mayorista" && p.wholesale_price != null) {
        base = Number(p.wholesale_price)
      } else if (data.price_list === "general") {
        base = Number(p.price)
      }
      const tax = Number(p.tax_rate) || 0
      return {
        ...item,
        base_price: base,
        tax_rate: tax,
        price: base * (1 + tax / 100),
      }
    })

  const { error: delErr } = await supabase
    .from("suspended_sales")
    .delete()
    .eq("suspended_sale_id", suspendedSaleId)

  if (delErr) return { success: false, message: delErr.message, sale: null }

  revalidatePath("/pos")
  return {
    success: true,
    message: items.length !== revalidated.length
      ? `Se retomó la venta. ${items.length - revalidated.length} producto(s) ya no disponible(s) fueron removidos.`
      : "Venta retomada correctamente.",
    sale: {
      customer_id: data.customer_id,
      price_list: data.price_list,
      items: revalidated,
    },
  }
}

export async function deleteSuspendedSale(suspendedSaleId: string) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from("suspended_sales")
    .delete()
    .eq("suspended_sale_id", suspendedSaleId)

  if (error) return { success: false, message: error.message }

  revalidatePath("/pos")
  return { success: true, message: "Venta suspendida eliminada." }
}
