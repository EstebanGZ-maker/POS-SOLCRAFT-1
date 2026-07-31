"use client"

import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getTransfers } from "@/lib/inventory-actions"
import { Truck } from "lucide-react"

export default function TransfersPage() {
  const { data: transfers = [], isLoading } = useSWR("transfers", getTransfers)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Historial de envíos"
        description="Consulta los envíos de mercancía realizados desde la Bodega Central a las sedes."
        icon={Truck}
      />

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3 font-medium">Número</th>
                <th className="p-3 font-medium">Fecha</th>
                <th className="p-3 font-medium">Origen</th>
                <th className="p-3 font-medium">Destino</th>
                <th className="p-3 font-medium text-right">Productos</th>
                <th className="p-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Aún no se han registrado envíos.
                  </td>
                </tr>
              ) : (
                transfers.map((t: any) => (
                  <tr key={t.transfer_id} className="border-t">
                    <td className="p-3 font-medium text-primary">#{t.number}</td>
                    <td className="p-3">
                      {new Date(t.transfer_date).toLocaleDateString("es-CO")}
                    </td>
                    <td className="p-3">
                      {t.from_wh?.sites?.name} · {t.from_wh?.name}
                    </td>
                    <td className="p-3">
                      {t.to_wh?.sites?.name} · {t.to_wh?.name}
                    </td>
                    <td className="p-3 text-right">{t.transfer_items?.length ?? 0}</td>
                    <td className="p-3">
                      <Badge
                        variant="secondary"
                        className={
                          t.status === "recibido"
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : t.status === "en_transito"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            : t.status === "recibido_con_pendiente"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                            : ""
                        }
                      >
                        {t.status === "completed"
                          ? "Completado"
                          : t.status === "en_transito"
                          ? "En tránsito"
                          : t.status === "recibido"
                          ? "Recibido"
                          : t.status === "recibido_con_pendiente"
                          ? "Parcial"
                          : t.status}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
