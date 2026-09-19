import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getAdvisedOrder } from "@/lib/orders/advised/service";
import { AdvisedLinesScreen } from "../advised-lines-screen";

/**
 * Orders ▸ Advised Items ▸ one order (RE No) — its advised Material BOM lines
 * and their conversion. See `advised-lines-screen.tsx`.
 */
export default async function AdvisedOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("orders", "view");
  const { orderId } = await params;

  const [advised, canConvert] = await Promise.all([
    getAdvisedOrder(orderId),
    // CONVERTING EDITS A MATERIAL BOM LINE, so it answers to the permission
    // that edits one; the action checks it again.
    can("orders", "edit"),
  ]);
  if (!advised) notFound();

  return (
    <AdvisedLinesScreen
      order={advised.order}
      lines={advised.lines}
      coloursByItem={advised.coloursByItem}
      canConvert={canConvert}
    />
  );
}
