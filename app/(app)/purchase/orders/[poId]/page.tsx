import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getPurchaseOrder,
  getItems,
  getUoms,
} from "@/lib/purchase/po-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { PO_STATUS_LABELS } from "@/lib/purchase/types";
import type { PoStatus } from "@/lib/purchase/types";
import { PoDetail } from "./po-detail";
import { PoReview } from "./po-review";
import { PoChangeActions } from "./po-change-actions";
import { getRequirementLines } from "@/lib/purchase/re-po/service";
import { statusTone } from "@/lib/ui/status-tone";
import { getPoBudgetVariance, type PoVariance } from "@/lib/purchase/po-escalation";
import { loadPoApprovalSheet } from "@/lib/purchase/po-approval-sheet-actions";
import { loadPoApprovalCards } from "@/lib/approvals/po-approval-cards";
import { poBudgetState } from "@/lib/approvals/po-budget-state";
import { withCreators } from "@/lib/created-by";
import { PoApprovalOverview } from "../../po-approval/po-approval-overview";
import { PoDecisionBar } from "../../po-approval/po-decision-bar";
import { BackLink } from "@/components/ui/back-link";

const PO_STATUS_TONE_OVERRIDES = {
  // Approved is a step in this document's life, not its end — work still follows it (was info before the shared table, kept).
  approved: "info",
} as const;

function poStatusTone(status: PoStatus): StatusTone {
  return statusTone(status, PO_STATUS_TONE_OVERRIDES);
}

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { poId } = await params;

  const [po, items, uoms, canEdit, canDelete, canApprove] = await Promise.all([
    getPurchaseOrder(poId),
    getItems(),
    getUoms(),
    can("materials_purchase", "edit"),
    can("materials_purchase", "delete"),
    can("materials_purchase", "approve"),
  ]);

  if (!po) notFound();

  /* RAISED ON RAISE PO (its lines carry a req_key) → the one-screen review with
     Approve · Revise · Reject (user 2026-10-26). Every other PO keeps the tabs. */
  const poLines = po.lines as unknown as { req_key?: string | null; garment_order_id?: string | null; iwo_id?: string | null }[];
  const raised = poLines.some((l) => l.req_key);
  /* A PENDING PO OPENS IN THE APPROVAL FORMAT (user 2026-11-04, screenshot 4036: the
     page's own "Revise · Reject · Approve" strip and a sideways-scrolling line table were
     not the approval screens' format). Orders ▸ Approval's shape: the decisions in the
     HEADER (`PoDecisionBar`, the same bar PO Approval's full page mounts), the 3-column
     overview below — profile card · tiles, ring, lines · trail. A PO with no run (sent
     before 0764) keeps `PoReview`, whose own buttons are its only way to be decided. */
  if (raised && po.status === "pending_approval") {
    const [sheet, cards] = await Promise.all([loadPoApprovalSheet(po.id), loadPoApprovalCards([po.id]).catch(() => ({}))]);
    if (sheet.po && sheet.panel.run) {
      const [creator] = await withCreators([{ created_by: (po as { created_by?: string | null }).created_by ?? "" }]);
      const raisedBy = (creator as { created_by_name?: string | null }).created_by_name ?? null;
      const card = (cards as Record<string, Parameters<typeof poBudgetState>[0]>)[po.id];
      return (
        <div className="space-y-4">
          <PageHeader
            title={po.code ?? "Purchase Order"}
            description={`Vendor: ${po.vendor_name ?? "—"} · Order date: ${fmtDate(po.order_date)}`}
          />
          {/* THE DECISIONS ON THEIR OWN ROW, NOT IN `actions` (screenshot 4037): PageHeader
              FLOATS its actions right, and the 3-column overview's grid narrowed to sit
              beside the float — tiles cut to "₹7,41…", the lines table lost its Amount
              column, the override note ran over Taxable. A full-width row above keeps the
              whole pane for the overview, as the Sheet's header bar does on PO Approval. */}
          {/* ← BACK ON THE LEFT, THE DECISIONS ON THE RIGHT (user 2026-11-04: "there is no
              back button"). A document route resolves no automatic Back (lib/nav/
              back-target.ts), so it is named here: a pending PO is decided from PO
              Approval, so that is where Back goes. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <BackLink target={{ href: "/purchase/po-approval", label: "PO Approval" }} />
            {sheet.panel.verdict?.can_act && (
              <PoDecisionBar
                run={sheet.panel.run}
                verdict={sheet.panel.verdict}
                poId={po.id}
                overBudget={poBudgetState(card) === "over"}
                subjectPath={`/purchase/orders/${po.id}`}
              />
            )}
          </div>
          <PoApprovalOverview
            po={sheet.po}
            uoms={sheet.uoms}
            sourceNos={sheet.sourceNos}
            variance={sheet.variance}
            statusPill={<StatusPill tone={poStatusTone(po.status)}>{PO_STATUS_LABELS[po.status]}</StatusPill>}
            timeline={sheet.panel.timeline}
            names={sheet.panel.names ?? {}}
            raisedBy={raisedBy}
            override={!!sheet.panel.verdict?.can_act && !!sheet.panel.verdict.is_override}
          />
        </div>
      );
    }
  }

  let sourceNos: Record<string, string> = {};
  /* BUDGET vs QUOTED, for the MD only (above-budget escalation, 2026-10-27). Read for an
     approver; anyone else gets null and the screen shows no budget figure (spec point 7). */
  let variance: PoVariance | null = null;
  if (raised) {
    const ids = [...new Set(poLines.map((l) => l.garment_order_id ?? l.iwo_id).filter((v): v is string => !!v))];
    const req = ids.length ? await getRequirementLines(ids) : [];
    sourceNos = Object.fromEntries(req.map((l) => [l.source_id, l.source_no]));
    if (canApprove) variance = await getPoBudgetVariance(po.lines as unknown as Parameters<typeof getPoBudgetVariance>[0], req);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={po.code ?? "Purchase Order"}
        description={`Vendor: ${po.vendor_name ?? "—"} · Order date: ${fmtDate(po.order_date)}`}
        /* ← Back (user 2026-11-04): a PO is raised on Raise PO, the old Purchase Orders
           list now redirects there — so that is the screen above a PO's own page. */
        back={{ href: "/purchase/requirement-po", label: "Raise PO" }}
        actions={
          <div className="flex items-center gap-2">
            {/* A Raise PO review carries its status on its own title line (screenshot 3818). */}
            {raised ? null : (
              <StatusPill tone={poStatusTone(po.status)}>
                {PO_STATUS_LABELS[po.status]}
              </StatusPill>
            )}
            {/* The vendor copy (user 2026-10-27) — only once approved (spec point 8). */}
            {po.status === "approved" ? (
              <Link href={`/purchase/orders/${po.id}/print`} className={buttonClasses({ variant: "outline", size: "md" })}>
                <Printer aria-hidden className="size-4" />
                Print PO
              </Link>
            ) : null}
            {/* Rate amendment and cancellation go to the MD (0785). */}
            {canEdit && ["approved", "partially_received"].includes(po.status) ? <PoChangeActions poId={po.id} /> : null}
          </div>
        }
      />

      {/* The tab reads the PO number, not the route's uuid (screenshot 3818). */}
      {raised ? (
        <PoReview
          po={po}
          uoms={uoms}
          sourceNos={sourceNos}
          canEdit={canEdit}
          canApprove={canApprove}
          variance={variance}
          statusPill={<StatusPill tone={poStatusTone(po.status)}>{PO_STATUS_LABELS[po.status]}</StatusPill>}
        />
      ) : (
      <PoDetail
        po={po}
        items={items}
        uoms={uoms}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
      )}
    </div>
  );
}
