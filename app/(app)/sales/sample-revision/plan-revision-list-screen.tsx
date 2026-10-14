"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { SampleCards, type SampleCardState } from "@/components/sales/sample-queue";
import { PlanRevisionSheet, type PlanRevisionChoice } from "@/components/sales/plan-revision-sheet";
import { fmtNumber } from "@/lib/format";
import type { PlanApprovalRow } from "@/lib/sales/plan-reports/service";
import { PLAN_EDITOR_PATH, PLAN_KIND_LABEL } from "@/lib/sales/plan-reports/types";
import { planStatusText } from "../plan-approval/plan-words";

/**
 * SAMPLE ▸ REVISION — FABRIC PLAN AND ACCESSORIES PLAN ONLY (user 2026-10-14:
 * "for fabric and accessories plan approval revision only, not for SMP").
 *
 * The plans Plan Approval has APPROVED are what a revision is raised on, so
 * this lists exactly those, plus every plan whose revision is still on its
 * way back to approval:
 *
 *  - PENDING — a revision in progress: reopened for editing (`open` with a
 *    revision number), with the approver, or sent back for rework;
 *  - UPDATED — approved and standing (V0 or an approved revision). Raise
 *    Revision is offered here, and only here.
 *
 * Raising goes through the plan editors' own `PlanRevisionSheet` (0718 / 0720,
 * V0 snapshot since 0727), so the two doors cannot disagree. A plan that was
 * never approved is not listed: it has nothing to revise, and Plan Approval is
 * where it waits.
 */

/** A plan with a revision under way, else a standing approved plan. */
const wordOf = (r: PlanApprovalRow): QuickWord => (r.status === "approved" ? "updated" : "pending");
const stateOf = (r: PlanApprovalRow): SampleCardState => (r.status === "approved" ? "updated" : "pending");

const toBuy = (r: PlanApprovalRow) =>
  r.figures.kind === "fabric" ? `${fmtNumber(r.figures.fabricKg)} kg` : `${r.figures.lines} trim${r.figures.lines === 1 ? "" : "s"}`;

export function PlanRevisionListScreen({ rows, canRaise }: { rows: PlanApprovalRow[]; canRaise: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  /** One row's Raise Revision, or the header's (`"pick"` — choose the plan in the sheet). */
  const [raising, setRaising] = useState<PlanApprovalRow | "pick" | null>(null);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.swoCode, r.iwoCode, r.season, r.description, PLAN_KIND_LABEL[r.kind], ...r.smpNos].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, query]);
  const quick = useQuickStatus(wordOf, { draft: false, countRows: searched });
  const shown = searched.filter(quick.matches);

  const openPlan = (r: { kind: PlanApprovalRow["kind"]; bomId: string }) => router.push(`${PLAN_EDITOR_PATH[r.kind]}?open=${r.bomId}`);
  const labelOf = (r: PlanApprovalRow) => r.swoCode ?? r.iwoCode ?? PLAN_KIND_LABEL[r.kind];
  /** What the header's Raise Revision offers: every APPROVED plan, nothing mid-revision. */
  const choices: PlanRevisionChoice[] = rows
    .filter((r) => r.status === "approved")
    .map((r) => ({ kind: r.kind, bomId: r.bomId, planLabel: labelOf(r), nextRevision: r.revisionNo + 1 }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Revision"
        description="Change an approved Fabric Plan or Accessories Plan — raise a revision, edit the plan, send it back for approval."
        actions={
          canRaise ? (
            <Button onClick={() => setRaising("pick")}>
              <Plus className="h-4 w-4" />
              Raise Revision
            </Button>
          ) : undefined
        }
      />
      <FilterBar
        leading={quick.segment}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search SWO No, IW No, SMP No, season or plan…"
        right={`${shown.length} of ${rows.length}`}
      />
      <SampleCards<PlanApprovalRow>
        rows={shown}
        getKey={(r) => r.key}
        title={(r) => <span className="font-mono">{r.swoCode ?? r.iwoCode ?? "—"}</span>}
        subtitle={(r) => [PLAN_KIND_LABEL[r.kind], r.smpNos.join(", ")].filter(Boolean).join(" · ")}
        state={stateOf}
        pillText={planStatusText}
        stats={(r) => [
          { label: "To buy", value: toBuy(r), lead: true },
          { label: "Version", value: r.revisionNo ? `Rev #${r.revisionNo}` : "V0" },
          { label: "Season", value: r.season ?? "—" },
        ]}
        onOpen={openPlan}
        onSend={(r) => setRaising(r)}
        canSendRow={(r) => canRaise && r.status === "approved"}
        sendLabel="Raise Revision"
        cardSendLabel="Revise"
        sendIcon={GitBranch}
        footerNote={hasCreatedInfo(rows) ? (r) => `Created ${createdMeta(r)}` : undefined}
        // Standing approved plans read as a table, as every Sample queue's Updated does.
        table={quick.value === "updated" ? { title: "SWO No", subtitle: "Plan · SMP Nos" } : undefined}
        empty={
          rows.length
            ? "No plan matches the search or the status box."
            : "No approved Fabric or Accessories Plan yet. A plan appears here once Plan Approval approves it."
        }
      />

      {raising === "pick" ? (
        <PlanRevisionSheet choices={choices} onClose={() => setRaising(null)} onRaised={(p) => (setRaising(null), openPlan(p))} />
      ) : raising ? (
        <PlanRevisionSheet
          kind={raising.kind}
          bomId={raising.bomId}
          planLabel={labelOf(raising)}
          nextRevision={raising.revisionNo + 1}
          onClose={() => setRaising(null)}
          // Straight into the reopened plan — the revision is made there.
          onRaised={(p) => (setRaising(null), openPlan(p))}
        />
      ) : null}
    </div>
  );
}
