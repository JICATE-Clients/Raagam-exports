import { notFound, redirect } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { revisionShort } from "@/lib/sales/sample-costing/types";
import { getCostingLetterhead, getCostingApprovalFacts, getCostingRevisionSources, getSampleCostingFormData, getSampleCostingRecord, getSiblingCostingRecords } from "@/lib/sales/sample-costing/service";
import { buildRevisionHistory } from "@/lib/sales/sample-costing/revision-history";
import { buildCostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import { buildQuotationModel } from "@/lib/sales/sample-costing/quotation";
import { PageHeader } from "@/components/ui/page-header";
import { CostingReports, REVISE_SCREEN } from "./costing-reports";
import { isEditableStatus } from "@/lib/sales/sample-costing/types";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";

/** A master list as the report's row pickers take it: live rows only, id and name only. */
const live = <T extends { id: string; name: string } & Deactivatable>(rows: readonly T[]) => rows.filter((r) => !isInactive(r)).map((r) => ({ id: r.id, name: r.name }));

/**
 * COSTING ▸ REPORTS, at `/sales/sample-costing/<costing id>/reports`.
 *
 * The one door the list's Reports icon opens (as Order Entry's does for an
 * order): the internal Cost Sheet and the buyer's Quotation, side by side as
 * tabs. Both are documents of ONE saved costing and are built here, from the same
 * record, so the page, its PDF and its Excel file can never disagree. It lists
 * nothing and edits nothing, so it carries no pager and no reload guard.
 *
 * `?tab=quotation` opens the Quotation, `?tab=charts` the Charts; anything else the Cost Sheet.
 */
export const metadata = { title: "Costing Reports" };

/** Why Revise is unavailable for a costing in this state, or null when it works.
 *  Same rule as the editor's Revise (0725: Under Progress, Approved or Rejected —
 *  each buyer counter-offer is a Rev) — said in words. */
function reviseReason(status: string, isDraft: boolean | null): string | null {
  if (status === "approved" || status === "submitted" || status === "rejected") return null;
  if (isDraft || status === "draft") return "This costing is still a Draft — edit it directly. Once it is saved it is Under Progress with the buyer, and can be revised.";
  if (status === "superseded") return "A later revision replaced this one — open the latest revision to revise it.";
  return "Only a costing that is Under Progress, Approved or Rejected can be revised.";
}

export default async function CostingReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; revise?: string }>;
}) {
  await requirePermission("sales", "view");
  const [{ id }, sp, canEdit] = await Promise.all([params, searchParams, can("sales", "edit")]);
  const [record, data, letterhead] = await Promise.all([getSampleCostingRecord(id), getSampleCostingFormData(), getCostingLetterhead()]);
  if (!record) notFound();
  /* `?revise=1` — every screen's "Raise Revise" used to land here and edit the next Rev
     in this page's sheet. Revising is done in the costing ENTRY screen now (user
     2026-10-22, Costing 6), so the link goes straight on there; one the reader may not
     act on (no edit permission, or a status that is not revised) shows the report. */
  if (sp.revise === "1" && canEdit && !reviseReason(record.status, record.is_draft)) {
    redirect(`${REVISE_SCREEN}?reviseFrom=${record.id}`);
  }
  /* ONE ROUND, NOT TWO — the revisions and the approval are independent reads that
     only need the record's code and id, and each round trip is ~260 ms. */
  const [revisionSources, facts, siblings] = await Promise.all([
    getCostingRevisionSources(record.code),
    getCostingApprovalFacts(record.id),
    // The sample's other costed styles: the Quotation lists every style (2026-10-22).
    getSiblingCostingRecords(record.draft.header.opportunity_id, record.draft.header.style_id),
  ]);
  const history = buildRevisionHistory(revisionSources, record.id);
  const cost = buildCostSheetModel(record, data, letterhead, history, facts);
  const quote = buildQuotationModel(record, data, letterhead, history, facts, siblings);
  return (
    // FILLS <main> (a flex column of fixed height) so the revision save bar can sit
    // at the BOTTOM of the screen on a short tab — the MasterFullScreen footer's
    // rule: sticky bottom-0 only reaches the bottom of its own container.
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Costing Reports"
        description={[cost.costingNo, cost.revision, cost.style].filter(Boolean).join(" · ")}
        /* The way back lives IN the report toolbar now (CostingReports' `lead`): the
           header floats it right of the toolbar, and a float has nothing to sit
           beside in this flex column, so it took a row of its own (user 2026-10-15,
           screenshot 3523: "back costing need to relocate into the bar"). */
        back={false}
      />
      <CostingReports
        cost={cost}
        quote={quote}
        initial={sp.tab === "quotation" || sp.tab === "charts" ? sp.tab : "cost-sheet"}
        /* RAISE REVISE (user 2026-10-14): Costing's Under Progress "Raise Revise"
           lands here with `?revise=1` — the Quotation opens already revising; Save
           writes the next Rev and every earlier Rev stays in the history. */
        openRevising={false}
        /* REVISE FROM THE REPORT (client 2026-10-09) — offered under the editor's own
           conditions: the costing is Under Progress, Approved or Rejected (0725) and
           the reader may edit. A Draft is edited in place, and a superseded revision
           is history. */
        source={{
          record,
          /* ONLY WHAT THIS COSTING NAMES goes to the browser (not every enquiry and
             style in the register): the report re-builds both documents from a working
             copy, and needs just its own sample, its style and the component / trim
             names. */
          lookups: {
            enquiries: data.enquiries.filter((e) => e.id === record.draft.header.opportunity_id),
            // Its own style and the sample's other costed styles (the Quotation's listing).
            styles: data.styles.filter((s) => s.id === record.draft.header.style_id || siblings.some((r) => r.draft.header.style_id === s.id)),
            components: data.components,
            trims: data.trims,
          },
          company: letterhead,
          options: {
            fabrics: live(data.fabrics),
            yarns: live(data.yarns),
            processes: live(data.processes),
            garmentProcesses: data.garmentProcesses.filter((r) => !isInactive(r)).map((r) => ({ id: r.id, name: r.name, garment_kind: r.garment_kind, cmt_stage: r.cmt_stage, standard_rate: r.standard_rate })),
            components: live(data.components),
            trims: live(data.trims),
            lockedFabrics: data.styles.find((s) => s.id === record.draft.header.style_id)?.structures.map((x) => x.id) ?? [],
          },
          history,
          siblings,
          /* STILL REACHABLE AFTER 0728: a Rev raised from a REJECTED costing starts
             as a Draft (save_sample_costing's parent branch), so "Send to Buyer" is
             how it goes back Under Progress without reopening the editor. A Sample
             Revision's proposal is also a Draft; the action refuses that one. */
          canSubmit: canEdit && record.status === "draft" && !record.is_draft && isEditableStatus(record.status),
        }}
        revise={
          canEdit
            ? {
                id: record.id,
                nextLabel: revisionShort(record.version + 1),
                /* GREYED, SAYING WHY — never hidden (the standing rule for a locked
                   record's actions): an absent button cannot tell "not yet" from
                   "not for you". Only a missing permission hides it. */
                reason: reviseReason(record.status, record.is_draft),
              }
            : null
        }
      />
    </div>
  );
}
