"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { deleteKnittingOrder } from "@/lib/production/knitting-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { CalendarRange, FileText, Package, Plus, Truck, Users } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import type { KnitBalanceRow } from "@/lib/production/knitting-service";
import { ToggleGroup } from "@/components/ui/segmented";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdByFacet, urgencyFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { KNIT_STATUS_LABELS, type KnittingOrderListRow, type KnittingOrderStatus } from "@/lib/production/knitting-types";

const BASE = "/process/knitting-hub";

/* THE ORDERS FILTER DRAWER (user 2026-11-14, screenshot 4191: "follow the existing filter criteria
   and UI, take reference from the Orders module"). The same `useFacetFilter` panel every Orders list
   draws — three titled groups, first facet wide, options only from the rows, counted where the
   facet is a state. It replaces Session 2's hand-rolled Category / Knitter / Stock / KO Date selects. */
const KO_STATUSES: KnittingOrderStatus[] = ["draft", "issued", "in_process", "partially_received", "received", "closed", "cancelled"];
type YarnIssueState = "not_sent" | "part_sent" | "all_sent" | "own_yarn";
const yarnIssueOf = (r: KnittingOrderListRow): YarnIssueState =>
  r.is_by_vendor
    ? "own_yarn"
    : r.yarn_issued_kg <= 0.0005
      ? "not_sent"
      : r.yarn_pending_kg > 0.0005
        ? "part_sent"
        : "all_sent";
/** Distinct values across a list field of every row — a facet offers only what the rows hold. */
const listOptions = (rows: KnittingOrderListRow[], get: (r: KnittingOrderListRow) => string[]) =>
  [...new Set(rows.flatMap(get))].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));

function koFacets(rows: KnittingOrderListRow[]): FacetGroup<KnittingOrderListRow>[] {
  return [
    {
      title: "Status & dates",
      icon: <CalendarRange />,
      facets: [
        {
          key: "status",
          label: "Status",
          all: "All statuses",
          wide: true,
          counted: true,
          options: KO_STATUSES.map((st) => ({ value: st, label: KNIT_STATUS_LABELS[st] })),
          match: (r, v) => r.status === v,
        },
        { key: "koDate", label: "KO Date", all: "Any date", date: (r) => r.order_date },
        { key: "delivery", label: "Delivery Date", all: "Any date", date: (r) => r.expected_date },
      ],
    },
    {
      title: "Party & fabric",
      icon: <Users />,
      facets: [
        { key: "knitter", label: "Knitter", all: "All knitters", wide: true, value: (r) => r.vendor_name },
        { key: "re", label: "RE No", all: "All REs", options: listOptions(rows, (r) => r.re_numbers), match: (r, v) => r.re_numbers.includes(v) },
        { key: "buyer", label: "Buyer", all: "All buyers", options: listOptions(rows, (r) => r.buyer_names), match: (r, v) => r.buyer_names.includes(v) },
        {
          key: "category",
          label: "Category",
          all: "All categories",
          options: listOptions(rows, (r) => r.categories.map((c) => c.name)),
          match: (r, v) => r.categories.some((c) => c.name === v),
        },
      ],
    },
    {
      title: "Yarn & stock",
      icon: <Package />,
      facets: [
        {
          key: "yarn",
          label: "Yarn Issue",
          all: "Any",
          wide: true,
          counted: true,
          options: [
            { value: "not_sent", label: "Not sent yet" },
            { value: "part_sent", label: "Part sent" },
            { value: "all_sent", label: "Fully sent" },
            { value: "own_yarn", label: "Knitter's own yarn" },
          ],
          match: (r, v) => yarnIssueOf(r) === v,
        },
        {
          key: "stock",
          label: "Stock",
          all: "Any",
          counted: true,
          options: [
            { value: "available", label: "Available" },
            { value: "deficit", label: "Deficit" },
            { value: "none", label: "Nothing to issue" },
          ],
          match: (r, v) => (v === "none" ? r.stock_status === null : r.stock_status === v),
        },
        urgencyFacet((r) => r.expected_date),
        createdByFacet(),
      ],
    },
  ];
}

/** To Program rows are RE balances, not orders — their own small drawer. */
const BALANCE_FACETS: FacetGroup<KnitBalanceRow>[] = [
    {
      title: "RE & fabric",
      icon: <Users />,
      facets: [
        { key: "customer", label: "Customer", all: "All customers", wide: true, value: (b) => b.customer },
        { key: "re", label: "RE No", all: "All REs", value: (b) => b.re_no },
        { key: "fabric", label: "Fabric", all: "All fabrics", value: (b) => b.fabric_name },
      ],
    },
];

export function KnittingOrdersList({
  rows,
  canEdit,
  canDelete = false,
  balances = [],
  canCreate = false,
}: {
  rows: KnittingOrderListRow[];
  canEdit: boolean;
  canDelete?: boolean;
  /** RE fabric kg not yet on any Knitting Order — the To Program view (0847). */
  balances?: KnitBalanceRow[];
  canCreate?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { success, error: toastError } = useToast();
  /* IN KNITTING IS DELETABLE FROM HERE (user 2026-11-14: "give access in ui for delete"). 0843:
     the delete undoes the order's sent yarn DCs itself — yarn back to its bin — then deletes, in
     one transaction, and refuses with its own sentence once anything has come back from the
     knitter. Rows past that point keep the bin GREYED with the reason (AGENTS.md "Row actions":
     hiding is for missing permission only). */
  /* DELETABLE AT ANY STAGE (user 2026-11-14, 0849): the delete reverses a close, every receipt and
     every sent DC in one transaction, and refuses with its own sentence only where a reversal is
     impossible (a passed bill, fabric issued onward, yarn moved between orders). */
  const deleteBlocked = (_r: KnittingOrderListRow): string | null => null;
  const remove = (r: KnittingOrderListRow) =>
    startTransition(async () => {
      const res = await deleteKnittingOrder(r.id);
      if (res.ok) {
        success(
          r.status === "in_process"
            ? `${r.code ?? "Knitting order"} deleted — its yarn DC is undone and the yarn is back in its bin`
            : ["partially_received", "received", "closed"].includes(r.status)
              ? `${r.code ?? "Knitting order"} deleted — its receipts, yarn DCs and close were reversed`
              : `${r.code ?? "Knitting order"} deleted`,
        );
        router.refresh();
      } else toastError(res.error);
    });
  const [search, setSearch] = useState("");
  // The drawers — both hooks always run (AGENTS.md "Hooks above every early return").
  // RE No / Buyer / Category options come off the rows, so the groups are rebuilt only when they change.
  const koGroups = useMemo(() => koFacets(rows), [rows]);
  const facets = useFacetFilter(rows, koGroups);
  const balFacets = useFacetFilter(balances, BALANCE_FACETS);
  /* YARN TO ISSUE (client recording 2026-11-14): a switch on THIS list, not a new page — narrows
     to the orders still owing yarn. An order clears itself once its yarn is all sent or it is
     closed (the service reports 0 pending for a finished order). */
  const [view, setView] = useState<"all" | "pending" | "program">("all");
  const owes = (r: KnittingOrderListRow) => r.yarn_pending_kg > 0.0005;
  const pendingCount = rows.filter(owes).length;
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!q || [r.code, r.order_number, r.vendor_name, ...r.buyer_names].some((x) => x?.toLowerCase().includes(q))) &&
      facets.matches(r) &&
      (view === "all" || owes(r)),
  );
  const drawer = view === "program" ? balFacets : facets;

  const columns: Column<KnittingOrderListRow>[] = [
    /* ONE ROW, NOTHING UNDER THE ICONS (user 2026-11-14, screenshot 4190: the columns "folded one
       by one" under the pinned row actions). Fifteen columns cannot sit side by side on a 1920 screen,
       so the dates ride under the KO No, the stock badge under its figure, and the kg headings wrap
       to two lines — each column is as wide as its numbers, not its heading. */
    {
      header: "KO No · Date",
      cell: (r) => (
        <div className="leading-tight">
          <Link href={`${BASE}/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
            {r.code ?? "—"}
          </Link>
          <div className="text-xs tabular-nums text-muted-foreground">
            {fmtDate(r.order_date)}
            {r.expected_date ? ` · Due ${fmtDate(r.expected_date)}` : ""}
          </div>
        </div>
      ),
    },
    { header: "RE No", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Knitter", className: "whitespace-normal min-w-[7rem]", cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span> },
    { header: "Fabric Kg", align: "right", className: "whitespace-normal min-w-[4.5rem]", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.programmed_kg)}</span> },
    // LIVE YARN ISSUE (Session 2, 2026-11-14): what the program needs, what has left on sent DCs,
    // and what is still to go — 1000 programmed, 500 issued reads 500 pending.
    { header: "Yarn Program (kg)", align: "right", className: "whitespace-normal min-w-[4.5rem]", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.yarn_program_kg)}</span> },
    { header: "Yarn Sent (kg)", align: "right", className: "whitespace-normal min-w-[4.5rem]", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.yarn_issued_kg)}</span> },
    {
      header: "Yarn to be Issued (kg)",
      align: "right",
      className: "whitespace-normal min-w-[4.5rem]",
      cell: (r) => (
        <span className={`tabular-nums text-sm ${r.yarn_pending_kg > 0 ? "font-medium text-warning" : "text-muted-foreground"}`}>
          {fmtNumber(r.yarn_pending_kg)}
        </span>
      ),
    },
    {
      // LIVE STOCK beside the balance (client 2026-11-14): this unit's bins of the yarns still owed.
      header: "Yarn in Store (kg)",
      align: "right",
      className: "whitespace-normal min-w-[5.5rem]",
      cell: (r) =>
        owes(r) ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className={`tabular-nums text-sm ${r.stock_status === "deficit" ? "text-danger" : ""}`}>{fmtNumber(r.yarn_stock_kg)}</span>
            {r.stock_status ? (
              // status-tone: exempt -- a stock-cover flag computed here, not a document status word
              <span title={r.stock_status === "deficit" ? r.stock_short.join("\n") : "This unit's bins hold every yarn still to issue"}>
                <StatusPill tone={r.stock_status === "available" ? "success" : "danger"}>
                  {r.stock_status === "available" ? "Available" : "Deficit"}
                </StatusPill>
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{KNIT_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <RowActions
          label={r.code}
          view={false}
          // Report takes the eye's slot (AGENTS.md "Row actions"): the Knitting Analysis.
          lead={
            <>
              {/* QUICK RE-ISSUE (client 2026-11-14): opens the order with every Send Qty already
                  at what is left to send — one click on Delivery Now dispatches it. */}
              {canEdit && owes(r) && r.status !== "draft" ? (
                <RowIconAction label="Send yarn" name={r.code} icon={Truck} onClick={() => router.push(`${BASE}/${r.id}?send=1`)} />
              ) : null}
              <RowIconAction label="Knitting Analysis" name={r.code} icon={FileText} onClick={() => router.push(`${BASE}/${r.id}/report`)} />
            </>
          }
          canEdit={canEdit}
          onEdit={() => router.push(`${BASE}/${r.id}`)}
          editDisabledReason={r.status === "cancelled" ? "Cancelled — read-only" : null}
          canDelete={canDelete}
          onDelete={() => remove(r)}
          deleteDisabledReason={deleteBlocked(r)}
        />
      ),
    },
  ];
  // created-by: exempt -- a balance is computed from the Fabric BOM, not a record anyone created
  const balancesShown = balances.filter(
    (b) => (!q || [b.re_no, b.fabric_name, b.customer].some((x) => x?.toLowerCase().includes(q))) && balFacets.matches(b),
  );
  const balanceColumns: Column<KnitBalanceRow>[] = [
    { header: "RE No", cell: (b) => <span className="text-sm">{b.re_no ?? "—"}</span> },
    { header: "Customer", cell: (b) => <span className="text-sm">{b.customer ?? "—"}</span> },
    {
      header: "Fabric",
      cell: (b) => (
        <span className="text-sm">
          {b.fabric_name}
          <span className="block text-xs text-muted-foreground">
            {[b.finish_dia ? `Fin Dia ${b.finish_dia}` : null, b.width_form === "open_width" ? "Open Width" : b.width_form === "tubular" ? "Tubular" : null].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
    },
    { header: "Total RE Qty (kg)", align: "right", cell: (b) => <span className="tabular-nums text-sm">{fmtNumber(b.bom_kg)}</span> },
    {
      header: "Already Placed (kg)",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(b.placed_kg)}
          {b.placed_on ? <span className="block text-xs text-muted-foreground">{b.placed_on}</span> : null}
        </span>
      ),
    },
    { header: "Balance to Program (kg)", align: "right", cell: (b) => <span className="tabular-nums text-sm font-medium text-warning">{fmtNumber(b.balance_kg)}</span> },
    {
      header: "",
      align: "right",
      cell: (b) =>
        canCreate ? (
          <Link href={`${BASE}/new?re=${b.sales_order_id}`} className={buttonClasses({ size: "sm", variant: "outline" })}>
            <Plus className="h-4 w-4" aria-hidden />
            Raise KO
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={view === "program" ? "Search RE No, fabric or customer…" : "Search KO No, RE No, knitter or buyer…"}
        activeCount={drawer.activeCount}
        onReset={drawer.activeCount ? drawer.reset : undefined}
        panel={drawer.panel}
        leading={
          <ToggleGroup<"all" | "pending" | "program">
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: "all", label: `All (${rows.length})` },
              { value: "pending", label: `Yarn to Issue (${pendingCount})` },
              /* TO PROGRAM (user 2026-11-14: RE 13's 157.2 kg was nowhere on this list) — RE fabric
                 kg not yet on any Knitting Order. Not yarn to issue: no KO, so no yarn is owed yet. */
              { value: "program", label: `To Program (${balances.length})` },
            ]}
          />
        }
      />
      {view === "program" ? (
        <DataTable
          columns={balanceColumns}
          rows={balancesShown}
          getKey={(b) => `${b.sales_order_id}#${b.key}`}
          empty="Every fabric of the REs being knitted is on a Knitting Order (or short-closed)."
        />
      ) : (
        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(r) => r.id}
          empty={rows.length ? "No knitting orders match these filters." : "No knitting orders yet."}
        />
      )}
    </div>
  );
}
