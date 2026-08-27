"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"

export interface BusinessSettings {
  id: number
  business_name: string
  legal_name: string | null
  tax_id: string | null
  phone: string | null
  email: string | null
  regime: string | null
  address: string | null
  logo_url: string | null
  legal_footer: string | null
  custom_phrase: string | null
  template_style: "clasico" | "moderno" | "minimal"
  header_alignment: "left" | "center" | "right"
  paper_width_mm: number
  margin_left_mm: number
  margin_right_mm: number
  show_description: boolean
  show_unit_price: boolean
  show_logo: boolean
  group_product_data: boolean
  show_unit_of_measure: boolean
  show_lines_summary: boolean
  show_tax_summary: boolean
  show_customer_id: boolean
  // E-commerce
  shipping_cost: number
  free_shipping_over: number | null
  whatsapp_number: string | null
  whatsapp_enabled: boolean
  cod_enabled: boolean
  wompi_enabled: boolean
  wompi_public_key: string | null
  wompi_sandbox: boolean
  pickup_enabled: boolean
  delivery_enabled: boolean
  // Catálogo público
  catalog_tagline: string | null
  catalog_hero_subtitle: string | null
  catalog_store_title: string | null
  catalog_model_url: string | null
}

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from("business_settings").select("*").eq("id", 1).maybeSingle()
  if (!data) {
    return {
      id: 1,
      business_name: "Mi negocio",
      legal_name: null,
      tax_id: null,
      phone: null,
      email: null,
      regime: "Responsable de IVA",
      address: null,
      logo_url: null,
      legal_footer: null,
      custom_phrase: null,
      template_style: "clasico",
      header_alignment: "center",
      paper_width_mm: 80,
      margin_left_mm: 2,
      margin_right_mm: 2,
      show_description: false,
      show_unit_price: true,
      show_logo: false,
      group_product_data: false,
      show_unit_of_measure: false,
      show_lines_summary: true,
      show_tax_summary: true,
      show_customer_id: true,
      shipping_cost: 0,
      free_shipping_over: null,
      whatsapp_number: null,
      whatsapp_enabled: true,
      cod_enabled: true,
      wompi_enabled: false,
      wompi_public_key: null,
      wompi_sandbox: true,
      pickup_enabled: true,
      delivery_enabled: true,
      catalog_tagline: null,
      catalog_hero_subtitle: null,
      catalog_store_title: null,
      catalog_model_url: null,
    }
  }
  return data as BusinessSettings
}

export async function updateBusinessSettings(updates: Partial<BusinessSettings>) {
  const profile = await requireRole("admin")
  const supabase = await createServerSupabaseClient()
  const payload: any = { ...updates, updated_at: new Date().toISOString(), updated_by: profile.id }
  delete payload.id
  const { error } = await supabase.from("business_settings").update(payload).eq("id", 1)
  if (error) return { success: false, message: error.message }
  revalidatePath("/settings/receipt")
  revalidatePath("/pos")
  return { success: true, message: "Configuración guardada." }
}

// Datos completos para imprimir un recibo/factura
export async function getReceiptData(saleId: string) {
  const supabase = await createServerSupabaseClient()

  const { data: sale } = await supabase
    .from("sales")
    .select(`
      sale_id, numero, sale_date, seller, payment_method, amount_received,
      total_amount, subtotal, discount_total, tax_total, status,
      customers ( name, phone, email, id_type, id_number, address ),
      sites ( name ),
      sale_items (
        sale_item_id, product_id, quantity, unit_price, discount, tax_rate,
        products ( name, code, description, unit )
      )
    `)
    .eq("sale_id", saleId)
    .single()

  if (!sale) return null

  const business = await getBusinessSettings()

  const items = ((sale as any).sale_items || []).map((it: any) => ({
    name: it.products?.name || "—",
    code: it.products?.code || null,
    description: it.products?.description || null,
    unit: it.products?.unit || null,
    quantity: it.quantity,
    unit_price: Number(it.unit_price),
    discount: Number(it.discount || 0),
    tax_rate: Number(it.tax_rate || 0),
    subtotal: Number(it.unit_price) * it.quantity,
  }))

  const customer = (sale as any).customers
  const site = (sale as any).sites

  return {
    business,
    sale: {
      sale_id: (sale as any).sale_id,
      numero: (sale as any).numero,
      date: (sale as any).sale_date,
      seller: (sale as any).seller,
      payment_method: (sale as any).payment_method,
      amount_received: (sale as any).amount_received != null ? Number((sale as any).amount_received) : null,
      total: Number((sale as any).total_amount),
      subtotal: (sale as any).subtotal != null ? Number((sale as any).subtotal) : null,
      discount_total: Number((sale as any).discount_total || 0),
      tax_total: Number((sale as any).tax_total || 0),
      status: (sale as any).status,
    },
    site_name: site?.name || null,
    customer: customer
      ? {
          name: customer.name,
          phone: customer.phone,
          id_type: customer.id_type,
          id_number: customer.id_number,
          address: customer.address,
        }
      : null,
    items,
  }
}
