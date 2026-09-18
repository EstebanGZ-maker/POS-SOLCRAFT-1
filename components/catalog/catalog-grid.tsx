"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import useSWR from "swr"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { GlowCard } from "@/components/catalog/glow-card"
import {
  getPublicSites, listPublicCatalog, getCatalogFacets,
  type PublicCatalogItem, type PublicSite, type CatalogFacets,
} from "@/lib/catalog-actions"
import { formatCurrency } from "@/lib/utils"
import { useCart } from "@/lib/cart-context"
import { useToast } from "@/hooks/use-toast"
import { Search, MapPin, PackageOpen, ImageOff, Plus, SlidersHorizontal } from "lucide-react"

const ALL = "__all__"

// Card agrupada: junta productos que solo se diferencian por talla. Clave
// (name, price, category_id) — alineada con public_product_sizes de la ficha.
// Los "grupos" con una sola talla renderizan como card simple sin selector
// para no agregar UI innecesaria al caso mayoritario en catálogos pequeños.
type SizeVariant = {
  product_id: string
  code: string
  size: string | null
  image_url: string | null
  is_available: boolean
}
type CatalogGroup = {
  key: string
  name: string
  price: number
  category_id: string | null
  representative: PublicCatalogItem  // variante con code mínimo — foto/link estable
  variants: SizeVariant[]            // deduplicadas por talla, ordenadas
  available_sites: string[]          // unión de sedes con stock
  is_available: boolean              // OR de variantes
}

function groupCatalog(items: PublicCatalogItem[]): CatalogGroup[] {
  const map = new Map<string, PublicCatalogItem[]>()
  for (const it of items) {
    const key = `${it.name}|${it.price}|${it.category_id ?? ""}`
    const arr = map.get(key)
    if (arr) arr.push(it)
    else map.set(key, [it])
  }
  const groups: CatalogGroup[] = []
  for (const [key, arr] of map) {
    // Representante: menor code lexicográfico — estable, no depende de stock.
    const sortedByCode = [...arr].sort((a, b) => a.code.localeCompare(b.code))
    const representative = sortedByCode[0]

    // Deduplicar por talla. Cuando el mismo (name, price, category_id, size)
    // aparece más de una vez (deuda técnica documentada — Uniforme Arsenal x8
    // XL, etc.), colapsar en un solo variant que hereda el product_id del
    // primero con stock, o del de menor code si ninguno tiene stock.
    const bySize = new Map<string, PublicCatalogItem[]>()
    for (const it of arr) {
      const s = it.size ?? ""
      const bag = bySize.get(s)
      if (bag) bag.push(it)
      else bySize.set(s, [it])
    }
    const variants: SizeVariant[] = []
    for (const [size, bag] of bySize) {
      const withStock = bag.find((b) => b.is_available)
      const pick = withStock ?? [...bag].sort((a, b) => a.code.localeCompare(b.code))[0]
      variants.push({
        product_id: pick.product_id,
        code: pick.code,
        size: size || null,
        image_url: pick.image_url,
        is_available: bag.some((b) => b.is_available),
      })
    }
    variants.sort((a, b) => (a.size ?? "").localeCompare(b.size ?? ""))

    const sitesUnion = Array.from(
      new Set(arr.flatMap((it) => it.available_sites)),
    ).sort()

    groups.push({
      key,
      name: representative.name,
      price: representative.price,
      category_id: representative.category_id,
      representative,
      variants,
      available_sites: sitesUnion,
      is_available: variants.some((v) => v.is_available),
    })
  }
  // Preservar orden del listado plano (RPC ya ordena por is_available DESC, name):
  // los grupos aparecen en el orden en que apareció por primera vez su representante.
  const firstIdxByKey = new Map<string, number>()
  items.forEach((it, i) => {
    const key = `${it.name}|${it.price}|${it.category_id ?? ""}`
    if (!firstIdxByKey.has(key)) firstIdxByKey.set(key, i)
  })
  groups.sort(
    (a, b) => (firstIdxByKey.get(a.key) ?? 0) - (firstIdxByKey.get(b.key) ?? 0),
  )
  return groups
}

interface Props {
  initialItems: PublicCatalogItem[]
  initialSites: PublicSite[]
  initialFacets: CatalogFacets
}

export function CatalogGrid(props: Props) {
  return (
    <Suspense fallback={null}>
      <CatalogGridInner {...props} />
    </Suspense>
  )
}

function CatalogGridInner({ initialItems, initialSites, initialFacets }: Props) {
  const params = useSearchParams()

  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [siteId, setSiteId] = useState<string>(params.get("sede") || ALL)
  const [line, setLine] = useState<string>(params.get("linea") || ALL)
  const [size, setSize] = useState<string>(params.get("talla") || ALL)
  // Agotados fuera por defecto: no cargar imágenes que nadie va a comprar
  const [onlyAvailable, setOnlyAvailable] = useState(params.get("ver_agotados") !== "1")
  const [showFilters, setShowFilters] = useState(
    Boolean(params.get("linea") || params.get("sede") || params.get("talla")),
  )

  const { addItem } = useCart()
  const { toast } = useToast()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // El servidor ya inyectó las 3 listas iniciales, así que el primer render
  // no espera a Supabase. SWR solo dispara refetch cuando cambian los filtros.
  const { data: sites = initialSites } = useSWR<PublicSite[]>(
    "catalog-sites", getPublicSites,
    { fallbackData: initialSites },
  )
  const { data: facets } = useSWR<CatalogFacets>(
    "catalog-facets", getCatalogFacets,
    { fallbackData: initialFacets },
  )

  // Solo refetch si los filtros server-side difieren de los iniciales. La talla
  // NO se envía al RPC — se filtra cliente-side sobre grupos completos, así una
  // familia con talla M seleccionada sigue mostrando todas sus tallas en el
  // selector con la M como default. p_size del RPC se mantiene vivo (otros
  // consumidores hipotéticos futuros) pero el catálogo pasa siempre null.
  const useInitial =
    siteId === ALL && !debounced && onlyAvailable === true && line === ALL
  const { data: items = initialItems, isLoading } = useSWR<PublicCatalogItem[]>(
    ["catalog-list", siteId, debounced, onlyAvailable, line],
    () => listPublicCatalog({
      site_id: siteId === ALL ? null : siteId,
      search: debounced,
      only_available: onlyAvailable,
      line: line === ALL ? null : line,
    }),
    { keepPreviousData: true, fallbackData: useInitial ? initialItems : undefined },
  )

  // Agrupación por (name, price, category_id). Filtro de talla se aplica sobre
  // los grupos: la familia se muestra si tiene esa talla como variante, pero
  // la card sigue exponiendo todas sus tallas para que el cliente vea qué más
  // existe. Cuando hay filtro activo, la talla filtrada se preselecciona.
  const allGroups = useMemo(() => groupCatalog(items), [items])
  const groups = useMemo(() => {
    if (size === ALL) return allGroups
    return allGroups.filter((g) => g.variants.some((v) => v.size === size))
  }, [allGroups, size])

  const storeSites = useMemo(() => sites.filter((s) => !s.is_central), [sites])
  const activeFilters =
    (siteId !== ALL ? 1 : 0) + (line !== ALL ? 1 : 0) + (size !== ALL ? 1 : 0) + (onlyAvailable ? 0 : 1)

  function handleAdd(e: React.MouseEvent, g: CatalogGroup, v: SizeVariant) {
    e.preventDefault()
    e.stopPropagation()
    addItem({
      product_id: v.product_id,
      code: v.code,
      name: g.name,
      price: Number(g.price),
      image_url: v.image_url,
    })
    toast({
      title: "Agregado al carrito",
      description: v.size ? `${g.name} — Talla ${v.size}` : g.name,
    })
  }

  function clearFilters() {
    setSiteId(ALL); setLine(ALL); setSize(ALL); setOnlyAvailable(true); setSearch("")
  }

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-6 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-[hsl(var(--gold-lo))]">Colección</p>
        <h1 className="mt-2 font-display text-4xl sm:text-5xl text-gold-gradient">Catálogo</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Piezas disponibles en nuestras sedes. Consulta y pide en línea.
        </p>
      </div>

      <div className="sticky top-[57px] z-20 border-y border-gold-soft bg-[hsl(var(--background)/0.9)] backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--gold-lo))]" />
              <Input
                className="border-gold-soft bg-transparent pl-9 placeholder:text-muted-foreground/70"
                placeholder="Buscar por nombre o código..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              className="relative gap-2 border-gold-soft bg-transparent hover:border-gold-strong"
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">Filtros</span>
              {activeFilters > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {activeFilters}
                </span>
              )}
            </Button>
          </div>

          {showFilters && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Sede</Label>
                <Select value={siteId} onValueChange={setSiteId}>
                  <SelectTrigger className="border-gold-soft bg-transparent"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas las sedes</SelectItem>
                    {storeSites.map((s) => (
                      <SelectItem key={s.site_id} value={s.site_id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Línea</Label>
                <Select value={line} onValueChange={setLine}>
                  <SelectTrigger className="border-gold-soft bg-transparent"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas las líneas</SelectItem>
                    {(facets?.lines || []).map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.name} ({l.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Talla</Label>
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger className="border-gold-soft bg-transparent"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas las tallas</SelectItem>
                    {(facets?.sizes || []).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="avail"
                    checked={!onlyAvailable}
                    onCheckedChange={(v) => setOnlyAvailable(!v)}
                  />
                  <Label htmlFor="avail" className="cursor-pointer text-sm">Mostrar agotados</Label>
                </div>
                {activeFilters > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters}>
                    Limpiar
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8">
        {isLoading && items.length === 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-gold-soft">
                <div className="aspect-square shimmer-gold" />
                <div className="space-y-2 p-3">
                  <div className="h-3 w-1/3 rounded shimmer-gold" />
                  <div className="h-4 w-full rounded shimmer-gold" />
                  <div className="h-4 w-1/2 rounded shimmer-gold" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <div className="py-20 text-center">
            <PackageOpen className="mx-auto mb-3 h-12 w-12 text-[hsl(var(--gold-lo))] opacity-50" />
            <p className="font-display text-lg">No encontramos productos</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {onlyAvailable
                ? "Estás viendo solo lo disponible. Activa 'Mostrar agotados' para ver el resto."
                : "Prueba con otros filtros o busca por otro nombre."}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {onlyAvailable && (
                <Button
                  variant="outline"
                  className="border-gold-soft bg-transparent"
                  onClick={() => setOnlyAvailable(false)}
                >
                  Ver también agotados
                </Button>
              )}
              {activeFilters > 0 && (
                <Button variant="outline" className="border-gold-soft bg-transparent" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>
          </div>
        )}

        {groups.length > 0 && (
          <>
            <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
              {groups.length} {groups.length === 1 ? "pieza" : "piezas"}
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {groups.map((g, idx) => (
                <GroupCard
                  key={g.key}
                  group={g}
                  priority={idx < 8}
                  showSites={siteId === ALL}
                  preselectedSize={size === ALL ? null : size}
                  onAdd={handleAdd}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Card por grupo con selector inline. Estado local de talla seleccionada
// para poder actualizar la foto y el link a la ficha en tiempo real cuando
// el cliente cambia de talla — cada variante tiene su propia foto real,
// así que el cliente ve exactamente la prenda que va a comprar antes de
// agregarla al carrito, no una foto genérica.
function GroupCard({
  group,
  priority,
  showSites,
  preselectedSize,
  onAdd,
}: {
  group: CatalogGroup
  priority: boolean
  showSites: boolean
  preselectedSize: string | null
  onAdd: (e: React.MouseEvent, g: CatalogGroup, v: SizeVariant) => void
}) {
  const hasSizeSelector = group.variants.length > 1

  // Preselección: (1) la talla del filtro si está en el grupo,
  // (2) la primera talla con stock, (3) la primera del grupo.
  const initialSize = (() => {
    if (preselectedSize) {
      const m = group.variants.find((v) => v.size === preselectedSize)
      if (m) return m.size
    }
    const firstAvail = group.variants.find((v) => v.is_available)
    if (firstAvail) return firstAvail.size
    return group.variants[0]?.size ?? null
  })()

  const [selectedSize, setSelectedSize] = useState<string | null>(initialSize)

  // El variant activo determina foto y product_id del "Agregar". Fallback
  // al representante si por alguna razón no se encontró el variant elegido
  // (edge inesperado, no debería pasar en flujo normal).
  const active =
    group.variants.find((v) => v.size === selectedSize) ??
    group.variants[0] ?? {
      product_id: group.representative.product_id,
      code: group.representative.code,
      size: group.representative.size,
      image_url: group.representative.image_url,
      is_available: group.is_available,
    }

  const displayImage = active.image_url ?? group.representative.image_url
  const displayCode = hasSizeSelector ? group.representative.code : active.code
  const linkHref = `/catalog/${encodeURIComponent(active.code)}`

  return (
    <Link href={linkHref} prefetch className="block">
      <GlowCard className={`h-full ${!group.is_available ? "opacity-60" : ""}`}>
        <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-[hsl(var(--muted))]">
          {displayImage ? (
            <Image
              src={displayImage}
              alt={group.name}
              fill
              // Las 8 primeras son las que ve el visitante sin scroll:
              // se cargan con prioridad, el resto queda perezosa.
              priority={priority}
              loading={priority ? undefined : "lazy"}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
            />
          ) : (
            <ImageOff className="h-10 w-10 text-[hsl(var(--gold-lo))] opacity-40" />
          )}

          {!hasSizeSelector && active.size && (
            <span className="absolute left-2 top-2 rounded-full border border-[hsl(var(--gold-mid)/0.5)] bg-[hsl(var(--background)/0.8)] px-2 py-0.5 font-mono text-[10px] text-[hsl(var(--gold-mid))] backdrop-blur">
              Talla {active.size}
            </span>
          )}

          <span
            className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur ${
              group.is_available
                ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                : "border border-white/15 bg-black/50 text-muted-foreground"
            }`}
          >
            {group.is_available ? "Disponible" : "Agotado"}
          </span>
        </div>

        <div className="space-y-1.5 p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--gold-lo))]">
            {displayCode}
          </div>
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-medium">{group.name}</h3>
          <div className="font-mono text-base font-bold text-[hsl(var(--gold-mid))]">
            {formatCurrency(Number(group.price))}
          </div>

          {group.available_sites.length > 0 && showSites && (
            <div className="flex items-start gap-1 pt-0.5 text-[10px] text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-1">{group.available_sites.join(" · ")}</span>
            </div>
          )}

          {hasSizeSelector && (
            <div
              className="flex flex-wrap gap-1 pt-1"
              onClick={(e) => {
                // El Link envolvente navega a la ficha si se hace click en cualquier
                // parte de la card. El selector de talla es interactivo — atajamos
                // el bubbling para que apretar un chip NO dispare la navegación.
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {group.variants.map((v) => {
                const label = v.size ?? "-"
                const isSelected = v.size === selectedSize
                const disabled = !v.is_available
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={disabled}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedSize(v.size)}
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-mono transition ${
                      disabled
                        ? "border-white/10 bg-white/5 text-muted-foreground line-through opacity-50 cursor-not-allowed"
                        : isSelected
                          ? "border-[hsl(var(--gold-mid))] bg-[hsl(var(--gold-mid)/0.15)] text-[hsl(var(--gold-mid))]"
                          : "border-gold-soft bg-transparent hover:border-gold-strong"
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          {active.is_available && (
            <Button
              type="button"
              size="sm"
              className="mt-2 w-full gap-1 font-medium glow-gold-sm"
              onClick={(e) => onAdd(e, group, active)}
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar
            </Button>
          )}
        </div>
      </GlowCard>
    </Link>
  )
}
