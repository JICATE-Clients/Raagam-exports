import { requirePermission, can } from "@/lib/auth/server";
import { listRaisedPos } from "@/lib/purchase/re-po/service";
import { loadPoApprovalCards } from "@/lib/approvals/po-approval-cards";
import { PoApprovalScreen } from "./po-approval-screen";

/**
 * Purchase ▸ Procurement ▸ PO Approval (user 2026-10-28: "take reference from the order
 * approval screen … at most match it … add under Raise PO").
 *
 * A QUEUE OVER `purchase_orders.status`, the shape of Orders ▸ Approval: every PO raised
 * on Raise PO (`listRaisedPos`), each with its My Approvals card (`loadPoApprovalCards`
 * — value, lines, above-budget count and profit hit, so the list and the inbox cannot
 * disagree). Opening one reads the PO and its approval run on demand.
 */
export default async function PoApprovalPage({
  searchParams,
}: {
  /** `?open=<po id>` — a notice's link opens THAT PO, as Orders ▸ Approval does. */
  searchParams: Promise<{ open?: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { open } = await searchParams;

  const [rows, canApprove] = await Promise.all([listRaisedPos(), can("materials_purchase", "approve")]);
  // An enrichment: if it fails the list still renders, keyed on the PO alone.
  const cards = await loadPoApprovalCards(rows.map((r) => r.id)).catch((e: unknown) => {
    console.error("[po-approval] cards:", e instanceof Error ? e.message : e);
    return {};
  });

  return (
    <PoApprovalScreen
      rows={rows}
      cards={cards}
      canApprove={canApprove}
      initialOpenId={open && rows.some((r) => r.id === open) ? open : null}
    />
  );
}
