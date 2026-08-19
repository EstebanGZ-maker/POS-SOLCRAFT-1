import { notFound } from "next/navigation"
import { getReceivableSaleDetail } from "@/lib/actions"
import { ReceivableSaleDetailClient } from "@/components/credit/receivable-sale-detail-client"

interface PageProps {
  params: Promise<{ sale_id: string }>
}

export default async function ReceivableSaleDetailPage({ params }: PageProps) {
  const { sale_id } = await params
  const detail = await getReceivableSaleDetail(sale_id)
  if (!detail) notFound()
  return <ReceivableSaleDetailClient initialDetail={detail} />
}
