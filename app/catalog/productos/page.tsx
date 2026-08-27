import type { Metadata } from "next"
import { CatalogGrid } from "@/components/catalog/catalog-grid"
import {
  getPublicSites, listPublicCatalog, getCatalogFacets, getPublicCommerceConfig,
} from "@/lib/catalog-actions"

// Server Component: precarga los tres datasets iniciales en paralelo y los
// entrega ya renderizados. El cliente no espera a Supabase para el primer
// pintado — SWR toma el relevo al cambiar filtros.
export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublicCommerceConfig()
  return {
    title: `Catálogo — ${config.business_name}`,
    description: "Piezas disponibles en nuestras sedes. Consulta y pide en línea.",
  }
}

export default async function CatalogPage() {
  // Solo cargamos lo disponible: es lo que verá el visitante por defecto.
  const [sites, facets, items] = await Promise.all([
    getPublicSites(),
    getCatalogFacets(),
    listPublicCatalog({ only_available: true }),
  ])

  return (
    <CatalogGrid
      initialItems={items}
      initialSites={sites}
      initialFacets={facets}
    />
  )
}
