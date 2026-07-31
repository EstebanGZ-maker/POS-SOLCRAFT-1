"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/role-guard"
import { getUserProfile, getAccessibleSiteIds } from "@/lib/auth-helpers"

// ============ PRODUCTS (extended) ============
// Products with their stock in a specific warehouse (or total if no warehouse)
export async function getProductsWithStock(warehouse_id?: string | null) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .select("*, categories ( category_id, name ), product_stock ( warehouse_id, quantity, min_quantity, max_quantity )")
    .order("name", { ascending: true })
  if (error) {
    console.error("Error fetching products with stock:", error)
    return []
  }
  return (data || []).map((p: any) => {
    const stockRows = p.product_stock || []
    const totalStock = stockRows.reduce((s: number, r: any) => s + (r.quantity || 0), 0)
    const warehouseStock = warehouse_id
      ? (stockRows.find((r: any) => r.warehouse_id === warehouse_id)?.quantity ?? 0)
      : totalStock
    return { ...p, totalStock, warehouseStock }
  })
}

export async function getProductById(product_id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .select("*, categories ( category_id, name ), product_stock ( * ), product_prices ( * )")
    .eq("product_id", product_id)
    .single()
  if (error) {
    console.error("Error fetching product:", error)
    return null
  }
  return data
}

export async function saveProduct(input: {
  product_id?: string | null
  name: string
  code?: string | null
  description?: string | null
  category_id?: string | null
  unit?: string
  cost?: number
  price: number
  tax_rate?: number
  is_service?: boolean
  is_active?: boolean
  is_favorite?: boolean
  barcode?: string | null
  size?: string | null
  image_url?: string | null
  type_prefix?: string | null
  // initial stock at central warehouse for new products
  initial_stock?: number
  initial_warehouse_id?: string | null
}) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const clean = (v?: string | null) => (v && v.trim() !== "" ? v.trim() : null)

  const payload: any = {
    name: input.name.trim(),
    code: clean(input.code),
    description: clean(input.description),
    category_id: input.category_id || null,
    unit: input.unit || "Unidad",
    cost: input.cost ?? 0,
    price: input.price,
    tax_rate: input.tax_rate ?? 0,
    is_service: input.is_service ?? false,
    is_active: input.is_active ?? true,
    is_favorite: input.is_favorite ?? false,
    barcode: clean(input.barcode),
    size: clean(input.size),
    image_url: clean(input.image_url),
    type_prefix: input.type_prefix ? input.type_prefix.trim().toUpperCase() : null,
  }

  let product_id = input.product_id || null

  if (product_id) {
    const { error } = await supabase.from("products").update(payload).eq("product_id", product_id)
    if (error) {
      console.error("Error updating product:", error)
      return { success: false, message: error.message }
    }
  } else {
    payload.stock_quantity = input.initial_stock ?? 0
    const { data, error } = await supabase.from("products").insert(payload).select("product_id").single()
    if (error) {
      console.error("Error creating product:", error)
      return { success: false, message: error.message }
    }
    product_id = data.product_id

    // Add price to the default price list
    const { data: defList } = await supabase.from("price_lists").select("price_list_id").eq("is_default", true).limit(1).maybeSingle()
    if (defList) {
      await supabase.from("product_prices").upsert({ product_id, price_list_id: defList.price_list_id, price: input.price })
    }

    if (!input.is_service && input.initial_stock && input.initial_warehouse_id) {
      const { error: stockErr } = await supabase.rpc("adjust_warehouse_stock", {
        p_product_id: product_id,
        p_warehouse_id: input.initial_warehouse_id,
        p_delta: input.initial_stock,
        p_movement_type: "apertura",
        p_reference_type: "migration",
        p_notes: "Stock inicial al crear producto",
      })
      if (stockErr) return { success: false, message: stockErr.message }
    }
  }

  // Si se subió una foto por el control simple y el producto aún no tiene
  // galería, registrarla como principal para que ambos caminos converjan.
  const cleanImage = clean(input.image_url)
  if (product_id && cleanImage) {
    const { data: existing } = await supabase
      .from("product_images")
      .select("image_id")
      .eq("product_id", product_id)
      .limit(1)

    if (!existing || existing.length === 0) {
      await supabase.from("product_images").insert({
        product_id,
        url: cleanImage,
        sort_order: 0,
        is_primary: true,
      })
    }
  }

  revalidatePath("/inventory/products")
  revalidatePath("/pos")
  revalidatePath("/catalog")
  return { success: true, message: "Producto guardado correctamente.", product_id }
}

export async function deleteProductSafe(product_id: string) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const { data: saleItems } = await supabase.from("sale_items").select("sale_item_id").eq("product_id", product_id).limit(1)
  if (saleItems && saleItems.length > 0) {
    // soft-delete instead
    await supabase.from("products").update({ is_active: false }).eq("product_id", product_id)
    revalidatePath("/inventory/products")
    return { success: true, message: "Producto tiene ventas: se desactivó en lugar de eliminarse." }
  }
  const { error } = await supabase.from("products").delete().eq("product_id", product_id)
  if (error) return { success: false, message: error.message }
  revalidatePath("/inventory/products")
  return { success: true, message: "Producto eliminado." }
}

// ============ CATEGORIES ============
export async function saveCategory(name: string, category_id?: string | null) {
  const supabase = await createServerSupabaseClient()
  if (category_id) {
    const { error } = await supabase.from("categories").update({ name: name.trim() }).eq("category_id", category_id)
    if (error) return { success: false, message: error.message }
  } else {
    const { error } = await supabase.from("categories").insert({ name: name.trim() })
    if (error) return { success: false, message: error.message }
  }
  revalidatePath("/inventory/management")
  revalidatePath("/inventory/products")
  return { success: true, message: "Categoría guardada." }
}

export async function deleteCategory(category_id: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("categories").delete().eq("category_id", category_id)
  if (error) return { success: false, message: error.message }
  revalidatePath("/inventory/management")
  return { success: true, message: "Categoría eliminada." }
}

// ============ PRICE LISTS ============
export async function getPriceLists() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from("price_lists").select("*").order("name")
  if (error) {
    console.error("Error fetching price lists:", error)
    return []
  }
  return data || []
}

export async function getPriceListsForPOS() {
  const supabase = await createServerSupabaseClient()
  const [{ data: lists }, { data: prices }] = await Promise.all([
    supabase.from("price_lists").select("price_list_id, name, is_default").order("name"),
    supabase.from("product_prices").select("product_id, price_list_id, price"),
  ])
  const priceMap: Record<string, Record<string, number>> = {}
  for (const pp of prices || []) {
    if (!priceMap[pp.price_list_id]) priceMap[pp.price_list_id] = {}
    priceMap[pp.price_list_id][pp.product_id] = Number(pp.price)
  }
  return {
    lists: lists || [],
    priceMap,
  }
}

export async function getPriceListWithProducts(price_list_id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .select("product_id, name, code, price, product_prices ( price, price_list_id )")
    .order("name")
  if (error) return []
  return (data || []).map((p: any) => ({
    ...p,
    listPrice: p.product_prices?.find((pp: any) => pp.price_list_id === price_list_id)?.price ?? null,
  }))
}

export async function savePriceList(name: string, price_list_id?: string | null) {
  const supabase = await createServerSupabaseClient()
  if (price_list_id) {
    const { error } = await supabase.from("price_lists").update({ name: name.trim() }).eq("price_list_id", price_list_id)
    if (error) return { success: false, message: error.message }
  } else {
    const { error } = await supabase.from("price_lists").insert({ name: name.trim() })
    if (error) return { success: false, message: error.message }
  }
  revalidatePath("/inventory/price-lists")
  return { success: true, message: "Lista de precios guardada." }
}

export async function setProductPrice(product_id: string, price_list_id: string, price: number) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("product_prices").upsert({ product_id, price_list_id, price })
  if (error) return { success: false, message: error.message }
  revalidatePath("/inventory/price-lists")
  return { success: true, message: "Precio actualizado." }
}

export async function deletePriceList(price_list_id: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("price_lists").delete().eq("price_list_id", price_list_id).eq("is_default", false)
  if (error) return { success: false, message: error.message }
  revalidatePath("/inventory/price-lists")
  return { success: true, message: "Lista eliminada." }
}

// ============ PROMOTIONS ============
export async function getPromotions() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("promotions")
    .select("*, sites ( name )")
    .order("created_at", { ascending: false })
  if (error) {
    console.error("Error fetching promotions:", error)
    return []
  }
  return data || []
}

export async function getActivePromotionsForPOS(siteId: string | null) {
  const supabase = await createServerSupabaseClient()
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
  if (error) {
    console.error("Error fetching active promotions:", error)
    return { promotions: [], promoMap: {} as Record<string, { name: string; discount: number }> }
  }

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

export async function savePromotion(input: {
  promotion_id?: string | null
  name: string
  description?: string | null
  discount_percent: number
  start_date?: string | null
  end_date?: string | null
  is_active?: boolean
  site_id?: string | null
}) {
  const supabase = await createServerSupabaseClient()
  const payload = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    discount_percent: input.discount_percent,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    is_active: input.is_active ?? true,
    site_id: input.site_id || null,
  }
  if (input.promotion_id) {
    const { error } = await supabase.from("promotions").update(payload).eq("promotion_id", input.promotion_id)
    if (error) return { success: false, message: error.message }
  } else {
    const { error } = await supabase.from("promotions").insert(payload)
    if (error) return { success: false, message: error.message }
  }
  revalidatePath("/inventory/promotions")
  return { success: true, message: "Promoción guardada." }
}

export async function deletePromotion(promotion_id: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("promotions").delete().eq("promotion_id", promotion_id)
  if (error) return { success: false, message: error.message }
  revalidatePath("/inventory/promotions")
  return { success: true, message: "Promoción eliminada." }
}

// ============ INVENTORY ADJUSTMENTS ============
export async function getAdjustments() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("inventory_adjustments")
    .select("*, warehouses ( name, sites ( name ) ), adjustment_items ( adjustment_item_id )")
    .order("adjustment_date", { ascending: false })
  if (error) {
    console.error("Error fetching adjustments:", error)
    return []
  }
  return data || []
}

export async function getAdjustmentById(adjustment_id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("inventory_adjustments")
    .select("*, warehouses ( warehouse_id, name ), adjustment_items ( *, products ( name, code ) )")
    .eq("adjustment_id", adjustment_id)
    .single()
  if (error) return null
  return data
}

export async function createAdjustment(input: {
  warehouse_id: string
  notes?: string | null
  items: { product_id: string; cost: number; objective: "incrementar" | "disminuir"; quantity: number }[]
}) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const total = input.items.reduce((s, it) => s + it.cost * it.quantity, 0)

  const { data: adj, error } = await supabase
    .from("inventory_adjustments")
    .insert({ warehouse_id: input.warehouse_id, notes: input.notes || null, total_adjusted: total })
    .select("adjustment_id")
    .single()
  if (error) return { success: false, message: error.message }

  const itemsToInsert = input.items.map((it) => ({
    adjustment_id: adj.adjustment_id,
    product_id: it.product_id,
    cost: it.cost,
    objective: it.objective,
    quantity: it.quantity,
  }))
  const { error: itemsErr } = await supabase.from("adjustment_items").insert(itemsToInsert)
  if (itemsErr) {
    await supabase.from("inventory_adjustments").delete().eq("adjustment_id", adj.adjustment_id)
    return { success: false, message: itemsErr.message }
  }

  const profile = await getUserProfile()
  const stockResults = await Promise.all(
    input.items.map((it) =>
      supabase.rpc("adjust_warehouse_stock", {
        p_product_id: it.product_id,
        p_warehouse_id: input.warehouse_id,
        p_delta: it.objective === "incrementar" ? it.quantity : -it.quantity,
        p_movement_type: "ajuste",
        p_reference_type: "adjustment",
        p_reference_id: adj.adjustment_id,
        p_user_id: profile?.id ?? null,
        p_notes: input.notes || null,
      }),
    ),
  )
  const stockErr = stockResults.find((r) => r.error)
  if (stockErr?.error) {
    return { success: false, message: stockErr.error.message }
  }

  revalidatePath("/inventory/adjustments")
  revalidatePath("/inventory/products")
  return { success: true, message: "Ajuste creado correctamente." }
}

export async function deleteAdjustment(adjustment_id: string) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const profile = await getUserProfile()
  const { data: adj } = await supabase
    .from("inventory_adjustments")
    .select("warehouse_id, adjustment_items ( product_id, objective, quantity )")
    .eq("adjustment_id", adjustment_id)
    .single()
  if (adj) {
    const revertResults = await Promise.all(
      ((adj as any).adjustment_items || []).map((it: any) =>
        supabase.rpc("adjust_warehouse_stock", {
          p_product_id: it.product_id,
          p_warehouse_id: (adj as any).warehouse_id,
          p_delta: it.objective === "incrementar" ? -it.quantity : it.quantity,
          p_movement_type: "ajuste",
          p_reference_type: "adjustment",
          p_reference_id: adjustment_id,
          p_user_id: profile?.id ?? null,
          p_notes: "Reversión por eliminación de ajuste",
        }),
      ),
    )
    const revertErr = revertResults.find((r) => r.error)
    if (revertErr?.error) {
      return { success: false, message: revertErr.error.message }
    }
  }
  const { error } = await supabase.from("inventory_adjustments").delete().eq("adjustment_id", adjustment_id)
  if (error) return { success: false, message: error.message }
  revalidatePath("/inventory/adjustments")
  revalidatePath("/inventory/products")
  return { success: true, message: "Ajuste eliminado y stock revertido." }
}

// ============ TRANSFERS (envíos) ============

/**
 * Bodegas desde las que el usuario puede despachar.
 * Admin/contador: todas. Encargado: las de sus sedes asignadas.
 */
export async function getOriginWarehouses() {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const accessible = await getAccessibleSiteIds()

  let query = supabase
    .from("warehouses")
    .select("warehouse_id, name, site_id, is_primary, sites ( name, is_central )")
    .eq("is_system", false)
    .order("name")

  if (accessible !== "all") {
    if (accessible.length === 0) return []
    query = query.in("site_id", accessible)
  }

  const { data } = await query
  return data || []
}

/**
 * Productos con existencia en la bodega origen, junto con el stock que hay
 * de cada uno en las bodegas destino — para decidir cuánto mandar.
 */
export async function getTransferStockView(input: {
  from_warehouse_id: string
  to_warehouse_ids: string[]
}) {
  const profile = await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  // El encargado solo consulta bodegas de sus sedes
  if (profile.role === "encargado") {
    const { data: wh } = await supabase
      .from("warehouses")
      .select("site_id")
      .eq("warehouse_id", input.from_warehouse_id)
      .maybeSingle()
    const accessible = await getAccessibleSiteIds()
    const allowed =
      Boolean(wh) && (accessible === "all" || accessible.includes(wh!.site_id))
    if (!allowed) return []
  }

  const allWarehouses = [input.from_warehouse_id, ...input.to_warehouse_ids]

  const { data: rows, error } = await supabase
    .from("product_stock")
    .select(`
      product_id, warehouse_id, quantity,
      products ( product_id, code, name, image_url, size, price, is_active )
    `)
    .in("warehouse_id", allWarehouses)

  if (error) {
    console.error("Error fetching transfer stock view:", error)
    return []
  }

  // Agrupar por producto: existencia en origen + desglose por destino
  const byProduct = new Map<string, any>()

  for (const r of (rows || []) as any[]) {
    const p = r.products
    if (!p || !p.is_active) continue

    if (!byProduct.has(r.product_id)) {
      byProduct.set(r.product_id, {
        product_id: r.product_id,
        code: p.code,
        name: p.name,
        image_url: p.image_url,
        size: p.size,
        price: Number(p.price),
        origin_qty: 0,
        destinations: {} as Record<string, number>,
      })
    }
    const entry = byProduct.get(r.product_id)

    if (r.warehouse_id === input.from_warehouse_id) {
      entry.origin_qty = r.quantity
    } else {
      entry.destinations[r.warehouse_id] = r.quantity
    }
  }

  // Solo tiene sentido enviar lo que existe en origen
  return Array.from(byProduct.values())
    .filter((p) => p.origin_qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getTransfers() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("transfers")
    .select(
      "*, from_wh:warehouses!transfers_from_warehouse_id_fkey ( name, sites ( name ) ), to_wh:warehouses!transfers_to_warehouse_id_fkey ( name, sites ( name ) ), transfer_items ( transfer_item_id, quantity )",
    )
    .order("transfer_date", { ascending: false })
  if (error) {
    console.error("Error fetching transfers:", error)
    return []
  }
  return data || []
}

export async function updateWholesalePrices(updates: { product_id: string; wholesale_price: number }[]) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  for (const u of updates) {
    await supabase
      .from("products")
      .update({ wholesale_price: u.wholesale_price })
      .eq("product_id", u.product_id)
  }
  revalidatePath("/central")
  revalidatePath("/inventory/products")
  return { success: true, message: "Precios mayorista actualizados." }
}

// Send stock from one warehouse to many destinations (via transit)
export async function createBulkTransfer(input: {
  from_warehouse_id: string
  to_warehouse_ids: string[]
  notes?: string | null
  items: { product_id: string; quantity: number }[]
}) {
  const profile = await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  // El encargado solo puede despachar desde bodegas de SUS sedes.
  // Sin esto, podría enviar stock desde central o desde otra sede.
  const { data: originWh } = await supabase
    .from("warehouses")
    .select("warehouse_id, site_id")
    .eq("warehouse_id", input.from_warehouse_id)
    .maybeSingle()

  if (!originWh) {
    return { success: false, message: "La bodega de origen no existe." }
  }

  if (profile.role === "encargado") {
    const accessible = await getAccessibleSiteIds()
    const allowed = accessible === "all" || accessible.includes(originWh.site_id)
    if (!allowed) {
      return { success: false, message: "No puedes enviar mercancía desde esta sede." }
    }
  }

  // No tiene sentido enviarse a sí mismo
  if (input.to_warehouse_ids.includes(input.from_warehouse_id)) {
    return { success: false, message: "El origen y el destino no pueden ser la misma bodega." }
  }

  // La bodega de Tránsito la maneja el sistema: no puede elegirse como destino
  const { data: destWhs } = await supabase
    .from("warehouses")
    .select("warehouse_id, is_system")
    .in("warehouse_id", input.to_warehouse_ids)

  if ((destWhs || []).length !== input.to_warehouse_ids.length) {
    return { success: false, message: "Alguna bodega de destino no existe." }
  }
  if ((destWhs || []).some((w) => w.is_system)) {
    return { success: false, message: "No se puede enviar a una bodega del sistema." }
  }

  // Find the transit warehouse
  const { data: transitWh } = await supabase
    .from("warehouses")
    .select("warehouse_id")
    .eq("is_system", true)
    .single()
  if (!transitWh) return { success: false, message: "No se encontró la bodega de tránsito." }

  const results: { ok: boolean; msg: string }[] = []

  for (const to_warehouse_id of input.to_warehouse_ids) {
    const { data: tr, error } = await supabase
      .from("transfers")
      .insert({
        from_warehouse_id: input.from_warehouse_id,
        to_warehouse_id,
        notes: input.notes || null,
        status: "en_transito",
        sent_by: profile.id,
      })
      .select("transfer_id")
      .single()
    if (error) {
      results.push({ ok: false, msg: error.message })
      continue
    }

    const itemsToInsert = input.items.map((it) => ({
      transfer_id: tr.transfer_id,
      product_id: it.product_id,
      quantity: it.quantity,
    }))
    await supabase.from("transfer_items").insert(itemsToInsert)

    // Move stock: source → transit (not directly to destination)
    const moves = await Promise.all(
      input.items.map((it) =>
        supabase.rpc("send_transfer_via_transit", {
          p_product_id: it.product_id,
          p_from_warehouse_id: input.from_warehouse_id,
          p_transit_warehouse_id: transitWh.warehouse_id,
          p_quantity: it.quantity,
          p_reference_id: tr.transfer_id,
          p_user_id: profile.id,
        }),
      ),
    )
    for (const m of moves) {
      if (m.error) results.push({ ok: false, msg: m.error.message })
    }
    results.push({ ok: true, msg: "Envío registrado" })
  }

  revalidatePath("/central")
  revalidatePath("/inventory/products")
  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    return { success: false, message: `Algunos envíos fallaron: ${failed.map((f) => f.msg).join("; ")}` }
  }
  return { success: true, message: "Mercancía enviada. Las sedes deben confirmar la recepción." }
}

// ============ TRANSFER RECEPTION (checklist) ============

export async function getPendingTransfersForSite(siteId: string) {
  await requireRole("admin", "contador", "encargado")
  const accessible = await getAccessibleSiteIds()
  if (accessible !== "all" && !accessible.includes(siteId)) {
    throw new Error("No tienes acceso a esta sede.")
  }
  const supabase = await createServerSupabaseClient()

  // Get warehouse IDs for this site
  const { data: whs } = await supabase
    .from("warehouses")
    .select("warehouse_id")
    .eq("site_id", siteId)
  const whIds = (whs || []).map((w) => w.warehouse_id)
  if (whIds.length === 0) return []

  const { data, error } = await supabase
    .from("transfers")
    .select(`
      transfer_id, status, notes, transfer_date, sent_by,
      from_wh:warehouses!transfers_from_warehouse_id_fkey ( name, sites ( name ) ),
      to_wh:warehouses!transfers_to_warehouse_id_fkey ( name, sites ( name ) ),
      transfer_items ( transfer_item_id, product_id, quantity, quantity_received,
        products ( name, code, image_url ) )
    `)
    .in("to_warehouse_id", whIds)
    .in("status", ["en_transito", "recibido_con_pendiente"])
    .order("transfer_date", { ascending: false })

  if (error) {
    console.error("Error fetching pending transfers:", error)
    return []
  }
  return data || []
}

export async function getTransferById(transferId: string) {
  const profile = await requireRole("admin", "contador", "encargado")
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from("transfers")
    .select(`
      transfer_id, status, notes, transfer_date, sent_by, received_by, received_at,
      from_warehouse_id, to_warehouse_id,
      from_wh:warehouses!transfers_from_warehouse_id_fkey ( name, site_id, sites ( name ) ),
      to_wh:warehouses!transfers_to_warehouse_id_fkey ( name, site_id, sites ( name ) ),
      transfer_items ( transfer_item_id, product_id, quantity, quantity_received,
        products ( name, code, image_url, cost, price ) )
    `)
    .eq("transfer_id", transferId)
    .single()

  if (error) {
    console.error("Error fetching transfer:", error)
    return null
  }

  if (profile.role === "encargado" && data) {
    const toSiteId = (data.to_wh as any)?.site_id
    const fromSiteId = (data.from_wh as any)?.site_id
    // Puede ver el traslado si alguna de sus sedes es origen o destino
    const accessible = await getAccessibleSiteIds()
    if (accessible !== "all") {
      const canSee =
        (toSiteId && accessible.includes(toSiteId)) ||
        (fromSiteId && accessible.includes(fromSiteId))
      if (!canSee) return null
    }
  }

  return data
}

export async function receiveTransfer(
  transferId: string,
  items: { product_id: string; quantity_received: number }[]
) {
  const profile = await requireRole('admin', 'encargado')
  const supabase = await createServerSupabaseClient()

  // Toda la recepción ocurre dentro de un RPC de Postgres: una sola
  // transacción, con bloqueo de filas sobre el traslado, sus líneas y el
  // saldo de tránsito. Si algo falla, no queda nada aplicado a medias.
  const { data, error } = await supabase.rpc('receive_transfer', {
    p_transfer_id: transferId,
    p_items: items,
    p_user_id: profile.id,
  })

  if (error) {
    return { success: false, message: error.message }
  }

  const res = data as any
  if (res?.error) {
    return { success: false, message: res.error }
  }

  revalidatePath('/transfers/receive')
  revalidatePath('/inventory/products')
  revalidatePath('/central')

  return {
    success: true,
    message: res.pending
      ? `Recepción parcial registrada (${res.units_received} uds.). Quedan ítems pendientes.`
      : "Mercancía recibida completamente.",
  }
}

/**
 * Traslados con pendientes, listos para reconciliar.
 * Devuelve lo que falta por línea y cuánto hay en tránsito.
 */
export async function getTransfersToReconcile() {
  await requireRole("admin", "contador")
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from("transfers")
    .select(`
      transfer_id, status, notes, transfer_date, received_at,
      from_wh:warehouses!transfers_from_warehouse_id_fkey ( name, sites ( name ) ),
      to_wh:warehouses!transfers_to_warehouse_id_fkey ( name, sites ( name ) ),
      transfer_items ( transfer_item_id, product_id, quantity, quantity_received,
        products ( name, code, image_url, cost ) )
    `)
    .eq("status", "recibido_con_pendiente")
    .order("transfer_date", { ascending: false })

  if (error) {
    console.error("Error fetching transfers to reconcile:", error)
    return []
  }

  // Saldo en tránsito, para contrastar con el pendiente declarado
  const { data: transitWh } = await supabase
    .from("warehouses")
    .select("warehouse_id")
    .eq("is_system", true)
    .maybeSingle()

  const productIds = Array.from(
    new Set(
      (data || []).flatMap((t: any) =>
        (t.transfer_items || []).map((i: any) => i.product_id),
      ),
    ),
  )

  const transitMap: Record<string, number> = {}
  if (transitWh && productIds.length > 0) {
    const { data: stock } = await supabase
      .from("product_stock")
      .select("product_id, quantity")
      .eq("warehouse_id", transitWh.warehouse_id)
      .in("product_id", productIds)
    for (const r of (stock || []) as any[]) {
      transitMap[r.product_id] = r.quantity
    }
  }

  return (data || []).map((t: any) => ({
    ...t,
    transfer_items: (t.transfer_items || []).map((i: any) => ({
      ...i,
      pending: i.quantity - (i.quantity_received || 0),
      transit_qty: transitMap[i.product_id] ?? 0,
    })),
  }))
}

/**
 * Cierra un traslado con pendientes: lo hallado entra al destino,
 * lo faltante se da de baja desde tránsito como ajuste negativo.
 */
export async function reconcileTransfer(
  transferId: string,
  items: { product_id: string; found_qty: number }[],
  notes?: string | null,
) {
  const profile = await requireRole("admin", "contador")
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc("reconcile_transfer", {
    p_transfer_id: transferId,
    p_items: items,
    p_notes: notes || null,
    p_user_id: profile.id,
  })

  if (error) return { success: false, message: error.message }
  const res = data as any
  if (res?.error) return { success: false, message: res.error }

  revalidatePath("/transfers/reconcile")
  revalidatePath("/transfers/receive")
  revalidatePath("/inventory/products")
  revalidatePath("/inventory/kardex")

  const msg =
    res.lost > 0
      ? `Traslado cerrado: ${res.found} unidad(es) hallada(s), ${res.lost} dada(s) de baja como pérdida.`
      : `Traslado cerrado: ${res.found} unidad(es) hallada(s), sin pérdidas.`

  return { success: true, message: msg, found: res.found, lost: res.lost }
}

// Receive/add merchandise into central warehouse (entrada de mercancía)
export async function receiveMerchandise(input: {
  warehouse_id: string
  notes?: string | null
  items: { product_id: string; cost: number; quantity: number }[]
}) {
  // reuse adjustment as an "incrementar" entry
  return createAdjustment({
    warehouse_id: input.warehouse_id,
    notes: input.notes ? `[Entrada] ${input.notes}` : "[Entrada de mercancía]",
    items: input.items.map((it) => ({
      product_id: it.product_id,
      cost: it.cost,
      objective: "incrementar" as const,
      quantity: it.quantity,
    })),
  })
}

// Stock + units summary per site (for the admin panel)
export async function getSiteInventorySummary() {
  const supabase = await createServerSupabaseClient()
  const { data: sites } = await supabase.from("sites").select("site_id, name, code, is_central, warehouses ( warehouse_id )")
  const { data: stock } = await supabase.from("product_stock").select("warehouse_id, quantity")
  const rows = (sites || []).map((s: any) => {
    const whIds = (s.warehouses || []).map((w: any) => w.warehouse_id)
    const siteStock = (stock || []).filter((r: any) => whIds.includes(r.warehouse_id))
    const units = siteStock.reduce((sum: number, r: any) => sum + (r.quantity || 0), 0)
    const skus = siteStock.filter((r: any) => (r.quantity || 0) > 0).length
    return { site_id: s.site_id, name: s.name, code: s.code, is_central: s.is_central, units, skus }
  })
  return rows
}

// ============ INVENTORY VALUE ============
export async function getInventoryValue(warehouse_id?: string | null) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .select("product_id, name, code, cost, price, is_active, unit, product_stock ( warehouse_id, quantity )")
    .order("name")
  if (error) {
    console.error("Error fetching inventory value:", error)
    return { rows: [], total: 0 }
  }
  const rows = (data || []).map((p: any) => {
    const stockRows = p.product_stock || []
    const qty = warehouse_id
      ? (stockRows.find((r: any) => r.warehouse_id === warehouse_id)?.quantity ?? 0)
      : stockRows.reduce((s: number, r: any) => s + (r.quantity || 0), 0)
    return {
      product_id: p.product_id,
      name: p.name,
      code: p.code,
      unit: p.unit,
      is_active: p.is_active,
      quantity: qty,
      cost: Number(p.cost || 0),
      total: qty * Number(p.cost || 0),
    }
  })
  const total = rows.reduce((s, r) => s + r.total, 0)
  return { rows, total }
}

// ============ MEDIA UPLOAD ============

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB, igual que el límite del bucket

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
}

/**
 * Comprueba la firma binaria del archivo, no solo el mime declarado:
 * el cliente puede mentir en el data URL.
 */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png"
  // RIFF....WEBP
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  // AVIF: ftyp....avif
  if (buf.subarray(4, 8).toString("ascii") === "ftyp" &&
      buf.subarray(8, 12).toString("ascii").startsWith("avi")) return "image/avif"
  return null
}

/**
 * Sube una imagen al bucket y devuelve su URL pública.
 * Solo admin/encargado — igual que editar el catálogo.
 */
export async function uploadProductMedia(dataUrl: string, _ext = "jpg") {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  try {
    const match = dataUrl.match(/^data:(.+?);base64,(.*)$/)
    if (!match) return { success: false, message: "Formato de archivo inválido." }

    const declaredType = match[1].toLowerCase()
    if (!ALLOWED_IMAGE_TYPES.includes(declaredType as any)) {
      return { success: false, message: "Solo se admiten imágenes JPG, PNG, WebP o AVIF." }
    }

    const buffer = Buffer.from(match[2], "base64")
    if (buffer.length === 0) {
      return { success: false, message: "El archivo está vacío." }
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      const mb = (buffer.length / 1024 / 1024).toFixed(1)
      return { success: false, message: `La imagen pesa ${mb} MB. El máximo es 5 MB.` }
    }

    // El contenido real debe coincidir con lo declarado
    const realType = sniffImageType(buffer)
    if (!realType) {
      return { success: false, message: "El archivo no es una imagen válida." }
    }
    if (realType !== declaredType) {
      return { success: false, message: "El contenido del archivo no coincide con su tipo." }
    }

    const ext = EXT_BY_TYPE[realType] ?? "jpg"
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const { error } = await supabase.storage.from("product-media").upload(path, buffer, {
      contentType: realType,
      upsert: false,
    })
    if (error) {
      console.error("Error uploading media:", error)
      return { success: false, message: error.message }
    }

    const { data } = supabase.storage.from("product-media").getPublicUrl(path)
    return { success: true, url: data.publicUrl, path }
  } catch (e: any) {
    console.error("Unexpected upload error:", e?.message || e)
    return { success: false, message: "No se pudo subir el archivo." }
  }
}

// ============ GALERÍA DE PRODUCTO ============

export async function getProductImages(productId: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("product_images")
    .select("image_id, url, storage_path, alt_text, sort_order, is_primary")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false })
    .order("sort_order")
  if (error) {
    console.error("Error fetching product images:", error)
    return []
  }
  return data || []
}

/** Registra en la galería una imagen ya subida al bucket. */
export async function addProductImage(input: {
  product_id: string
  url: string
  storage_path?: string | null
  alt_text?: string | null
}) {
  const profile = await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  const { data: existing } = await supabase
    .from("product_images")
    .select("image_id")
    .eq("product_id", input.product_id)

  const count = existing?.length ?? 0

  const { error } = await supabase.from("product_images").insert({
    product_id: input.product_id,
    url: input.url,
    storage_path: input.storage_path || null,
    alt_text: input.alt_text || null,
    sort_order: count,
    is_primary: count === 0, // la primera queda como principal
    created_by: profile.id,
  })

  if (error) return { success: false, message: error.message }

  revalidatePath("/inventory/products")
  revalidatePath("/catalog")
  return { success: true, message: "Imagen agregada." }
}

export async function setPrimaryProductImage(imageId: string, productId: string) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  // El índice único exige quitar la anterior antes de marcar la nueva
  await supabase
    .from("product_images")
    .update({ is_primary: false })
    .eq("product_id", productId)
    .eq("is_primary", true)

  const { error } = await supabase
    .from("product_images")
    .update({ is_primary: true })
    .eq("image_id", imageId)

  if (error) return { success: false, message: error.message }

  revalidatePath("/inventory/products")
  revalidatePath("/catalog")
  return { success: true, message: "Foto principal actualizada." }
}

export async function deleteProductImage(imageId: string) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()

  const { data: img } = await supabase
    .from("product_images")
    .select("storage_path, product_id, is_primary")
    .eq("image_id", imageId)
    .maybeSingle()

  const { error } = await supabase.from("product_images").delete().eq("image_id", imageId)
  if (error) return { success: false, message: error.message }

  // Borrar el archivo del bucket para no dejar huérfanos
  if (img?.storage_path) {
    await supabase.storage.from("product-media").remove([img.storage_path])
  }

  // Si se borró la principal, promover la siguiente
  if (img?.is_primary && img.product_id) {
    const { data: next } = await supabase
      .from("product_images")
      .select("image_id")
      .eq("product_id", img.product_id)
      .order("sort_order")
      .limit(1)
      .maybeSingle()
    if (next) {
      await supabase
        .from("product_images")
        .update({ is_primary: true })
        .eq("image_id", next.image_id)
    }
  }

  revalidatePath("/inventory/products")
  revalidatePath("/catalog")
  return { success: true, message: "Imagen eliminada." }
}

/**
 * Borra del bucket los archivos que ya no están referenciados por ninguna foto.
 * Aparecen cuando se elimina un producto: el CASCADE quita la fila de
 * product_images pero el archivo queda. Supabase no permite borrar desde SQL,
 * así que se listan por SQL y se eliminan por la Storage API.
 */
export async function purgeOrphanProductMedia() {
  await requireRole("admin")
  const supabase = await createServerSupabaseClient()

  const { data: orphans, error } = await supabase.rpc("list_orphan_product_media")
  if (error) return { success: false, message: error.message }

  const names = (orphans || []).map((o: any) => o.object_name)
  if (names.length === 0) {
    return { success: true, message: "No hay archivos huérfanos.", deleted: 0 }
  }

  const bytes = (orphans || []).reduce((s: number, o: any) => s + Number(o.bytes || 0), 0)

  const { error: delErr } = await supabase.storage.from("product-media").remove(names)
  if (delErr) return { success: false, message: delErr.message }

  return {
    success: true,
    message: `${names.length} archivo(s) eliminado(s), ${Math.round(bytes / 1024)} KB liberados.`,
    deleted: names.length,
  }
}

export async function reorderProductImages(productId: string, orderedIds: string[]) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("product_images")
      .update({ sort_order: i })
      .eq("image_id", orderedIds[i])
      .eq("product_id", productId)
  }
  revalidatePath("/inventory/products")
  revalidatePath("/catalog")
  return { success: true, message: "Orden actualizado." }
}

// Resolve a category by name, creating it if it does not exist.
async function resolveCategoryId(supabase: any, name?: string | null) {
  const clean = (name || "").trim()
  if (!clean) return null
  const { data: existing } = await supabase
    .from("categories")
    .select("category_id")
    .ilike("name", clean)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.category_id
  const { data: created } = await supabase
    .from("categories")
    .insert({ name: clean })
    .select("category_id")
    .single()
  return created?.category_id ?? null
}

// ============ MERCHANDISE INGRESS (creates product with unique code + stock in a warehouse) ============
export type IngressItemInput = {
  name: string
  type_prefix: string
  category?: string | null
  description?: string | null
  size?: string | null
  color?: string | null
  price: number
  cost: number
  quantity: number
  image_url?: string | null
  // Optional manual code. When provided it overrides the auto-generated one.
  code?: string | null
}

export async function ingressNewProduct(input: IngressItemInput, warehouse_id: string, site_id?: string | null) {
  await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  try {
    const prefix = (input.type_prefix || "XX").trim().toUpperCase().slice(0, 4)
    const size = (input.size || "U").trim().toUpperCase()
    const priceThousands = Math.round((input.price || 0) / 1000)

    let code = input.code?.trim().toUpperCase() || ""
    if (code) {
      // Manual code: verify it is not already used
      const { data: dupe } = await supabase
        .from("products")
        .select("product_id")
        .eq("code", code)
        .limit(1)
        .maybeSingle()
      if (dupe) {
        return { success: false, message: `El código "${code}" ya existe. Usa otro o déjalo en automático.` }
      }
    } else {
      // Auto-generate the unique sequential code CA-M-95-00
      const { data: gen, error: codeError } = await supabase.rpc("next_product_code", {
        p_prefix: prefix,
        p_size: size,
        p_price_thousands: priceThousands,
      })
      if (codeError) {
        console.error("Error generating code:", codeError)
        return { success: false, message: "No se pudo generar el código: " + codeError.message }
      }
      code = gen as string
    }

    const category_id = await resolveCategoryId(supabase, input.category)

    const descParts = [input.description, input.color ? `Color: ${input.color}` : null].filter(Boolean)

    // Create the product
    const { data: product, error: prodError } = await supabase
      .from("products")
      .insert({
        name: input.name.trim(),
        code,
        barcode: code,
        type_prefix: prefix,
        description: descParts.join(" · ") || null,
        category_id,
        unit: "Unidad",
        cost: input.cost ?? 0,
        price: input.price ?? 0,
        size,
        image_url: input.image_url || null,
        is_service: false,
        is_active: true,
        stock_quantity: 0,
      })
      .select("product_id")
      .single()
    if (prodError) {
      console.error("Error creating product:", prodError)
      return { success: false, message: prodError.message }
    }

    // Price in default list
    const { data: defList } = await supabase
      .from("price_lists")
      .select("price_list_id")
      .eq("is_default", true)
      .limit(1)
      .maybeSingle()
    if (defList) {
      await supabase.from("product_prices").upsert({
        product_id: product.product_id,
        price_list_id: defList.price_list_id,
        price: input.price,
      })
    }

    // Stock into the central warehouse
    const qty = Math.max(0, Math.round(input.quantity || 0))
    if (qty > 0) {
      const { error: stockErr } = await supabase.rpc("adjust_warehouse_stock", {
        p_product_id: product.product_id,
        p_warehouse_id: warehouse_id,
        p_delta: qty,
        p_movement_type: "compra",
        p_reference_type: "ingress",
        p_reference_id: product.product_id,
        p_user_id: profile?.id ?? null,
        p_notes: `Ingreso inicial ${code} x${qty}`,
      })
      if (stockErr) {
        return { success: false, message: stockErr.message }
      }
    }

    // Accounting: register the acquisition cost as an expense for the site
    if (site_id && input.cost && qty > 0) {
      await supabase.from("accounting_entries").insert({
        site_id,
        entry_type: "expense",
        category: "Compra de mercancía",
        description: `Ingreso ${code} x${qty}`,
        amount: input.cost * qty,
      })
    }

    revalidatePath("/central")
    revalidatePath("/inventory/products")
    revalidatePath("/pos")
    return { success: true, message: "Producto ingresado.", code, product_id: product.product_id }
  } catch (e: any) {
    console.error("Unexpected ingress error:", e?.message || e)
    return { success: false, message: "Error inesperado al ingresar el producto." }
  }
}

// Products that have a code, for the barcode/label section
export async function getProductsForBarcodes() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .select("product_id, name, code, barcode, size, price, image_url, type_prefix, categories ( name )")
    .not("code", "is", null)
    .neq("code", "")
    .eq("is_active", true)
    .order("code", { ascending: true })
  if (error) {
    console.error("Error fetching products for barcodes:", error)
    return []
  }
  // Ensure a barcode value exists: default to the product code
  return (data || []).map((p: any) => ({
    ...p,
    barcode: p.barcode || p.code,
    category: p.categories?.name ?? null,
  }))
}

// Preview the code that would be generated (for the UI, before saving)
export async function previewProductCode(prefix: string, size: string, price: number) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.rpc("next_product_code", {
    p_prefix: (prefix || "XX").toUpperCase(),
    p_size: (size || "U").toUpperCase(),
    p_price_thousands: Math.round((price || 0) / 1000),
  })
  return data as string | null
}

// ============ CENTRAL FINANCIAL REPORT ============

export async function getCentralPurchases(opts?: { from?: string; to?: string }) {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from("inventory_adjustments")
    .select("adjustment_id, notes, adjustment_date, adjustment_items ( product_id, cost, quantity, products ( name, code, price ) )")
    .ilike("notes", "%[Entrada]%")
    .order("adjustment_date", { ascending: false })
  if (opts?.from) query = query.gte("adjustment_date", opts.from)
  if (opts?.to) query = query.lte("adjustment_date", opts.to)
  const { data, error } = await query
  if (error) { console.error("getCentralPurchases:", error); return [] }
  return (data || []).map((a: any) => {
    const items = (a.adjustment_items || []).map((it: any) => ({
      product_id: it.product_id,
      name: it.products?.name ?? "",
      code: it.products?.code ?? "",
      cost: Number(it.cost || 0),
      price: Number(it.products?.price || 0),
      quantity: it.quantity,
      total_cost: Number(it.cost || 0) * it.quantity,
      total_price: Number(it.products?.price || 0) * it.quantity,
    }))
    return {
      adjustment_id: a.adjustment_id,
      notes: (a.notes || "").replace("[Entrada] ", "").replace("[Entrada de mercancía]", "Entrada"),
      date: a.adjustment_date,
      items,
      total_cost: items.reduce((s: number, i: any) => s + i.total_cost, 0),
      total_price: items.reduce((s: number, i: any) => s + i.total_price, 0),
    }
  })
}

export async function getCentralDistributions(opts?: { from?: string; to?: string }) {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from("transfers")
    .select("transfer_id, transfer_date, notes, to_wh:warehouses!transfers_to_warehouse_id_fkey ( name, sites ( name, site_id ) ), transfer_items ( product_id, quantity, products:products ( name, code, cost, price ) )")
    .order("transfer_date", { ascending: false })
  if (opts?.from) query = query.gte("transfer_date", opts.from)
  if (opts?.to) query = query.lte("transfer_date", opts.to)
  const { data, error } = await query
  if (error) { console.error("getCentralDistributions:", error); return [] }
  return (data || []).map((t: any) => {
    const items = (t.transfer_items || []).map((it: any) => ({
      product_id: it.product_id,
      name: it.products?.name ?? "",
      code: it.products?.code ?? "",
      cost: Number(it.products?.cost || 0),
      price: Number(it.products?.price || 0),
      quantity: it.quantity,
      total_cost: Number(it.products?.cost || 0) * it.quantity,
      total_price: Number(it.products?.price || 0) * it.quantity,
    }))
    return {
      transfer_id: t.transfer_id,
      date: t.transfer_date,
      notes: t.notes,
      site_name: t.to_wh?.sites?.name ?? "—",
      items,
      total_cost: items.reduce((s: number, i: any) => s + i.total_cost, 0),
      total_price: items.reduce((s: number, i: any) => s + i.total_price, 0),
      margin: items.reduce((s: number, i: any) => s + i.total_price - i.total_cost, 0),
    }
  })
}

export async function getCentralMarginReport() {
  const supabase = await createServerSupabaseClient()
  const { data: products } = await supabase
    .from("products")
    .select("product_id, name, code, cost, price")
    .eq("is_active", true)
    .order("name")
  return (products || []).map((p: any) => {
    const cost = Number(p.cost || 0)
    const price = Number(p.price || 0)
    return {
      product_id: p.product_id,
      name: p.name,
      code: p.code,
      cost,
      price,
      margin: price - cost,
      margin_pct: cost > 0 ? ((price - cost) / cost) * 100 : 0,
    }
  })
}
