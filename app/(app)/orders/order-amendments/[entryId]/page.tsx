import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getAmendmentEntry } from "@/lib/orders/order-amendments/service";
import { AmendmentEntryScreen } from "./entry-screen";

/**
 * Orders ▸ Order Amendments ▸ one entry — the variance audit, what changed,
 * the downstream documents and the approval (doc/order/amedment.md §2–§5).
 * A `[id]` route: its tables are part of a document, not listings.
 */
export default async function AmendmentEntryPage({ params }: { params: Promise<{ entryId: string }> }) {
  await requirePermission("orders", "view");
  const { entryId } = await params;
  const canEdit = await can("orders", "edit");
  const detail = await getAmendmentEntry(entryId, canEdit);
  if (!detail) notFound();
  return <AmendmentEntryScreen detail={detail} />;
}
