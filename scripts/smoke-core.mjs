#!/usr/bin/env node
/**
 * smoke-core.mjs — invariantes del núcleo dinero/stock, no destructivo.
 *
 * Reproduce a nivel DB lo que se validó a mano: kardex cuadrado y bloqueo de
 * sobreventa. Corre contra la DB real sin dejar rastro (la venta de prueba se
 * fuerza a fallar, lo que revierte su propia transacción).
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/smoke-core.mjs
 *
 * (El service_role bypassa RLS para poder invocar los RPC; la lógica de
 *  sobreventa vive en la función, así que la prueba sigue siendo válida.)
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(2)
}
const db = createClient(URL, KEY, { auth: { persistSession: false } })

let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { console.error(`  ✗ ${m}`); failures++ }

// 1) Kardex cuadrado
{
  const { data, error } = await db.rpc("verify_kardex_integrity")
  if (error) bad(`verify_kardex_integrity error: ${error.message}`)
  else if ((data?.length ?? 0) === 0) ok("kardex sin descuadres")
  else bad(`kardex con ${data.length} descuadres`)
}

// 2) Bloqueo de sobreventa
{
  // Buscar un producto con stock en una bodega de venta y un cliente cualquiera.
  const { data: stockRow } = await db
    .from("product_stock")
    .select("product_id, warehouse_id, quantity, warehouses!inner(site_id, is_system)")
    .gt("quantity", 0)
    .limit(50)
  const target = (stockRow || []).find((r) => r.warehouses && r.warehouses.is_system === false)
  const { data: cust } = await db.from("customers").select("customer_id").limit(1).single()

  if (!target || !cust) {
    bad("no hay stock/cliente de prueba disponible para el test de sobreventa")
  } else {
    const items = [{
      product_id: target.product_id, quantity: target.quantity + 9999,
      unit_price: 1000, base_price: 1000, discount: 0, tax_rate: 0,
    }]
    const { error } = await db.rpc("create_sale", {
      p_customer_id: cust.customer_id,
      p_total_amount: 1000,
      p_items: items,
      p_site_id: target.warehouses.site_id,
      p_warehouse_id: target.warehouse_id,
    })
    if (error && /insuficiente/i.test(error.message)) ok(`sobreventa bloqueada (${error.message})`)
    else if (error) bad(`falló pero por otro motivo: ${error.message}`)
    else bad("¡sobreventa NO bloqueada! create_sale aceptó más de lo disponible")
  }
}

console.log(failures === 0 ? "\nOK — invariantes del núcleo intactos." : `\nFALLÓ — ${failures} problema(s).`)
process.exit(failures === 0 ? 0 : 1)
