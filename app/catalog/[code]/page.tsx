import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Button } from "@/components/ui/button"
import { getPublicProduct, getPublicCommerceConfig, getProductSizes } from "@/lib/catalog-actions"
import { AddToCartButton } from "@/components/catalog/add-to-cart-button"
import { GlowCard } from "@/components/catalog/glow-card"
import { ProductGallery } from "@/components/catalog/product-gallery"
import { formatCurrency } from "@/lib/utils"
import { ArrowLeft, ImageOff, MapPin, CheckCircle2, XCircle, MessageCircle } from "lucide-react"

interface Props {
  params: Promise<{ code: string }>
}

// La ficha de producto cambia poco. Se sirve estática y se revalida cada
// 60s: nuevas fotos, cambios de precio o de stock aparecen sin recargar
// nada, pero el HTML se sirve al instante desde caché.
export const revalidate = 60

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  const product = await getPublicProduct(decodeURIComponent(code))
  if (!product) return { title: "Producto no encontrado" }
  const config = await getPublicCommerceConfig()
  return {
    title: `${product.name} · ${config.business_name}`,
    description: product.description || `${product.name} — ${formatCurrency(Number(product.price))}`,
    openGraph: {
      title: product.name,
      description: product.description || undefined,
      images: product.image_url ? [product.image_url] : undefined,
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const { code } = await params
  const decoded = decodeURIComponent(code)

  const [product, config, sizes] = await Promise.all([
    getPublicProduct(decoded),
    getPublicCommerceConfig(),
    getProductSizes(decoded),
  ])

  if (!product) notFound()

  const available = product.available_sites.length > 0
  const waNumber = (config.whatsapp_number || config.phone || "").replace(/\D/g, "")
  // Solo mostramos el selector cuando el diseño existe en más de una talla
  const currentSize = sizes.find((s) => s.code === decoded)?.size ?? null

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/catalog/productos"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-[hsl(var(--gold-mid))]"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al catálogo
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Galería */}
        <ProductGallery
          images={
            product.images?.length
              ? product.images
              : product.image_url
                ? [{ url: product.image_url, alt: product.name }]
                : []
          }
          productName={product.name}
        />

        {/* Información */}
        <div className="space-y-5">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-[hsl(var(--gold-lo))]">
              {product.code}
            </div>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl leading-tight">{product.name}</h1>
            {product.category_name && (
              <span className="mt-2 inline-block rounded-full border border-gold-soft px-3 py-0.5 text-xs text-muted-foreground">
                {product.category_name}
              </span>
            )}
          </div>

          <div className="font-mono text-4xl font-bold text-gold-gradient">
            {formatCurrency(Number(product.price))}
          </div>

          <div>
            {available ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Disponible
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-xs text-muted-foreground">
                <XCircle className="h-3.5 w-3.5" /> Agotado en todas las sedes
              </span>
            )}
          </div>

          {/* Tallas — derivadas del producto. Si solo hay una, se muestra una. */}
          {sizes.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                {sizes.length === 1 ? "Talla" : "Tallas"}
              </div>
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => {
                  const isCurrent = s.code === decoded
                  const base =
                    "rounded-full border px-4 py-1.5 font-mono text-sm transition-colors"
                  if (isCurrent) {
                    return (
                      <span
                        key={s.code}
                        aria-current="true"
                        className={`${base} border-[hsl(var(--gold-mid))] bg-[hsl(var(--gold-mid)/0.15)] text-[hsl(var(--gold-mid))] glow-gold-sm`}
                      >
                        {s.size ?? "Única"}
                      </span>
                    )
                  }
                  if (!s.is_available) {
                    return (
                      <span
                        key={s.code}
                        title="Agotada"
                        className={`${base} border-white/10 text-muted-foreground/50 line-through`}
                      >
                        {s.size ?? "Única"}
                      </span>
                    )
                  }
                  return (
                    <Link
                      key={s.code}
                      href={`/catalog/${encodeURIComponent(s.code)}`}
                      className={`${base} border-gold-soft hover:border-[hsl(var(--gold-mid))] hover:text-[hsl(var(--gold-mid))]`}
                    >
                      {s.size ?? "Única"}
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          <AddToCartButton
            product={{
              product_id: product.product_id,
              code: product.code,
              name: product.name,
              price: Number(product.price),
              image_url: product.image_url,
            }}
            disabled={!available}
          />

          {product.description && (
            <div>
              <h2 className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                Descripción
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
            </div>
          )}

          {waNumber && (
            <Button
              asChild
              variant="outline"
              className="w-full gap-2 border-gold-soft bg-transparent hover:border-gold-strong"
            >
              <a
                href={`https://wa.me/${waNumber}?text=${encodeURIComponent(
                  `Hola, me interesa ${product.name} (código ${product.code}${
                    currentSize ? `, talla ${currentSize}` : ""
                  }).`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4" />
                Consultar por WhatsApp
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Disponibilidad por sede */}
      {available && (
        <section className="mt-12">
          <h2 className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[hsl(var(--gold-lo))]">
            <MapPin className="h-3.5 w-3.5" />
            Disponible en
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {product.available_sites.map((s) => (
              <div
                key={s}
                className="rounded-xl border border-gold-soft surface-gold px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {s}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
