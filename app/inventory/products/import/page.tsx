import { getImportBootstrap } from "@/lib/product-import-actions"
import { ProductImportWizard } from "@/components/inventory/product-import-wizard"
import { PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function ImportProductsPage() {
  // getImportBootstrap ya hace requireRole("admin","encargado") adentro.
  // Si el usuario no cumple, throw → Next lo muestra como error page.
  const bootstrap = await getImportBootstrap()

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader
        title="Importar productos"
        description="Cargá múltiples productos a la vez desde una plantilla .xlsx. Máximo 1000 filas por archivo."
      />
      <ProductImportWizard bootstrap={bootstrap} />
    </div>
  )
}
