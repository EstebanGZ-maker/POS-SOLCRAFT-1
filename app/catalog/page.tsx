import Link from "next/link"
import Image from "next/image"
import type { Metadata } from "next"
import { Button } from "@/components/ui/button"
import { GlowCard } from "@/components/catalog/glow-card"
import { HeroPremium } from "@/components/catalog/hero-3d"
import { HeroTitle } from "@/components/catalog/HeroTitle"
import {
  getPublicCommerceConfig, getCatalogFacets, getPublicSites, listPublicCatalog,
} from "@/lib/catalog-actions"
import { formatCurrency } from "@/lib/utils"
import { ArrowRight, ImageOff, MapPin, Sparkles, Store, Truck } from "lucide-react"

// Los productos y el stock cambian poco: revalidamos cada minuto
export const revalidate = 60

const LINE_NAMES: Record<string, string> = {
  CA: "Camisas", PA: "Pantalones", VE: "Vestidos de baño",
  SH: "Shorts", FA: "Faldas", JE: "Jeans", MO: "Monokinis",
  TE: "Tops", VB: "Vestidos", BL: "Blusas", CH: "Chaquetas",
}
const lineLabel = (c: string) => LINE_NAMES[c] || c

export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublicCommerceConfig()
  return {
    title: `${config.business_name} — Tienda en línea`,
    description:
      "Piezas que brillan como el oro. Consulta disponibilidad en nuestras sedes y pide en línea.",
    openGraph: {
      title: config.business_name,
      description: "Piezas que brillan como el oro.",
      type: "website",
    },
  }
}

export default async function LandingPage() {
  const [config, facets, sites, featured] = await Promise.all([
    getPublicCommerceConfig(),
    getCatalogFacets(),
    getPublicSites(),
    listPublicCatalog({ only_available: true, limit: 4 }),
  ])

  const storeSites = sites.filter((s) => !s.is_central)
  const brand = config.business_name || "Taiwy"

  return (
    <div className="relative">
      {/* Escena 3D como fondo fijo de TODA la página.
          Va detrás (z-0), el contenido flota encima (z-10). */}
      <HeroPremium />

      {/* ─────────────── HERO ─────────────── */}
      <section className="relative z-10 overflow-hidden">
        <div className="mx-auto flex min-h-[76vh] max-w-4xl flex-col items-center justify-end px-4 pb-10 pt-14 text-center sm:min-h-[80vh]">
          <p className="mt-4 text-[11px] uppercase tracking-[0.34em] text-[hsl(var(--gold-lo))]">
            Colección · Temporada
          </p>

          <HeroTitle text={`${brand.toUpperCase()} STORE`} />

          <p className="mt-5 max-w-[46ch] text-base uppercase tracking-[0.18em] leading-relaxed text-muted-foreground">
            La casa de la exclusividad
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-2 glow-gold">
              <Link href="/catalog/productos">
                Ver catálogo <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-gold-soft bg-transparent hover:border-gold-strong"
            >
              <Link href="/catalog/productos">Novedades</Link>
            </Button>
          </div>
        </div>

        {/* Degradado de cierre */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[hsl(var(--background))]" />
      </section>

      {/* ─────────────── DESTACADOS ─────────────── */}
      {featured.length > 0 && (
        <section className="relative z-10 mx-auto max-w-6xl px-4 py-16">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-[hsl(var(--gold-lo))]">
                <Sparkles className="h-3.5 w-3.5" />
                Destacados
              </p>
              <h2 className="mt-2 font-display text-3xl">Lo más reciente</h2>
            </div>
            <Link
              href="/catalog/productos"
              className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-[hsl(var(--gold-mid))]"
            >
              Ver todo →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {featured.map((p, idx) => (
              <Link key={p.product_id} href={`/catalog/${encodeURIComponent(p.code)}`} prefetch>
                <GlowCard className="h-full">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-[hsl(var(--muted))]">
                    {p.image_url ? (
                      <Image
                        src={p.image_url}
                        alt={p.name}
                        fill
                        // Los destacados quedan bajo el hero: cargan tarde,
                        // no compiten con el LCP. Sí lazy para ahorrar datos.
                        loading="lazy"
                        sizes="(max-width: 640px) 50vw, 25vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                      />
                    ) : (
                      <ImageOff className="h-9 w-9 text-[hsl(var(--gold-lo))] opacity-40" />
                    )}
                  </div>
                  <div className="space-y-1 p-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--gold-lo))]">
                      {p.code}
                    </div>
                    <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-medium">{p.name}</h3>
                    <div className="font-mono text-sm font-bold text-[hsl(var(--gold-mid))]">
                      {formatCurrency(Number(p.price))}
                    </div>
                  </div>
                </GlowCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─────────────── LÍNEAS ─────────────── */}
      {facets.lines.length > 0 && (
        <section className="relative z-10 mx-auto max-w-6xl px-4 py-16">
          <div className="mb-8 text-center">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[hsl(var(--gold-lo))]">
              Explora
            </p>
            <h2 className="mt-2 font-display text-3xl">Nuestras líneas</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {facets.lines.map((l) => (
              <Link key={l.code} href={`/catalog/productos?linea=${encodeURIComponent(l.code)}`}>
                <GlowCard className="h-full">
                  <div className="flex items-center justify-between p-6">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--gold-lo))]">
                        {l.code}
                      </div>
                      <h3 className="mt-1.5 font-display text-xl">{lineLabel(l.code)}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {l.count} {l.count === 1 ? "pieza" : "piezas"}
                      </p>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-[hsl(var(--gold-lo))] transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none" />
                  </div>
                </GlowCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─────────────── SEDES ─────────────── */}
      {storeSites.length > 0 && (
        <section className="relative z-10 mx-auto max-w-6xl px-4 py-16">
          <div className="mb-8 text-center">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[hsl(var(--gold-lo))]">
              Dónde estamos
            </p>
            <h2 className="mt-2 font-display text-3xl">Nuestras sedes</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Consulta la disponibilidad por sede antes de ir, o pide en línea y te lo enviamos.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {storeSites.map((s) => (
              <Link key={s.site_id} href={`/catalog/productos?sede=${encodeURIComponent(s.site_id)}`}>
                <GlowCard className="h-full" intensity={0.35}>
                  <div className="flex items-start gap-3 p-5">
                    <Store className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--gold-mid))]" />
                    <div className="min-w-0">
                      <h3 className="font-medium">{s.name}</h3>
                      {s.address && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                          {s.address}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-[hsl(var(--gold-lo))]">
                        Ver disponibilidad →
                      </p>
                    </div>
                  </div>
                </GlowCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─────────────── ENVÍO ─────────────── */}
      <section className="relative z-10 mx-auto max-w-4xl px-4 pb-20 pt-4">
        <GlowCard intensity={0.3}>
          <div className="flex flex-col items-center gap-4 p-8 text-center sm:flex-row sm:text-left">
            <Truck className="h-9 w-9 shrink-0 text-[hsl(var(--gold-mid))]" />
            <div className="flex-1">
              <h3 className="font-display text-xl">Envíos a domicilio</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {config.free_shipping_over
                  ? `Envío gratis en compras superiores a ${formatCurrency(Number(config.free_shipping_over))}.`
                  : "Recibe tu pedido en la puerta de tu casa."}
              </p>
            </div>
            <Button asChild className="shrink-0 gap-2 glow-gold-sm">
              <Link href="/catalog/productos">
                Comprar ahora <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </GlowCard>
      </section>
    </div>
  )
}
