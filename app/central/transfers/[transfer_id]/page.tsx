import { notFound } from "next/navigation"
import { getTransferDetail } from "@/lib/inventory-actions"
import { TransferDetailClient } from "@/components/central/transfer-detail-client"

interface PageProps {
  params: Promise<{ transfer_id: string }>
}

export default async function TransferDetailPage({ params }: PageProps) {
  const { transfer_id } = await params
  const detail = await getTransferDetail(transfer_id)
  if (!detail) notFound()
  return <TransferDetailClient initialDetail={detail as any} />
}
