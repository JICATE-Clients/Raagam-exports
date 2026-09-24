"use client";

/**
 * Orders ▸ CAD ▸ CAD Lifecycle (doc/order/cad.md; 0628).
 *
 * ONE ROW PER (ORDER, STYLE) — the grain the spec versions on. Each row names
 * its latest version and offers exactly the next step the lifecycle permits:
 *
 *   Not allocated  → Allocate         (§2)
 *   Allocated      → Dispatch         (§3)
 *   Awaiting buyer → Record decision  (§4)
 *   Rework         → Re-allocate      (§4.2, version n + 1)
 *   Approved       → nothing; the order's Fabric BOM may be created once
 *                    every style reads Approved (§7)
 *
 * The ⋮ menu carries the corrections — edit or delete a version not yet sent,
 * undo a dispatch the buyer has not answered, reopen a decision while no later
 * version exists. The database enforces each of those limits (0628); the menu
 * only offers what would be accepted.
 *
 * THE LIST IS THE SHELL'S (`MasterListShell`): search, paging, the Created
 * Date / Created User pair, the mobile cards. The Filters drawer and the
 * Pending / Updated box are the Orders-wide pair (2026-09-23).
 */

import { useMemo } from "react";
import { CalendarRange, Layers } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import type { Column } from "@/components/ui/data-table";
import { createdGroup, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { fmtDate } from "@/lib/format";
import { today as istToday } from "@/lib/calendar";
import {
  CAD_STATE_META,
  CAD_TYPES,
  cadLateness,
  cadTypeLabel,
  latestVersion,
  layoutLabel,
  type CadStyleRow,
  type PatternMakerRow,
} from "@/lib/orders/cad-lifecycle/types";
import { useCadActions } from "@/components/orders/cad/use-cad-actions";

/** Pending = CAD work still owed on the style; Updated = approved. */
const cadWord = (r: CadStyleRow): QuickWord => (r.state === "approved" ? "updated" : "pending");

export function CadLifecycleScreen({
  rows,
  employees,
  canEdit,
}: {
  rows: CadStyleRow[];
  employees: PatternMakerRow[];
  canEdit: boolean;
}) {
  // The next step, the corrections menu and the four sheets — shared with
  // Order Entry ▸ CAD (use-cad-actions.tsx), so both offer the same steps.
  const cad = useCadActions({ employees, canEdit });
  const today = istToday();

  const facetsDef = useMemo<FacetGroup<CadStyleRow>[]>(
    () => [
      {
        title: "Order & status",
        icon: <Layers />,
        facets: [
          { key: "customer", label: "Customer", all: "All customers", wide: true, value: (r) => r.customer_name },
          {
            key: "status",
            label: "Status",
            all: "All",
            counted: true,
            options: (Object.keys(CAD_STATE_META) as (keyof typeof CAD_STATE_META)[]).map((k) => ({
              value: k,
              label: CAD_STATE_META[k].label,
            })),
            match: (r, v) => r.state === v,
          },
          {
            key: "maker",
            label: "Pattern Maker",
            all: "Anyone",
            wide: true,
            value: (r) => latestVersion(r.versions)?.pattern_maker_name ?? null,
          },
          {
            key: "type",
            label: "CAD Type",
            all: "Any",
            options: CAD_TYPES.map((t) => ({ value: t.value, label: t.label })),
            match: (r, v) => latestVersion(r.versions)?.cad_type === v,
          },
          {
            key: "late",
            label: "Late",
            all: "Any",
            counted: true,
            options: [{ value: "late", label: "Late only" }],
            match: (r) => cadLateness(latestVersion(r.versions), today).late,
          },
        ],
      },
      ...createdGroup(rows, <CalendarRange />),
    ],
    [rows, today],
  );
  const facets = useFacetFilter(rows, facetsDef);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  const base = useMemo(() => rows.filter(facetMatch), [rows, facetMatch]);
  const quick = useQuickStatus(cadWord, {
    draft: false,
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    countRows: base,
  });
  const qm = quick.matches;
  const shown = useMemo(() => base.filter(qm), [base, qm]);

  const columns: Column<CadStyleRow>[] = [
    {
      header: "RE No",
      cell: (r) => <span className="font-mono text-xs font-medium">{r.re_no ?? r.order_code ?? "—"}</span>,
    },
    { header: "Customer", cell: (r) => <Truncated>{r.customer_name ?? ""}</Truncated> },
    {
      header: "Style",
      cell: (r) => (
        <div className="min-w-0 leading-tight">
          <Truncated className="text-sm font-medium">{r.style_ref_no}</Truncated>
          {!r.on_order ? (
            <span className="text-xs text-warning">No longer on the order</span>
          ) : r.layout_type ? (
            <span className="text-xs text-muted-foreground">{layoutLabel(r.layout_type)}</span>
          ) : null}
        </div>
      ),
    },
    {
      header: "Ver",
      align: "right",
      cell: (r) => {
        const v = latestVersion(r.versions);
        return <span className="tabular-nums text-sm">{v ? `V${v.version_no}` : "—"}</span>;
      },
    },
    {
      header: "Pattern Maker",
      cell: (r) => {
        const v = latestVersion(r.versions);
        return v ? (
          <div className="min-w-0 leading-tight">
            <Truncated className="text-sm">{v.pattern_maker_name ?? "—"}</Truncated>
            <span className="text-xs text-muted-foreground">{cadTypeLabel(v.cad_type)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      header: "Target",
      cell: (r) => {
        const v = latestVersion(r.versions);
        return <span className="text-sm tabular-nums">{v ? fmtDate(v.target_date) : "—"}</span>;
      },
    },
    {
      header: "Dispatched",
      cell: (r) => {
        const d = latestVersion(r.versions)?.dispatch;
        return <span className="text-sm tabular-nums">{d ? fmtDate(d.dispatch_date) : "—"}</span>;
      },
    },
    {
      header: "Expected Approval",
      cell: (r) => {
        const d = latestVersion(r.versions)?.dispatch;
        return <span className="text-sm tabular-nums">{d?.expected_approval_date ? fmtDate(d.expected_approval_date) : "—"}</span>;
      },
    },
    {
      header: "Status",
      cell: (r) => {
        const meta = CAD_STATE_META[r.state];
        const late = cadLateness(latestVersion(r.versions), today);
        return (
          <div className="flex flex-wrap items-center gap-1">
            <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            {late.late && <StatusPill tone="danger">{`${late.days}d ${late.what}`}</StatusPill>}
          </div>
        );
      },
    },
    { header: "Next", cell: (r) => cad.stepButton(r) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="CAD Lifecycle"
        description="Allocate each style's CAD to a pattern maker, dispatch it to the buyer, and record the buyer's decision. An order's Fabric BOM can be created once every style's CAD is approved."
      />
      <MasterListShell<CadStyleRow>
        rows={shown}
        filterPanel={facets.panel}
        filterLeading={quick.segment}
        panelActiveCount={facets.activeCount}
        onPanelReset={facets.reset}
        getKey={(r) => r.key}
        // Rows are the order's styles — nothing is added or deleted as a ROW here.
        perms={{ canCreate: false, canEdit: false, canDelete: false }}
        searchText={(r) =>
          [r.re_no, r.order_code, r.customer_name, r.style_ref_no, latestVersion(r.versions)?.pattern_maker_name]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder="Search RE No, customer, style or pattern maker…"
        columns={columns}
        actions={{
          onView: (r) => cad.showHistory(r),
          menu: cad.menuFor,
        }}
        rowLabel={(r) => `${r.re_no ?? r.order_code ?? ""} ${r.style_ref_no}`}
        empty={
          rows.length > 0
            ? "No style matches these filters."
            : "No confirmed order has a style yet — a style appears here once its order is saved (not as a draft)."
        }
        mobile={{
          title: (r) => `${r.re_no ?? r.order_code ?? "—"} · ${r.style_ref_no}`,
          subtitle: (r) => r.customer_name ?? "",
          pill: (r) => <StatusPill tone={CAD_STATE_META[r.state].tone}>{CAD_STATE_META[r.state].label}</StatusPill>,
          meta: (r) => {
            const v = latestVersion(r.versions);
            return v ? `V${v.version_no} · ${v.pattern_maker_name ?? "—"} · target ${fmtDate(v.target_date)}` : "Not allocated";
          },
          onView: (r) => cad.showHistory(r),
          onEdit: canEdit ? (r) => cad.startStep(r, null) : undefined,
        }}
        isPending={cad.isPending}
      />
      {cad.sheets}
    </div>
  );
}
