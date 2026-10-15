"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Eye, FileText, Plus, Undo2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdByFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { QUICK_WORDS_4, useQuickStatus } from "@/components/orders/bom-queue";
import { AMENDMENT_ORIGINS, originLabel } from "@/lib/orders/amendments/amendment-entry";
import { PLAN_KIND_LABEL, planReportHref, type PlanKind } from "@/lib/sales/plan-reports/types";
import {
  PLAN_REVISION_STATUS_LABEL,
  abandonRefusal,
  planRevisionHref,
  planRevisionIsOpen,
  planRevisionTone,
  planRevisionWord,
  type PlanRevisionRow,
  type PlanRevisionStatus,
} from "@/lib/sales/plan-revisions/types";

/**
 * SAMPLE ▸ REVISION — THE REGISTER OF PLAN REVISIONS (Fabric Plan · Accessories
 * Plan only; user 2026-10-14: "for fabric and accessories plan approval
 * revision only, not for SMP"). Orders ▸ Order Revisions' register, shape for
 * shape (`orders/order-amendments/register-screen.tsx`):
 *
 *  - ONE LINE PER REVISION, GROUPED BY SWO. The SWO is the register's subject
 *    and is said once, on a line spanning the table (`spanRow`) with its season
 *    and SMP numbers; its revisions sit beneath, oldest first. Each says which
 *    plan (a chip), Rev #, why, who asked, where it stands, and who raised it
 *    when — the Created pair IS raised by / raised at, so it is not said twice.
 *  - ONLY SWOS WITH A REVISION. A plan never revised is reached through Raise
 *    Revision, whose SWO picker lists exactly the approved plans — the
 *    register's own answer for an unamended order.
 *  - THE STATUS IS READ OFF THE PLAN (`planRevisionStatusOf`), never stored.
 *
 * Raise Revision is one PAGE (`/sales/sample-revision/new`) — the header's
 * button, an SWO line's Revise, and both plan editors' locked banner all go
 * there. A revision opens its WORKSPACE (`/sales/sample-revision/plan/<entry>`):
 * Overview, then each plan it reopened, embedded.
 *
 * The four-word box is Plan Approval's (`planWord`'s map, read per revision)
 * without Draft: a revision is never a draft nobody sent (user decision).
 * Abandoned is in no word — the Filters panel's Status reaches it.
 */

/** Pending · Under Progress · Approved — the shared box, no Draft. */
const WORDS = QUICK_WORDS_4.filter((w) => w !== "draft");
const STATUSES: PlanRevisionStatus[] = ["editing", "returned", "submitted", "approved", "abandoned"];

const FACETS: FacetGroup<PlanRevisionRow>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "status",
        label: "Status",
        all: "All statuses",
        counted: true,
        options: STATUSES.map((s) => ({ value: s, label: PLAN_REVISION_STATUS_LABEL[s] })),
        match: (r, v) => r.status === v,
      },
      { key: "raised", label: "Raised Date", all: "Any date", date: (r) => r.raisedAt },
    ],
  },
  {
    title: "Plan & SWO",
    icon: <Users />,
    facets: [
      {
        key: "plan",
        label: "Plan",
        all: "Both plans",
        counted: true,
        options: (["fabric", "accessories"] as const).map((k) => ({ value: k, label: PLAN_KIND_LABEL[k] })),
        match: (r, v) => r.kind === v,
      },
      { key: "season", label: "Season", all: "All seasons", value: (r) => r.season },
      {
        key: "origin",
        label: "Origin",
        all: "All origins",
        options: AMENDMENT_ORIGINS.map((o) => ({ value: o.value, label: o.label })),
        match: (r, v) => r.origin === v,
      },
      createdByFacet(),
    ],
  },
];

type SwoHead = { key: string; swo: string; season: string | null; smpNos: string[]; plans: PlanRevisionRow[] };
type Line = { line: "swo"; id: string; head: SwoHead } | ({ line: "rev"; sno: number } & PlanRevisionRow);

const swoOf = (r: PlanRevisionRow) => r.swoCode ?? r.iwoCode ?? r.bomId;

export function PlanRevisionListScreen({ rows, canRaise }: { rows: PlanRevisionRow[]; canRaise: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const facets = useFacetFilter(rows, FACETS);
  const facetMatch = facets.matches;
  const setFacet = facets.set;

  const base = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatch(r)) return false;
      if (!needle) return true;
      return [r.swoCode, r.iwoCode, r.season, r.reason, PLAN_KIND_LABEL[r.kind], ...r.smpNos].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [rows, query, facetMatch]);
  const quick = useQuickStatus((r: PlanRevisionRow) => planRevisionWord(r.status), {
    words: WORDS,
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    countRows: base,
  });
  const qm = quick.matches;
  const filtered = useMemo(() => base.filter(qm), [base, qm]);

  /* Every revision of an ENTRY, unfiltered — Abandon acts on the entry, so its
     refusal reads all of it, not only the rows the filters left. */
  const entryStatuses = useMemo(() => {
    const m = new Map<string, PlanRevisionStatus[]>();
    for (const r of rows) m.set(r.entryId, [...(m.get(r.entryId) ?? []), r.status]);
    return m;
  }, [rows]);

  /* Every plan of an SWO the register knows, unfiltered — what its Revise reads. */
  const swoPlans = useMemo(() => {
    const m = new Map<string, Map<PlanKind, PlanRevisionRow>>();
    for (const r of rows) {
      const k = swoOf(r);
      const held = m.get(k) ?? new Map<PlanKind, PlanRevisionRow>();
      // The newest revision of each plan carries the plan's state now.
      if (!held.has(r.kind) || held.get(r.kind)!.revisionNo < r.revisionNo) held.set(r.kind, r);
      m.set(k, held);
    }
    return m;
  }, [rows]);

  const lines = useMemo<Line[]>(() => {
    const groups = new Map<string, SwoHead>();
    for (const r of filtered) {
      const k = swoOf(r);
      const g = groups.get(k) ?? { key: k, swo: k, season: r.season, smpNos: r.smpNos, plans: [] };
      g.plans.push(r);
      groups.set(k, g);
    }
    const out: Line[] = [];
    // S.No counts the revision lines only — the SWO lines are headings.
    let sno = 0;
    for (const g of groups.values()) {
      out.push({ line: "swo", id: `swo:${g.key}`, head: g });
      for (const r of g.plans) out.push({ line: "rev", sno: ++sno, ...r });
    }
    return out;
  }, [filtered]);

  /** An open revision lands on its first plan's tab; a decided one on the Overview. */
  const openHref = (r: PlanRevisionRow) => planRevisionHref(r.entryId, planRevisionIsOpen(r.status) ? r.kind : "overview");

  const revCol = (
    header: string,
    cell: (r: PlanRevisionRow & { sno: number }) => ReactNode,
    extra?: Pick<Column<Line>, "align" | "className">,
  ): Column<Line> => ({ header, cell: (l) => (l.line === "rev" ? cell(l) : null), ...extra });

  const columns: Column<Line>[] = [
    revCol("S.No", (r) => <span className="tabular-nums">{r.sno}</span>, { align: "right", className: HUG }),
    revCol(
      "Revision",
      (r) => (
        <button type="button" className="tabular-nums font-medium text-primary hover:underline" onClick={() => router.push(openHref(r))}>
          Rev #{r.revisionNo}
        </button>
      ),
      { className: HUG },
    ),
    revCol(
      "Plan",
      (r) => (
        // One neutral chip: the pill tones are the STATUS vocabulary.
        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground">
          {PLAN_KIND_LABEL[r.kind]}
        </span>
      ),
      { className: HUG },
    ),
    revCol("Reason", (r) => <Truncated className="block max-w-[18rem] text-sm">{r.reason}</Truncated>, {
      className: "min-w-[10rem] max-w-[18rem]",
    }),
    revCol("Origin", (r) => originLabel(r.origin), { className: HUG }),
    revCol(
      "Status",
      (r) => (
        <span title={r.abandonReason ?? undefined}>
          <StatusPill tone={planRevisionTone(r.status)}>{PLAN_REVISION_STATUS_LABEL[r.status]}</StatusPill>
        </span>
      ),
      { className: HUG },
    ),
    rowActionsColumn<Line>((l) => {
      if (l.line !== "rev") return null;
      const r = l;
      const label = `${r.swoCode ?? r.iwoCode ?? ""} Rev #${r.revisionNo}`;
      return (
        <div className="flex items-center justify-end gap-1">
          <RowIconAction label="Open revision" name={label} icon={Eye} onClick={() => router.push(openHref(r))} />
          <RowIconAction
            label={`${PLAN_KIND_LABEL[r.kind]} report`}
            name={label}
            icon={FileText}
            className="text-primary"
            onClick={() => router.push(planReportHref(r.kind, r.bomId))}
          />
          {/* Hidden without the permission (a fact about the operator);
              greyed with the reason when the revision cannot be abandoned
              (a fact about the record). The confirm is the Overview's. */}
          {canRaise && (
            <RowIconAction
              label="Abandon revision"
              name={label}
              icon={Undo2}
              danger
              disabledReason={abandonRefusal(entryStatuses.get(r.entryId) ?? [r.status])}
              onClick={() => router.push(`${planRevisionHref(r.entryId)}?abandon=1`)}
            />
          )}
        </div>
      );
    }),
  ];

  /* The SWO line — said once, above its revisions, with its own Revise while a
     plan of it is approved and none is under revision ("Revise shows only on
     approved rows"). */
  const swoLine = (l: Line) => {
    if (l.line !== "swo") return null;
    const h = l.head;
    const plans = [...(swoPlans.get(h.key)?.values() ?? [])];
    const busy = plans.some((p) => planRevisionIsOpen(p.status) || p.status === "submitted");
    const approved = plans
      .filter((p) => p.planStatus === "approved")
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "fabric" ? -1 : 1))[0];
    return (
      <div className="flex w-0 min-w-full flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-mono text-xs font-semibold text-foreground">{h.swo}</span>
          {h.season && <span className="text-xs text-muted-foreground">{h.season}</span>}
          {h.smpNos.length > 0 && <Truncated className="max-w-[24rem] text-xs text-muted-foreground">{h.smpNos.join(", ")}</Truncated>}
        </div>
        {canRaise && approved && !busy && (
          // toolbar-size: exempt -- a grid heading's action, dense like ChildGrid's + Add line
          <Button variant="outline" size="sm" onClick={() => router.push(`/sales/sample-revision/new?plan=${encodeURIComponent(`${approved.kind}:${approved.bomId}`)}`)}>
            <Plus className="h-3.5 w-3.5" /> Revise
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Revision"
        description="Change an approved Fabric Plan or Accessories Plan — raise a revision, edit the plan, send it back for approval."
        actions={
          canRaise ? (
            <Button onClick={() => router.push("/sales/sample-revision/new")}>
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
        searchPlaceholder="Search SWO No, IW No, SMP No, season, plan or reason…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        right={`${filtered.length} of ${rows.length}`}
      />
      {/* dup-check: exempt -- a dated revision log; a second revision of a plan is how it is changed again */}
      <div className="w-fit max-w-full">
        <DataTable
          columns={hugCreated(withCreatedColumns(columns, lines))}
          rows={lines}
          getKey={(l) => l.id}
          spanRow={swoLine}
          empty={
            rows.length
              ? quick.value
                ? `No ${quick.value} revision${facets.activeCount || query.trim() ? " matches these filters" : ""} — ${rows.length} in the register; pick another word above.`
                : "No revision matches these filters."
              : "No plan revision has been raised yet — Raise Revision picks the SWO whose approved plan is to change."
          }
        />
      </div>
    </div>
  );
}
