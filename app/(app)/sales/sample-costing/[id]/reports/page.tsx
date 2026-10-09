import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { revisionShort } from "@/lib/sales/sample-costing/types";
import { getCostingLetterhead, getCostingApprovalFacts, getCostingRevisionSources, getSampleCostingFormData, getSampleCostingRecord } from "@/lib/sales/sample-costing/service";
import { buildRevisionHistory } from "@/lib/sales/sample-costing/revision-history";
import { buildCostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import { buildQuotationModel } from "@/lib/sales/sample-costing/quotation";
import { PageHeader } from "@/components/ui/page-header";
import { CostingReports } from "./costing-reports";
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
 * `?tab=quotation` opens the Quotation; anything else opens the Cost Sheet.
 */
export const metadata = { title: "Costing Reports" };

/** Why Revise is unavailable for a costing in this state, or null when it works.
 *  Same rule as the editor's Revise (approved only) — said in words. */
function reviseReason(status: string, isDraft: boolean | null): string | null {
  if (status === "approved") return null;
  if (isDraft || status === "draft") return "This costing is still a Draft — edit it directly. Revise starts a new revision once it is approved.";
  if (status === "submitted") return "This costing is with the MD — Revise becomes available once it is approved.";
  if (status === "rejected") return "This costing was rejected — edit and resubmit it directly.";
  if (status === "superseded") return "A later revision replaced this one — open the latest revision to revise it.";
  return "Only an approved costing can be revised.";
}

export default async function CostingReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("sales", "view");
  const [{ id }, sp, canEdit] = await Promise.all([params, searchParams, can("sales", "edit")]);
  const [record, data, letterhead] = await Promise.all([getSampleCostingRecord(id), getSampleCostingFormData(), getCostingLetterhead()]);
  if (!record) notFound();
  /* ONE ROUND, NOT TWO — the revisions and the approval are independent reads that
     only need the record's code and id, and each round trip is ~260 ms. */
  const [revisionSources, facts] = await Promise.all([getCostingRevisionSources(record.code), getCostingApprovalFacts(record.id)]);
  const history = buildRevisionHistory(revisionSources, record.id);
  const cost = buildCostSheetModel(record, data, letterhead, history, facts);
  const quote = buildQuotationModel(record, data, letterhead, history, facts);
  return (
    <div className="space-y-4">
      <PageHeader title="Costing Reports" description={[cost.costingNo, cost.revision, cost.style].filter(Boolean).join(" · ")} />
      <CostingReports
        cost={cost}
        quote={quote}
        initial={sp.tab === "quotation" ? "quotation" : "cost-sheet"}
        /* REVISE FROM THE REPORT (client 2026-10-09) — offered under the editor's own
           two conditions: the costing is APPROVED and the reader may edit. A draft or
           one with the MD is edited in place, and a superseded revision is history. */
        source={{
          record,
          /* ONLY WHAT THIS COSTING NAMES goes to the browser (not every enquiry and
             style in the register): the report re-builds both documents from a working
             copy, and needs just its own sample, its style and the component / trim
             names. */
          lookups: {
            enquiries: data.enquiries.filter((e) => e.id === record.draft.header.opportunity_id),
            styles: data.styles.filter((s) => s.id === record.draft.header.style_id),
            components: data.components,
            trims: data.trims,
          },
          company: letterhead,
          options: {
            fabrics: live(data.fabrics),
            yarns: live(data.yarns),
            processes: live(data.processes),
            garmentProcesses: data.garmentProcesses.filter((r) => !isInactive(r)).map((r) => ({ id: r.id, name: r.name, garment_kind: r.garment_kind })),
            components: live(data.components),
            trims: live(data.trims),
          },
          history,
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
