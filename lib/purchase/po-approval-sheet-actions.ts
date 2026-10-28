"use server";

import { can } from "@/lib/auth/server";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getPurchaseOrder, getUoms } from "@/lib/purchase/po-service";
import { getRequirementLines } from "@/lib/purchase/re-po/service";
import { getPoBudgetVariance } from "@/lib/purchase/po-escalation";

/**
 * Everything Purchase ▸ PO Approval's full view reads when it OPENS — the PO, its RE /
 * SWO / IWO numbers, the budget rates (approvers only, spec point 7) and the approval
 * panel — in ONE server action, the halves in parallel. Loaded on open, not for every
 * row: the queue can hold dozens of POs and one gets read (the budget approval sheet's
 * `loadBudgetApprovalSheet`, same reason).
 */
export async function loadPoApprovalSheet(poId: string) {
  const empty = { po: null, uoms: [], sourceNos: {}, variance: null, panel: { run: null, verdict: null, timeline: [], names: {} } };
  if (!(await can("materials_purchase", "view"))) return empty;

  const [po, uoms, canApprove, panel] = await Promise.all([
    getPurchaseOrder(poId),
    getUoms(),
    can("materials_purchase", "approve"),
    getApprovalPanel(WORKFLOWS.purchase_order.subjectTable, poId),
  ]);
  if (!po) return empty;

  const lines = po.lines as unknown as { garment_order_id?: string | null; iwo_id?: string | null }[];
  const ids = [...new Set(lines.map((l) => l.garment_order_id ?? l.iwo_id).filter((v): v is string => !!v))];
  const req = ids.length ? await getRequirementLines(ids) : [];
  const sourceNos: Record<string, string> = Object.fromEntries(req.map((l) => [l.source_id, l.source_no]));
  const variance = canApprove
    ? await getPoBudgetVariance(po.lines as unknown as Parameters<typeof getPoBudgetVariance>[0], req)
    : null;

  return { po, uoms, sourceNos, variance, panel };
}
