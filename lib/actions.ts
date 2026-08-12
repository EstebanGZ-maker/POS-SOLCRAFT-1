"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getUserProfile } from "@/lib/auth-helpers"
import { requireRole } from "@/lib/role-guard"
import { phoneCORequired, PHONE_CO_ERROR } from "@/lib/validators/customer"

// --- Customer Actions ---
export async function getCustomers() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from("customers").select("*").order("name", { ascending: true })
  if (error) {
    console.error("Error fetching customers:", error)
    return []
  }
  return data || []
}

export async function createCustomer(formData: FormData) {
  const supabase = await createServerSupabaseClient()
  const name = formData.get("name") as string
  const email = formData.get("email") as string | null
  const phone = formData.get("phone") as string | null

  // Handle empty strings as null
  const emailValue = email && email.trim() !== "" ? email : null
  const phoneResult = phoneCORequired.safeParse(phone ?? "")
  if (!phoneResult.success) {
    return {
      success: false,
      message: phoneResult.error.issues[0]?.message ?? PHONE_CO_ERROR,
    }
  }

  const { error } = await supabase.from("customers").insert({
    name: name.trim(),
    email: emailValue,
    phone: phoneResult.data,
  })

  if (error) {
    console.error("Error creating customer:", error)
    return { success: false, message: error.message }
  }

  revalidatePath("/customers")
  return { success: true, message: "Customer created successfully." }
}

export async function updateCustomer(formData: FormData) {
  const supabase = await createServerSupabaseClient()
  const customer_id = formData.get("customer_id") as string
  const name = formData.get("name") as string
  const email = formData.get("email") as string | null
  const phone = formData.get("phone") as string | null

  // Handle empty strings as null
  const emailValue = email && email.trim() !== "" ? email : null
  const phoneValue = phone && phone.trim() !== "" ? phone : null

  const { error } = await supabase
    .from("customers")
    .update({
      name: name.trim(),
      email: emailValue,
      phone: phoneValue,
    })
    .eq("customer_id", customer_id)

  if (error) {
    console.error("Error updating customer:", error)
    return { success: false, message: error.message }
  }

  revalidatePath("/customers")
  return { success: true, message: "Customer updated successfully." }
}

export async function deleteCustomer(customer_id: string) {
  const supabase = await createServerSupabaseClient()

  // Check if customer has any sales
  const { data: salesData, error: salesError } = await supabase
    .from("sales")
    .select("sale_id")
    .eq("customer_id", customer_id)
    .limit(1)

  if (salesError) {
    console.error("Error checking customer sales:", salesError)
    return { success: false, message: "Error checking customer sales." }
  }

  if (salesData && salesData.length > 0) {
    return { success: false, message: "Cannot delete customer with existing sales." }
  }

  const { error } = await supabase.from("customers").delete().eq("customer_id", customer_id)
  if (error) {
    console.error("Error deleting customer:", error)
    return { success: false, message: error.message }
  }

  revalidatePath("/customers")
  return { success: true, message: "Customer deleted successfully." }
}

// --- Category Actions ---
export async function getCategories() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from("categories").select("*").order("name", { ascending: true })
  if (error) {
    console.error("Error fetching categories:", error)
    return []
  }
  return data || []
}

// Create a contact/customer from the detailed "Nuevo contacto" form.
export async function createContact(input: {
  id_type?: string | null
  id_number?: string | null
  first_name: string
  second_name?: string | null
  last_names: string
  email?: string | null
  phone: string
  city_state?: string | null
  address?: string | null
  postal_code?: string | null
}) {
  const supabase = await createServerSupabaseClient()

  const phoneResult = phoneCORequired.safeParse(input.phone)
  if (!phoneResult.success) {
    return {
      success: false,
      message: phoneResult.error.issues[0]?.message ?? PHONE_CO_ERROR,
      customer: null,
    }
  }

  const fullName = [input.first_name, input.second_name, input.last_names]
    .filter((p) => p && p.trim() !== "")
    .join(" ")
    .trim()

  const clean = (v?: string | null) => (v && v.trim() !== "" ? v.trim() : null)

  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: fullName,
      email: clean(input.email),
      phone: phoneResult.data,
      id_type: clean(input.id_type),
      id_number: clean(input.id_number),
      first_name: clean(input.first_name),
      second_name: clean(input.second_name),
      last_names: clean(input.last_names),
      city_state: clean(input.city_state),
      address: clean(input.address),
      postal_code: clean(input.postal_code),
    })
    .select()
    .single()

  if (error) {
    console.error("Error creating contact:", error)
    return { success: false, message: error.message, customer: null }
  }

  revalidatePath("/customers")
  revalidatePath("/pos")
  return { success: true, message: "Contacto creado correctamente.", customer: data }
}

// --- Product Actions ---
export async function getProducts() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .select("*, categories ( category_id, name )")
    .order("name", { ascending: true })
  if (error) {
    console.error("Error fetching products:", error)
    return []
  }
  return data || []
}

export async function createProduct(formData: FormData) {
  const supabase = await createServerSupabaseClient()
  const name = formData.get("name") as string
  const description = formData.get("description") as string | null
  const price = Number.parseFloat(formData.get("price") as string)
  const stock_quantity = Number.parseInt(formData.get("stock_quantity") as string)

  if (isNaN(price) || price < 0) {
    return { success: false, message: "Invalid price value." }
  }

  if (isNaN(stock_quantity) || stock_quantity < 0) {
    return { success: false, message: "Invalid stock quantity value." }
  }

  const descriptionValue = description && description.trim() !== "" ? description.trim() : null

  const { error } = await supabase.from("products").insert({
    name: name.trim(),
    description: descriptionValue,
    price,
    stock_quantity,
  })

  if (error) {
    console.error("Error creating product:", error)
    return { success: false, message: error.message }
  }

  revalidatePath("/products")
  return { success: true, message: "Product created successfully." }
}

export async function updateProduct(formData: FormData) {
  const supabase = await createServerSupabaseClient()
  const product_id = formData.get("product_id") as string
  const name = formData.get("name") as string
  const description = formData.get("description") as string | null
  const price = Number.parseFloat(formData.get("price") as string)
  const stock_quantity = Number.parseInt(formData.get("stock_quantity") as string)

  if (isNaN(price) || price < 0) {
    return { success: false, message: "Invalid price value." }
  }

  if (isNaN(stock_quantity) || stock_quantity < 0) {
    return { success: false, message: "Invalid stock quantity value." }
  }

  const descriptionValue = description && description.trim() !== "" ? description.trim() : null

  const { error } = await supabase
    .from("products")
    .update({
      name: name.trim(),
      description: descriptionValue,
      price,
      stock_quantity,
    })
    .eq("product_id", product_id)

  if (error) {
    console.error("Error updating product:", error)
    return { success: false, message: error.message }
  }

  revalidatePath("/products")
  return { success: true, message: "Product updated successfully." }
}

export async function deleteProduct(product_id: string) {
  const supabase = await createServerSupabaseClient()

  // Check if product has any sale items
  const { data: saleItemsData, error: saleItemsError } = await supabase
    .from("sale_items")
    .select("sale_item_id")
    .eq("product_id", product_id)
    .limit(1)

  if (saleItemsError) {
    console.error("Error checking product sales:", saleItemsError)
    return { success: false, message: "Error checking product sales." }
  }

  if (saleItemsData && saleItemsData.length > 0) {
    return { success: false, message: "Cannot delete product with existing sales." }
  }

  const { error } = await supabase.from("products").delete().eq("product_id", product_id)
  if (error) {
    console.error("Error deleting product:", error)
    return { success: false, message: error.message }
  }

  revalidatePath("/products")
  return { success: true, message: "Product deleted successfully." }
}

// --- Sales Actions ---
export async function getSales() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("sales")
    .select(`
      *,
      customers (
        name
      ),
      sale_items (
        *,
        products (
          name,
          price
        )
      )
    `)
    .order("sale_date", { ascending: false })

  if (error) {
    console.error("Error fetching sales:", error)
    return []
  }
  return data || []
}

export async function getSaleDetails(sale_id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("sales")
    .select(`
      *,
      customers (
        name
      ),
      sale_items (
        *,
        products (
          name,
          price
        )
      )
    `)
    .eq("sale_id", sale_id)
    .single()

  if (error) {
    console.error("Error fetching sale details:", error)
    return null
  }
  return data
}

export async function createSale(
  customer_id: string,
  total_amount: number,
  items: any[],
  payment?: {
    payment_method?: string | null
    amount_received?: number | null
    seller?: string | null
    notes?: string | null
  },
  location?: {
    site_id?: string | null
    warehouse_id?: string | null
    shift_id?: string | null
  },
  price_list?: string | null,
) {
  const supabase = await createServerSupabaseClient()

  const profile = await getUserProfile()

  // Server decides price: look up authorized base price per product
  const productIds = items.map((i) => i.product_id)
  const { data: productRows } = await supabase
    .from("products")
    .select("product_id, price, wholesale_price, tax_rate")
    .in("product_id", productIds)

  let listPrices: Record<string, number> = {}
  if (price_list && price_list !== "general" && price_list !== "mayorista") {
    const { data: pp } = await supabase
      .from("product_prices")
      .select("product_id, price")
      .eq("price_list_id", price_list)
      .in("product_id", productIds)
    for (const row of pp || []) {
      listPrices[row.product_id] = Number(row.price)
    }
  }

  const priceIndex: Record<string, { base: number; tax: number }> = {}
  for (const p of productRows || []) {
    let base: number
    if (price_list === "mayorista" && p.wholesale_price != null) {
      base = Number(p.wholesale_price)
    } else if (listPrices[p.product_id] != null) {
      base = listPrices[p.product_id]
    } else {
      base = Number(p.price)
    }
    priceIndex[p.product_id] = { base, tax: Number(p.tax_rate) || 0 }
  }

  const validatedItems = items.map((item) => {
    const info = priceIndex[item.product_id]
    if (!info) return { product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price, base_price: item.unit_price, discount: 0, tax_rate: 0 }
    const discount = Math.max(0, Math.min(100, Number(item.discount) || 0))
    const serverPrice = info.base * (1 + info.tax / 100) * (1 - discount / 100)
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: serverPrice,
      base_price: info.base,
      discount,
      tax_rate: info.tax,
    }
  })

  const serverTotal = validatedItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)

  const { data: sale_id, error } = await supabase.rpc("create_sale", {
    p_customer_id: customer_id,
    p_total_amount: serverTotal,
    p_items: validatedItems,
    p_payment_method: payment?.payment_method ?? null,
    p_amount_received: payment?.amount_received ?? null,
    p_seller: payment?.seller ?? null,
    p_notes: payment?.notes ?? null,
    p_site_id: location?.site_id ?? null,
    p_warehouse_id: location?.warehouse_id ?? null,
    p_shift_id: location?.shift_id ?? null,
    p_user_id: profile?.id ?? null,
  })

  if (error) {
    console.error("Error creating sale:", error)
    return { success: false, message: error.message }
  }

  revalidatePath("/sales")
  revalidatePath("/pos")
  revalidatePath("/products")
  revalidatePath("/accounting")
  return { success: true, message: "Venta registrada correctamente.", sale_id }
}

// --- Void Sale ---
export async function voidSale(sale_id: string) {
  const profile = await requireRole("admin", "encargado")
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("void_sale", {
    p_sale_id: sale_id,
    p_user_id: profile.id,
  })
  if (error) {
    return { success: false, message: error.message }
  }
  revalidatePath("/sales")
  revalidatePath("/pos")
  revalidatePath("/accounting")
  revalidatePath("/inventory/products")
  return { success: true, message: "Venta anulada correctamente." }
}

// --- Dashboard Stats ---
export async function getDashboardStats() {
  const supabase = await createServerSupabaseClient()

  try {
    // Get total customers
    const { count: totalCustomers } = await supabase.from("customers").select("*", { count: "exact", head: true })

    // Get total products
    const { count: totalProducts } = await supabase.from("products").select("*", { count: "exact", head: true })

    // Get total sales today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const { data: todaySales } = await supabase
      .from("sales")
      .select("total_amount")
      .gte("sale_date", today.toISOString())
      .lt("sale_date", tomorrow.toISOString())

    const todayRevenue = todaySales?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0

    // Get low stock products count
    const { count: lowStockCount } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .lte("stock_quantity", 10)

    return {
      totalCustomers: totalCustomers || 0,
      totalProducts: totalProducts || 0,
      todayRevenue,
      lowStockCount: lowStockCount || 0,
    }
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    return {
      totalCustomers: 0,
      totalProducts: 0,
      todayRevenue: 0,
      lowStockCount: 0,
    }
  }
}
