"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"

export interface PublicSite {
  site_id: string
  name: string
  address: string | null
  is_central: boolean
}

export interface PublicCatalogItem {
  product_id: string
  code: string
  name: string
  price: number
  description: string | null
  image_url: string | null
  line: string | null
  size: string | null
  available_sites: string[]
  is_available: boolean
}

export interface CatalogFacets {
  lines: { code: string; count: number }[]
  sizes: string[]
}

export interface ProductSizeOption {
  code: string
  size: string | null
  price: number
  is_available: boolean
}

export interface PublicProduct {
  product_id: string
  code: string
  name: string
  price: number
  description: string | null
  image_url: string | null
  images: { url: string; alt: string | null }[]
  category_name: string | null
  available_sites: string[]
}

export interface PublicBusiness {
  business_name: string
  phone: string | null
  email: string | null
  address: string | null
  logo_url: string | null
}

export async function getPublicSites(): Promise<PublicSite[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("public_catalog_sites")
  return (data as PublicSite[]) || []
}

export async function getPublicBusiness(): Promise<PublicBusiness | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("public_catalog_business")
  return (data as PublicBusiness[])?.[0] || null
}

export async function listPublicCatalog(input: {
  site_id?: string | null
  search?: string | null
  only_available?: boolean
  limit?: number
  offset?: number
  line?: string | null
  size?: string | null
}): Promise<PublicCatalogItem[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("public_catalog_list", {
    p_site_id: input.site_id || null,
    p_search: input.search || null,
    p_only_available: input.only_available ?? false,
    p_limit: input.limit ?? 60,
    p_offset: input.offset ?? 0,
    p_line: input.line || null,
    p_size: input.size || null,
  })
  if (error) {
    console.error("catalog list error:", error)
    return []
  }
  return (data as PublicCatalogItem[]) || []
}

export async function getCatalogFacets(): Promise<CatalogFacets> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("public_catalog_facets")
  return (data as CatalogFacets) || { lines: [], sizes: [] }
}

export async function getProductSizes(code: string): Promise<ProductSizeOption[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("public_product_sizes", { p_code: code })
  return (data as ProductSizeOption[]) || []
}

export async function getPublicProduct(code: string): Promise<PublicProduct | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("public_catalog_product", { p_code: code })
  return (data as PublicProduct[])?.[0] || null
}

// ============================================================
// E-commerce: crear pedido y consultar
// ============================================================

export interface PlaceOrderInput {
  items: { product_id: string; quantity: number }[]
  customer_name: string
  customer_phone: string
  customer_email?: string | null
  customer_id_number?: string | null
  delivery_method: "pickup" | "delivery"
  site_id?: string | null   // solo requerido para pickup
  address?: string | null
  city?: string | null
  notes?: string | null
  payment_method: "whatsapp" | "cod" | "wompi"
}

export async function placeWebOrder(input: PlaceOrderInput) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("place_web_order", {
    p_customer_name: input.customer_name,
    p_customer_phone: input.customer_phone,
    p_customer_email: input.customer_email ?? null,
    p_customer_id_number: input.customer_id_number ?? null,
    p_delivery_method: input.delivery_method,
    p_site_id: input.site_id || null,
    p_address: input.address ?? null,
    p_city: input.city ?? null,
    p_notes: input.notes ?? null,
    p_payment_method: input.payment_method,
    p_items: input.items,
  })
  if (error) return { success: false, message: error.message }
  const res = data as any
  if (res?.error) return { success: false, message: res.error }
  return {
    success: true,
    order_id: res.order_id as string,
    order_number: res.order_number as string,
    total: Number(res.total),
  }
}

export async function lookupWebOrder(order_number: string, phone: string) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("public_get_order", {
    p_order_number: order_number,
    p_phone: phone,
  })
  return data as any
}

// Datos públicos del negocio con settings de e-commerce (métodos de pago, sedes, envío)
export interface PublicCommerceConfig {
  business_name: string
  phone: string | null
  email: string | null
  address: string | null
  logo_url: string | null
  whatsapp_number: string | null
  whatsapp_enabled: boolean
  cod_enabled: boolean
  wompi_enabled: boolean
  wompi_public_key: string | null
  pickup_enabled: boolean
  delivery_enabled: boolean
  shipping_cost: number
  free_shipping_over: number | null
  catalog_tagline: string | null
  catalog_hero_subtitle: string | null
  catalog_store_title: string | null
}

export async function getPublicCommerceConfig(): Promise<PublicCommerceConfig> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("public_commerce_config")
  return (data as PublicCommerceConfig) || {
    business_name: "Mi negocio",
    phone: null, email: null, address: null, logo_url: null,
    whatsapp_number: null,
    whatsapp_enabled: true, cod_enabled: true, wompi_enabled: false, wompi_public_key: null,
    pickup_enabled: true, delivery_enabled: true,
    shipping_cost: 0, free_shipping_over: null,
    catalog_tagline: null, catalog_hero_subtitle: null, catalog_store_title: null,
  }
}
