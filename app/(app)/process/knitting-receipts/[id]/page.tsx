import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getKnittingReceiptDoc } from "@/lib/production/knitting-service";
import { KnitReceiptView } from "../../knitting-hub/_components/knit-receipt-view";

/** Process ▸ Knitting ▸ Fabric Receipts ▸ one receipt, read-only (user 2026-11-12). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("stores", "view");
  const { id } = await params;
  const doc = await getKnittingReceiptDoc(id);
  if (!doc || doc.kind !== "fabric") notFound();
  return <KnitReceiptView doc={doc} />;
}
