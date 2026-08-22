"use server"

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getUserProfile } from "@/lib/auth-helpers"
import { requireRole } from "@/lib/role-guard"
import { phoneCORequired, PHONE_CO_ERROR } from "@/lib/validators/customer"
import { withPosTiming } from "@/lib/pos-timing"
import { fetchCustomersRaw, fetchCategoriesRaw } from "@/lib/pos-bootstrap-queries"

// --- Customer Actions ---
export async function getCustomers() {
  return withPosTiming("getCustomers", async () => {
    const supabase = await createServerSupabaseClient()
    try {
      return await fetchCustomersRaw(supabase)
    } catch (e: any) {
      console.error("Error fetching customers:", e?.message ?? e)
      return []
    }
  })
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
  return withPosTiming("getCategories", async () => {
    const supabase = await createServerSupabaseClient()
    try {
      return await fetchCategoriesRaw(supabase)
    } catch (e: any) {
      console.error("Error fetching categories:", e?.message ?? e)
      return []
    }
  })
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
    is_on_account?: boolean
    initial_payment?: number | null
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
    p_is_on_account: payment?.is_on_account ?? false,
    p_initial_payment: payment?.initial_payment ?? null,
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

// =============================================================================
// Crédito Fase 3 — abonos posteriores, CxC, redención saldo a favor
// =============================================================================
// Wrappers delgados sobre los RPCs SECDEF (register_payment, apply_customer_credit).
// Toda la validación (rol, sede, D9 turno-cash, D14 income redención, FOR UPDATE)
// vive en los RPCs (script 18). Aquí solo mapeamos errores y disparamos
// revalidatePath para las rutas afectadas.

export async function registerPayment(
  sale_id: string,
  amount: number,
  payment_method: string,
  shift_id?: string | null,
  notes?: string | null,
) {
  await requireRole("admin", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("register_payment", {
    p_sale_id: sale_id,
    p_amount: amount,
    p_payment_method: payment_method,
    p_shift_id: shift_id ?? null,
    p_notes: notes ?? null,
  })
  if (error) {
    console.error("registerPayment:", error)
    return { success: false, message: error.message }
  }
  revalidatePath("/pos")
  revalidatePath("/receivables")
  revalidatePath("/sales")
  revalidatePath("/customers")
  revalidatePath("/accounting")
  return {
    success: true,
    message: "Abono registrado correctamente.",
    payment_id: data?.payment_id as string | undefined,
    new_amount_paid: Number(data?.new_amount_paid) || 0,
    new_balance_due: Number(data?.new_balance_due) || 0,
  }
}

export async function applyCustomerCredit(
  sale_id: string,
  amount: number,
  shift_id?: string | null,
) {
  await requireRole("admin", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("apply_customer_credit", {
    p_sale_id: sale_id,
    p_credit_amount: amount,
    p_shift_id: shift_id ?? null,
  })
  if (error) {
    console.error("applyCustomerCredit:", error)
    return { success: false, message: error.message }
  }
  revalidatePath("/pos")
  revalidatePath("/receivables")
  revalidatePath("/sales")
  revalidatePath("/customers")
  revalidatePath("/accounting")
  return {
    success: true,
    message: "Saldo a favor aplicado correctamente.",
    payment_id: data?.payment_id as string | undefined,
    new_amount_paid: Number(data?.new_amount_paid) || 0,
    new_balance_due: Number(data?.new_balance_due) || 0,
    remaining_credit: Number(data?.remaining_credit) || 0,
  }
}

export type AgeBucket = "0-30" | "31-60" | "60+"

function toAgeBucket(days: number): AgeBucket {
  if (days <= 30) return "0-30"
  if (days <= 60) return "31-60"
  return "60+"
}

export interface ReceivableSale {
  sale_id: string
  numero: number | null
  sale_date: string
  total_amount: number
  amount_paid: number
  balance_due: number
  site_id: string | null
  age_days: number
  age_bucket: AgeBucket
}

export interface ReceivableGroup {
  customer_id: string
  customer_name: string
  customer_phone: string | null
  sales_count: number
  total_facturado: number
  total_abonado: number
  total_pendiente: number
  oldest_days: number
  // Bucket del cliente = bucket de su venta MÁS vieja. Es lo que muestra la
  // fila colapsada del listado (semáforo del cliente). Cada venta individual
  // trae su propio bucket para el detalle expandido.
  oldest_bucket: AgeBucket
  customer_credit_balance: number
  sales: ReceivableSale[]
}

// Ventas con is_on_account AND balance_due>0 AND status='active', agrupadas por
// cliente. RLS filtra por sede automáticamente (has_site_access):
// admin/contador ven todas; encargado/vendedor solo su sede.
// El param opcional site_id agrega un filtro extra para admin viewing 1 sede.
//
// customer_credit_balance viene EN EL LISTADO (2 queries en total, no N+1):
// primero traemos las ventas con saldo, luego un único SUM agrupado de
// customer_credits para los customer_id ya listados. Decisión: útil para
// mostrar "puede pagar Y con saldo a favor" en la vista, y evita que la UI
// dispare N llamadas a getCustomerCreditBalance al pintar la tabla.
export type ReceivablesBucketFilter = "all" | AgeBucket
export type ReceivablesSort = "age-desc" | "age-asc"

export interface GetReceivablesOpts {
  site_id?: string | null
  q?: string | null
  bucket?: ReceivablesBucketFilter | null
  sort?: ReceivablesSort | null
}

export async function getReceivables(opts?: GetReceivablesOpts) {
  await requireRole("admin", "contador", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()
  let q = supabase
    .from("sales")
    .select(
      "sale_id, numero, site_id, total_amount, amount_paid, balance_due, sale_date, customer_id, customers(customer_id, name, phone, email)",
    )
    .eq("is_on_account", true)
    .eq("status", "active")
    .gt("balance_due", 0)
    .order("sale_date", { ascending: true })
  if (opts?.site_id) q = q.eq("site_id", opts.site_id)

  const { data, error } = await q
  if (error) {
    console.error("getReceivables:", error)
    return { success: false, message: error.message, groups: [] as ReceivableGroup[] }
  }

  const map = new Map<string, ReceivableGroup>()
  const now = Date.now()
  for (const row of data ?? []) {
    const cust = (row as any).customers
    const cid = row.customer_id as string
    const g =
      map.get(cid) ??
      ({
        customer_id: cid,
        customer_name: cust?.name ?? "Sin nombre",
        customer_phone: cust?.phone ?? null,
        sales_count: 0,
        total_facturado: 0,
        total_abonado: 0,
        total_pendiente: 0,
        oldest_days: 0,
        oldest_bucket: "0-30" as AgeBucket,
        customer_credit_balance: 0,
        sales: [] as ReceivableSale[],
      } as ReceivableGroup)
    const days = Math.floor((now - new Date(row.sale_date).getTime()) / 86400000)
    g.sales_count += 1
    g.total_facturado += Number(row.total_amount) || 0
    g.total_abonado += Number(row.amount_paid) || 0
    g.total_pendiente += Number(row.balance_due) || 0
    if (days > g.oldest_days) g.oldest_days = days
    g.sales.push({
      sale_id: row.sale_id as string,
      numero: (row.numero as number | null) ?? null,
      sale_date: row.sale_date as string,
      total_amount: Number(row.total_amount) || 0,
      amount_paid: Number(row.amount_paid) || 0,
      balance_due: Number(row.balance_due) || 0,
      site_id: (row.site_id as string | null) ?? null,
      age_days: days,
      age_bucket: toAgeBucket(days),
    })
    map.set(cid, g)
  }

  // 2do query único (no N+1): SUM customer_credits para los clientes listados.
  const customerIds = Array.from(map.keys())
  if (customerIds.length > 0) {
    const { data: creditRows, error: creditErr } = await supabase
      .from("customer_credits")
      .select("customer_id, amount")
      .in("customer_id", customerIds)
    if (creditErr) {
      console.error("getReceivables (credits):", creditErr)
      // Deja balances en 0; no rompe el listado.
    } else {
      const creditByCustomer = new Map<string, number>()
      for (const c of creditRows ?? []) {
        const prev = creditByCustomer.get(c.customer_id as string) ?? 0
        creditByCustomer.set(c.customer_id as string, prev + (Number(c.amount) || 0))
      }
      for (const g of map.values()) {
        g.customer_credit_balance = creditByCustomer.get(g.customer_id) ?? 0
      }
    }
  }

  // Cierra el bucket del cliente en base al oldest_days final.
  for (const g of map.values()) {
    g.oldest_bucket = toAgeBucket(g.oldest_days)
  }

  let groups = Array.from(map.values())

  // Filtro por bucket sobre el grupo (mismo cálculo que ya usa la UI para el
  // semáforo colapsado — no reimplementamos).
  const bucket = opts?.bucket ?? "all"
  if (bucket !== "all") {
    groups = groups.filter((g) => g.oldest_bucket === bucket)
  }

  // Búsqueda unificada: nombre / teléfono (ILIKE-substring, case-insensitive)
  // o número de venta exacto si el input parsea como entero. Filtramos post-
  // agrupamiento sobre el mismo dataset ya scoped por rol/sede vía RLS —
  // el user NO puede alcanzar filas fuera de su scope aunque manipule opts.q.
  const rawQ = (opts?.q ?? "").trim()
  if (rawQ) {
    const needle = rawQ.toLowerCase()
    const asNumero = /^\d+$/.test(rawQ) ? Number(rawQ) : null
    groups = groups.filter((g) => {
      if (g.customer_name.toLowerCase().includes(needle)) return true
      if (g.customer_phone && g.customer_phone.toLowerCase().includes(needle)) return true
      if (asNumero !== null && g.sales.some((s) => s.numero === asNumero)) return true
      return false
    })
  }

  // Sort: default más antigua primero (age-desc = oldest_days descendente).
  const sort: ReceivablesSort = opts?.sort ?? "age-desc"
  groups.sort((a, b) => (sort === "age-asc" ? a.oldest_days - b.oldest_days : b.oldest_days - a.oldest_days))

  return { success: true, groups }
}

// Export CSV del listado ya filtrado y ordenado. Reusa getReceivables entero
// para heredar guards de rol/sede — el CSV nunca puede traer filas fuera del
// scope del usuario. Server action: la UI recibe { filename, content } y
// dispara la descarga con un Blob.
export async function exportReceivablesCSV(opts?: GetReceivablesOpts) {
  const { buildCSV } = await import("./csv")
  const res = await getReceivables(opts)
  if (!res.success) return { success: false as const, message: res.message }

  const headers = [
    "Cliente",
    "Teléfono",
    "Número de venta",
    "Fecha",
    "Antigüedad (bucket)",
    "Días",
    "Monto adeudado",
  ]
  const rows: unknown[][] = []
  for (const g of res.groups) {
    for (const s of g.sales) {
      rows.push([
        g.customer_name,
        g.customer_phone ?? "",
        s.numero ?? s.sale_id.slice(0, 8),
        s.sale_date.slice(0, 10),
        s.age_bucket,
        s.age_days,
        s.balance_due,
      ])
    }
  }
  const content = buildCSV(headers, rows)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
  const filename = `cuentas-por-cobrar-${stamp}.csv`
  return { success: true as const, filename, content }
}

// Detalle completo de una venta a crédito para /receivables/[sale_id].
// RLS filtra sales por has_site_access → si el user no tiene acceso a la sede
// de la venta, la query devuelve null y la página muestra 404. Es el guard
// server-side (no basta ocultar el link en la lista).
//
// Reusa el shape de items de getReceiptData (name/code/description/unit/qty/
// unit_price/discount/tax_rate) para poder pasar los mismos items al
// ReceiptDialog existente si el usuario elige imprimir.
export interface ReceivableSaleDetail {
  sale: {
    sale_id: string
    numero: number | null
    sale_date: string
    seller: string | null
    status: string
    is_on_account: boolean
    payment_method: string | null
    total_amount: number
    subtotal: number | null
    discount_total: number
    tax_total: number
    amount_paid: number
    balance_due: number
    site_id: string | null
    customer_id: string
  }
  site_name: string | null
  customer: {
    customer_id: string
    name: string
    phone: string | null
    email: string | null
    id_type: string | null
    id_number: string | null
    address: string | null
  } | null
  items: {
    sale_item_id: string
    name: string
    code: string | null
    description: string | null
    unit: string | null
    quantity: number
    unit_price: number
    discount: number
    tax_rate: number
    subtotal: number
  }[]
  payments: {
    payment_id: string
    amount: number
    payment_method: string
    status: string
    shift_id: string | null
    received_by: string | null
    notes: string | null
    created_at: string
  }[]
  accounting_entries: {
    entry_id: string
    entry_type: "income" | "expense"
    category: string | null
    description: string | null
    amount: number
    entry_date: string
  }[]
}

export async function getReceivableSaleDetail(sale_id: string): Promise<ReceivableSaleDetail | null> {
  await requireRole("admin", "contador", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .select(`
      sale_id, numero, sale_date, seller, status, is_on_account, payment_method,
      total_amount, subtotal, discount_total, tax_total, amount_paid, balance_due,
      site_id, customer_id,
      customers ( customer_id, name, phone, email, id_type, id_number, address ),
      sites ( name ),
      sale_items (
        sale_item_id, quantity, unit_price, discount, tax_rate,
        products ( name, code, description, unit )
      )
    `)
    .eq("sale_id", sale_id)
    .maybeSingle()

  if (saleErr) {
    console.error("getReceivableSaleDetail (sale):", saleErr)
    return null
  }
  if (!sale) return null

  const s = sale as any
  const items = (s.sale_items || []).map((it: any) => ({
    sale_item_id: it.sale_item_id as string,
    name: it.products?.name ?? "—",
    code: it.products?.code ?? null,
    description: it.products?.description ?? null,
    unit: it.products?.unit ?? null,
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unit_price) || 0,
    discount: Number(it.discount) || 0,
    tax_rate: Number(it.tax_rate) || 0,
    subtotal: (Number(it.unit_price) || 0) * (Number(it.quantity) || 0),
  }))

  const { data: payRows, error: payErr } = await supabase
    .from("sale_payments")
    .select("payment_id, amount, payment_method, status, shift_id, received_by, notes, created_at")
    .eq("sale_id", sale_id)
    .order("created_at", { ascending: true })
  if (payErr) console.error("getReceivableSaleDetail (payments):", payErr)

  const { data: entryRows, error: entryErr } = await supabase
    .from("accounting_entries")
    .select("entry_id, entry_type, category, description, amount, entry_date")
    .eq("sale_id", sale_id)
    .order("entry_date", { ascending: true })
  if (entryErr) console.error("getReceivableSaleDetail (entries):", entryErr)

  return {
    sale: {
      sale_id: s.sale_id,
      numero: s.numero ?? null,
      sale_date: s.sale_date,
      seller: s.seller ?? null,
      status: s.status,
      is_on_account: Boolean(s.is_on_account),
      payment_method: s.payment_method ?? null,
      total_amount: Number(s.total_amount) || 0,
      subtotal: s.subtotal != null ? Number(s.subtotal) : null,
      discount_total: Number(s.discount_total) || 0,
      tax_total: Number(s.tax_total) || 0,
      amount_paid: Number(s.amount_paid) || 0,
      balance_due: Number(s.balance_due) || 0,
      site_id: s.site_id ?? null,
      customer_id: s.customer_id as string,
    },
    site_name: s.sites?.name ?? null,
    customer: s.customers
      ? {
          customer_id: s.customers.customer_id,
          name: s.customers.name,
          phone: s.customers.phone ?? null,
          email: s.customers.email ?? null,
          id_type: s.customers.id_type ?? null,
          id_number: s.customers.id_number ?? null,
          address: s.customers.address ?? null,
        }
      : null,
    items,
    payments: (payRows ?? []).map((p: any) => ({
      payment_id: p.payment_id,
      amount: Number(p.amount) || 0,
      payment_method: p.payment_method,
      status: p.status,
      shift_id: p.shift_id ?? null,
      received_by: p.received_by ?? null,
      notes: p.notes ?? null,
      created_at: p.created_at,
    })),
    accounting_entries: (entryRows ?? []).map((e: any) => ({
      entry_id: e.entry_id,
      entry_type: e.entry_type as "income" | "expense",
      category: e.category ?? null,
      description: e.description ?? null,
      amount: Number(e.amount) || 0,
      entry_date: e.entry_date,
    })),
  }
}

// Suma de customer_credits (positivos por emisión, negativos por redención).
export async function getCustomerCreditBalance(customer_id: string) {
  await requireRole("admin", "contador", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("customer_credits")
    .select("amount")
    .eq("customer_id", customer_id)
  if (error) {
    console.error("getCustomerCreditBalance:", error)
    return { success: false, message: error.message, balance: 0 }
  }
  const balance = (data ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  return { success: true, balance }
}

// Fiados abiertos del turno actual (para el botón "Fiados del turno" en /pos).
// Sin agrupación por cliente: mostramos una fila por venta con abono directo.
export async function getShiftReceivables(shift_id: string) {
  await requireRole("admin", "contador", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("sales")
    .select("sale_id, numero, sale_date, total_amount, amount_paid, balance_due, customer_id, customers(customer_id, name, phone)")
    .eq("shift_id", shift_id)
    .eq("is_on_account", true)
    .eq("status", "active")
    .gt("balance_due", 0)
    .order("sale_date", { ascending: false })
  if (error) {
    console.error("getShiftReceivables:", error)
    return { success: false, message: error.message, sales: [] as any[] }
  }
  const sales = (data ?? []).map((s: any) => ({
    sale_id: s.sale_id,
    numero: s.numero,
    sale_date: s.sale_date,
    total_amount: Number(s.total_amount) || 0,
    amount_paid: Number(s.amount_paid) || 0,
    balance_due: Number(s.balance_due) || 0,
    customer_id: s.customer_id,
    customer_name: s.customers?.name ?? "?",
    customer_phone: s.customers?.phone ?? null,
  }))
  return { success: true, sales }
}

// Historial de abonos activos de una venta (para el drawer de detalle).
export async function getSalePayments(sale_id: string) {
  await requireRole("admin", "contador", "encargado", "vendedor")
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("sale_payments")
    .select("payment_id, amount, payment_method, shift_id, received_by, notes, status, created_at")
    .eq("sale_id", sale_id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
  if (error) {
    console.error("getSalePayments:", error)
    return { success: false, message: error.message, payments: [] as any[] }
  }
  return { success: true, payments: data ?? [] }
}
