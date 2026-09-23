"use client";

/**
 * Orders ▸ Advised Items — the REGISTER: every order that has a Material BOM
 * line still "To be advised", grouped by RE No (doc/order/advised-items-plan.md).
 *
 * A VIEW, NOT A SECOND LIST. An advised line IS a Material BOM line whose
 * `type` is "To be advised" (the TBA toggle); this screen reads those lines and
 * writes nothing but the conversion. The orphan editor it replaces kept a
 * free-text list of its own that nothing else read — two answers to "what is
 * still to be advised", which disagree the first time one is edited.
 *
 * THE LIST IS THE SHELL'S. `MasterListShell` supplies the search, the toolbar,
 * the Created Date / Created User pair (AGENTS.md) and the mobile cards; the
 * screen only says which columns and where a row opens.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Users } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import type { Column } from "@/components/ui/data-table";
import { createdGroup, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import type { AdvisedOrderRow } from "@/lib/orders/advised/types";

/**
 * THE REGISTER'S FILTERS — the grouped drawer every Orders child draws (user,
 * 2026-09-23: "implement the Material BOM filter in every Orders child"). Off
 * the row the list already carries: whose order and how far its conversion has
 * got, then (below) when and by whom the order was made.
 *
 * STATUS IS COUNTED — Pending first, because a pending line is what blocks a
 * purchase order — and read the way the mobile pill reads it (`pending > 0`),
 * so the facet and the card can never disagree about "All converted".
 */
const ADVISED_FACETS: FacetGroup<AdvisedOrderRow>[] = [
  {
    title: "Customer & status",
    icon: <Users />,
    facets: [
      { key: "customer", label: "Customer", all: "All customers", wide: true, value: (r) => r.customer_name },
      {
        key: "status",
        label: "Status",
        all: "All",
        counted: true,
        options: [
          { value: "pending", label: "Pending" },
          { value: "done", label: "All converted" },
        ],
        match: (r, v) => (v === "pending") === r.pending > 0,
      },
      {
        key: "progress",
        label: "Converted",
        all: "Any",
        counted: true,
        options: [
          { value: "none", label: "None yet" },
          { value: "some", label: "Some converted" },
        ],
        match: (r, v) => (v === "some") === r.converted > 0,
      },
    ],
  },
];

/**
 * THE PENDING / UPDATED BOX (user 2026-09-23: "in budget we have pending,
 * update, draft button need to implement same order module fully"). Pending =
 * an order with a line still to be advised — the work this list exists for,
 * each one blocking a PO; Updated = every line converted. Read exactly as the
 * Status facet and the mobile pill read it (`pending > 0`). NO DRAFT: an
 * advised line has no saved-but-unfinished state — it is To be advised or it
 * is converted — so a Draft word could only ever show an empty list.
 */
const advisedWord = (r: AdvisedOrderRow): QuickWord => (r.pending > 0 ? "pending" : "updated");

export function AdvisedRegister({ rows }: { rows: AdvisedOrderRow[] }) {
  const router = useRouter();
  const open = (r: AdvisedOrderRow) => router.push(`/orders/advised-items/${r.id}`);

  /* The Created pair joins only when the rows carry `created_at`
     (`createdGroup`'s guard). The drawer REPLACES the shell's own Created Date
     filter (a FilterBar `panel` replaces its `dateFilter`), so it is here as a
     facet instead. The shell hosts the drawer through its opt-in
     `filterPanel`; the matching is ours, so the shell is handed rows already
     narrowed and runs its search and paging over them unchanged. */
  const groups = useMemo(
    () => [...ADVISED_FACETS, ...createdGroup(rows, <CalendarRange />)],
    [rows],
  );
  const facets = useFacetFilter(rows, groups);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  /* The drawer's own Status facet asks the same question, so while it is set
     the box stands down (the Budget Approval rule). */
  const quick = useQuickStatus(advisedWord, {
    draft: false,
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
  });
  const qm = quick.matches;
  const shown = useMemo(() => rows.filter((r) => facetMatch(r) && qm(r)), [rows, facetMatch, qm]);

  const columns: Column<AdvisedOrderRow>[] = [
    {
      header: "RE No",
      cell: (r) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => open(r)}
        >
          {r.re_no ?? r.id.slice(0, 8)}
        </button>
      ),
    },
    { header: "Customer", cell: (r) => <Truncated>{r.customer_name ?? ""}</Truncated> },
    {
      header: "Pending",
      align: "right",
      // PENDING IS THE NUMBER THAT BLOCKS A PURCHASE ORDER — every one of these
      // lines refuses a PO until it is converted — so it is the loud one.
      cell: (r) => (
        <span className={r.pending > 0 ? "tabular-nums text-sm font-semibold text-danger" : "tabular-nums text-sm"}>
          {r.pending}
        </span>
      ),
    },
    {
      header: "Converted",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.converted}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Advised Items"
        description="Materials still to be advised by the buyer, by order — each one blocks its purchase order until it is converted."
      />
      <MasterListShell<AdvisedOrderRow>
        rows={shown}
        filterPanel={facets.panel}
        filterLeading={quick.segment}
        panelActiveCount={facets.activeCount}
        onPanelReset={facets.reset}
        getKey={(r) => r.id}
        // NOTHING IS ADDED OR DELETED HERE — a line becomes advised on the
        // Material BOM (the TBA toggle) and leaves by conversion, on the order's
        // own page. The shell's Add and Delete therefore have no door to open.
        perms={{ canCreate: false, canEdit: false, canDelete: false }}
        searchText={(r) => [r.re_no, r.customer_name].filter(Boolean).join(" ")}
        searchPlaceholder="Search RE No or customer…"
        columns={columns}
        actions={{ onView: open }}
        empty={
          rows.length > 0
            ? quick.value === "pending" && !facets.activeCount
              ? "Every advised line is converted — nothing pending. Updated lists them."
              : "No order matches these filters."
            : "No order has a material still to be advised."
        }
        mobile={{
          title: (r) => r.re_no ?? r.id.slice(0, 8),
          subtitle: (r) => r.customer_name ?? "",
          pill: (r) =>
            r.pending > 0 ? (
              <StatusPill tone="danger">{r.pending} pending</StatusPill>
            ) : (
              <StatusPill tone="success">All converted</StatusPill>
            ),
          onView: open,
        }}
      />
    </div>
  );
}
