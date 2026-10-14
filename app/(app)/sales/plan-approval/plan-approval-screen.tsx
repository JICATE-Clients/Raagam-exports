"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, FileText, Layers, Package, RotateCcw, Scissors, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdGroup, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { Sheet } from "@/components/ui/sheet";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadPlanReview } from "@/lib/sales/plan-reports/actions";
import type { PlanApprovalRow } from "@/lib/sales/plan-reports/service";
import { PLAN_KIND_LABEL, planReportHref, type PlanKind } from "@/lib/sales/plan-reports/types";
import { PlanApprovalOverview } from "./plan-approval-overview";
import { planStatusText, planStatusTone, planWord } from "./plan-words";

type Review = Awaited<ReturnType<typeof loadPlanReview>>;

/**
 * THE QUEUE'S FILTERS PANEL — the grouped drawer every Orders child draws,
 * as on Order Budget Approval. The queue still OPENS on the work: that is the
 * Pending box on the search row, not this panel.
 */
function planFacets(rows: PlanApprovalRow[]): FacetGroup<PlanApprovalRow>[] {
  return [
    {
      /* THE PLAN IS NOT A FACET ANY MORE — it is the switch above the list
         (user 2026-10-14), so a Fabric approver never reads past Accessories
         rows to find their own. */
      title: "Status",
      icon: <Layers />,
      facets: [
        {
          key: "status",
          label: "Status",
          all: "All",
          wide: true,
          counted: true,
          options: (["submitted", "approved", "returned", "open"] as const).map((s) => ({
            value: s,
            label: planStatusText({ status: s, revisionNo: 0 }),
          })),
          match: (r, v) => r.status === v,
        },
      ],
    },
    {
      title: "Dates",
      icon: <CalendarRange />,
      facets: [
        { key: "submitted", label: "Submitted", all: "Any date", date: (r) => r.submitted_at },
        { key: "decided", label: "Decided", all: "Any date", date: (r) => r.decided_at },
      ],
    },
    ...createdGroup(rows, <Users />),
  ];
}

/**
 * Sample ▸ Plan Approval — Order Budget Approval's screen for the two sample
 * plans (user 2026-10-13). See page.tsx.
 */
export function PlanApprovalScreen({
  rows: allRows,
  initialOpen,
  initialKind,
  canApprove,
}: {
  rows: PlanApprovalRow[];
  initialOpen: string | null;
  /** Which plan's queue opens — `?plan=`, else the plan a deep link names,
   *  else the one with work waiting (page.tsx). */
  initialKind: PlanKind;
  /** `approvals:approve` — whether the row decision icons are live. The ENGINE
   *  still decides who may act (`approval_can_act`); this only avoids offering
   *  a click to someone who can never make it. */
  canApprove: boolean;
}) {
  const router = useRouter();

  /* FABRIC PLAN · ACCESSORIES PLAN — ONE QUEUE EACH (user 2026-10-14: "follow
     the fabric plan approval … listing that approval child inside with filter
     and better UI"). The two plans are approved on different figures (kilos
     and yarn against trims), so one mixed table made each approver read past
     the other's rows, and the plan was a facet buried in the Filters panel.
     The switch says which queue is on screen and how much waits in each; the
     choice is kept in the URL (`?plan=`) so a refresh, a workspace tab and a
     shared link all land on it. */
  const [kind, setKind] = useState<PlanKind>(initialKind);
  const pendingOf = (k: PlanKind) => allRows.filter((r) => r.kind === k && r.status === "submitted").length;
  const pickKind = (k: PlanKind) => {
    setKind(k);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("plan", k);
      u.searchParams.delete("open");
      window.history.replaceState(null, "", u);
    } catch {
      /* the URL is a convenience — the switch works without it */
    }
  };
  const rows = useMemo(() => allRows.filter((r) => r.kind === kind), [allRows, kind]);

  /* ONE WAY IN, AND IT IS THE FULL PAGE (the order screen's rule): the SWO No,
     both decision icons and a deep link (`?open=`) all open the sheet. */
  const [openKey, setOpenKey] = useState<string | null>(initialOpen);
  /** WHICH PLAN THIS REVIEW DESCRIBES — keyed so a late answer can never paint
   *  the previous plan's trail under this one (the order screen's `forId`). */
  const [loaded, setLoaded] = useState<{ forKey: string; data: Review } | null>(null);
  const openRow = openKey ? (allRows.find((r) => r.key === openKey) ?? null) : null;
  useEffect(() => {
    if (!openRow) return;
    const key = openRow.key;
    void loadPlanReview(openRow.kind, openRow.bomId).then((data) => setLoaded({ forKey: key, data }));
    // Once per opened plan; `openRow` is derived from `openKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);
  const review = loaded && loaded.forKey === openKey ? loaded.data : null;
  const close = () => setOpenKey(null);

  const groups = useMemo(() => planFacets(rows), [rows]);
  const facets = useFacetFilter(rows, groups);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  const [search, setSearch] = useState("");
  /* THE SET THE FIGURES ARE COUNTED OVER — search and panel applied, the box's
     own word left off, so a count is exactly what clicking it would show. */
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatch(r)) return false;
      if (!q) return true;
      return [r.swoCode, r.iwoCode, r.description, r.season, ...r.smpNos]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, facetMatch, search]);
  const quick = useQuickStatus(planWord, {
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    countRows: base,
  });
  const quickMatches = quick.matches;
  const filtered = useMemo(() => base.filter(quickMatches), [base, quickMatches]);

  const columns: Column<PlanApprovalRow>[] = [
    {
      header: "SWO No",
      className: HUG,
      cell: (r) => (
        <span className="block">
          <button type="button" onClick={() => setOpenKey(r.key)} className="font-mono text-xs font-medium text-primary hover:underline">
            {r.swoCode ?? r.iwoCode ?? "—"}
          </button>
          {r.description ? (
            // truncate-reveal: exempt -- the SWO's description is the review's; the list shows a reminder
            <span className="block max-w-[14rem] truncate text-[11px] text-muted-foreground">{r.description}</span>
          ) : null}
        </span>
      ),
    },
    {
      // The first SMP and how many more, the season under it — the full list
      // is the review's (a many-sample SWO in one cell pushed Approve off the
      // row, 2026-10-13).
      header: "Samples",
      className: HUG,
      cell: (r) => (
        <span className="block text-sm">
          <span className="font-mono text-xs">
            {r.smpNos[0] ?? "—"}
            {r.smpNos.length > 1 ? <span className="text-muted-foreground">{` +${r.smpNos.length - 1}`}</span> : null}
          </span>
          {r.season ? <span className="block text-[11px] text-muted-foreground">{r.season}</span> : null}
        </span>
      ),
    },
    /* WHAT THIS APPROVAL BUYS, IN THE PLAN'S OWN TERMS — one queue per plan,
       so each gets its own columns instead of one "To buy" cell that read
       kilos on one row and a count of trims on the next. */
    ...(kind === "fabric"
      ? ([
          {
            header: "Fabric",
            align: "right",
            className: HUG,
            cell: (r) =>
              r.figures.kind === "fabric" ? (
                <span className="block text-right text-sm tabular-nums">{`${fmtNumber(r.figures.fabricKg)} kg`}</span>
              ) : null,
          },
          {
            header: "Yarn to buy",
            align: "right",
            className: HUG,
            cell: (r) =>
              r.figures.kind === "fabric" ? (
                <span className={cn("block text-right text-sm tabular-nums", r.figures.yarnQty == null && "text-warning")}>
                  {r.figures.yarnQty == null
                    ? "Not worked out"
                    : `${fmtNumber(r.figures.yarnQty)}${r.figures.yarnUom ? ` ${r.figures.yarnUom}` : ""}`}
                </span>
              ) : null,
          },
        ] satisfies Column<PlanApprovalRow>[])
      : ([
          {
            header: "Trims",
            align: "right",
            className: HUG,
            cell: (r) =>
              r.figures.kind === "accessories" ? (
                <span className="block text-right text-sm tabular-nums">{r.figures.lines}</span>
              ) : null,
          },
          {
            // Advised (TBA) trims cannot be bought until the buyer confirms —
            // the first thing an Accessories approver asks.
            header: "Advised",
            align: "right",
            className: HUG,
            cell: (r) =>
              r.figures.kind === "accessories" ? (
                <span
                  className={cn(
                    "block text-right text-sm tabular-nums",
                    r.figures.advised ? "font-semibold text-warning" : "text-muted-foreground",
                  )}
                >
                  {r.figures.advised || "—"}
                </span>
              ) : null,
          },
          {
            // A trim with no purchase quantity is one the plan cannot buy yet.
            header: "No qty",
            align: "right",
            className: HUG,
            cell: (r) =>
              r.figures.kind === "accessories" ? (
                <span
                  className={cn(
                    "block text-right text-sm tabular-nums",
                    r.figures.unpriced ? "font-semibold text-danger" : "text-muted-foreground",
                  )}
                >
                  {r.figures.unpriced || "—"}
                </span>
              ) : null,
          },
        ] satisfies Column<PlanApprovalRow>[])),
    {
      header: "Version",
      className: HUG,
      cell: (r) =>
        r.revisionNo ? (
          <span className="text-xs">{`Rev #${r.revisionNo}`}</span>
        ) : (
          <span className="text-xs text-muted-foreground">V0</span>
        ),
    },
    {
      header: "Submitted",
      className: HUG,
      cell: (r) => (
        <span className="block text-sm">
          {/* DATE AND TIME, NEVER "10 mins ago" (the order screen's reason:
              an age needs `Date.now()` in the render). */}
          <span className="whitespace-nowrap tabular-nums">{r.submitted_at ? fmtDateTime(r.submitted_at) : "—"}</span>
          {r.submitted_by_name ? <span className="block text-[11px] text-muted-foreground">by {r.submitted_by_name}</span> : null}
        </span>
      ),
    },
    {
      header: "Status",
      className: HUG,
      cell: (r) => <StatusPill tone={planStatusTone(r)}>{planStatusText(r)}</StatusPill>,
    },
    /* REPORT FIRST — the eye's slot (AGENTS.md "Row actions"): the plan's own
       report, the direct link. Then the two decisions in their own colours,
       drawn on every row so the column never jitters; each opens the full
       page, where the decision is made with the plan in front of it. */
    rowActionsColumn<PlanApprovalRow>(
      (r) => {
        const decidable = canApprove && r.status === "submitted";
        const label = r.swoCode ?? r.iwoCode ?? "plan";
        return (
          <div className="flex items-center justify-end gap-1">
            <RowIconAction
              label={`${PLAN_KIND_LABEL[r.kind]} report`}
              name={label}
              icon={FileText}
              className="text-primary"
              onClick={() => router.push(planReportHref(r.kind, r.bomId))}
            />
            <Tooltip label={decidable ? "Request Rework" : "Request Rework — only a pending plan"}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Request rework on ${label}`}
                className="text-warning hover:bg-warning/10 hover:text-warning disabled:text-muted-foreground"
                disabled={!decidable}
                onClick={() => setOpenKey(r.key)}
              >
                <RotateCcw />
              </Button>
            </Tooltip>
            <Tooltip label={decidable ? "Approve" : "Approve — only a pending plan"}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Approve ${label}`}
                className="text-success hover:bg-success/10 hover:text-success disabled:text-muted-foreground"
                disabled={!decidable}
                onClick={() => setOpenKey(r.key)}
              >
                <Check />
              </Button>
            </Tooltip>
          </div>
        );
      },
      "w-32",
    ),
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Plan Approval"
          description="Approve a submitted sample Fabric or Accessories Plan — the gate before its yarn and trims are bought."
        />

        {!canApprove && (
          <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            You can see the plans here but not decide on them — that needs the approval permission, granted on the Roles screen.
          </p>
        )}

        <ToggleGroup<PlanKind>
          role="tablist"
          label="Plan"
          value={kind}
          onChange={pickKind}
          options={[
            {
              value: "fabric",
              label: "Fabric Plan",
              icon: Scissors,
              count: pendingOf("fabric"),
              title: `${pendingOf("fabric")} waiting for approval`,
            },
            {
              value: "accessories",
              label: "Accessories Plan",
              icon: Package,
              count: pendingOf("accessories"),
              title: `${pendingOf("accessories")} waiting for approval`,
            },
          ]}
        />

        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search SWO No, SMP Number, season…"
          leading={quick.segment}
          activeCount={facets.activeCount}
          onReset={facets.activeCount ? facets.reset : undefined}
          panel={facets.panel}
          right={`${filtered.length} of ${rows.length}`}
        />

        {/* AS WIDE AS ITS COLUMNS, not the pane (the order screen's rule) —
            from `md` only: below it the table is stacked cards, and a card
            shrunk to its content stopped short of the phone's edge. */}
        <div className="max-w-full md:w-fit">
          <DataTable
            columns={hugCreated(withCreatedColumns(columns, filtered))}
            rows={filtered}
            getKey={(r) => r.key}
            empty={
              !rows.length
                ? `No sample ${PLAN_KIND_LABEL[kind]} yet — it appears here once saved on Sample ▸ ${PLAN_KIND_LABEL[kind]}.`
                : quick.value === "pending" && facets.activeCount === 0
                  ? "Nothing is waiting for approval."
                  : "No plan matches these filters."
            }
          />
        </div>
      </div>

      <Sheet
        open={!!openRow}
        onClose={close}
        title={
          <span className="flex flex-col">
            <span>{openRow ? `${PLAN_KIND_LABEL[openRow.kind]} Approval` : "Plan Approval"}</span>
            <span className="text-xs font-normal text-muted-foreground">
              Sample / Plan Approval / <span className="font-mono text-foreground">{openRow?.swoCode ?? openRow?.iwoCode ?? ""}</span>
            </span>
          </span>
        }
        /* Approve · Request Rework — renders nothing unless `approval_can_act`
           said yes. Request Rework is the engine's reject: the plan returns
           editable to the planner, with the reason. */
        headerActions={
          review?.run && review.verdict ? (
            <ApprovalActionBar
              run={review.run}
              verdict={review.verdict}
              subjectPath="/sales/plan-approval"
              onDone={() => {
                close();
                router.refresh();
              }}
              rework
              compact
              overrideNote={false}
            />
          ) : undefined
        }
        size="lg"
        fullBleed
      >
        {openRow && review?.report ? (
          <PlanApprovalOverview
            row={openRow}
            plan={review.report}
            timeline={review.run ? review.timeline : null}
            names={review.names as Record<string, string>}
            override={!!review.verdict?.can_act && !!review.verdict.is_override}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {openRow && review && !review.report ? "This plan could not be read." : "Loading the plan…"}
          </p>
        )}
      </Sheet>
    </>
  );
}
