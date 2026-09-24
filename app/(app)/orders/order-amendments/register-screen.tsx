"use client";

/**
 * ORDERS ▸ ORDER AMENDMENTS — the register (doc/order/amedment.md §1).
 *
 * Every Amendment Entry across every order: the RE No and customer, which
 * amendment of that order it is (Amend #n), who asked, what kind of change,
 * the margin delta between the approved baseline and the revised budget, and
 * where it stands. Filterable by customer, origin and status; searchable by RE
 * No, entry no, customer and remarks.
 *
 * THE STATUS IS DERIVED (`entryStatusOf`): the entry has an `outcome` and its
 * budget has a `status`, and "pending approval" IS the budget being with the
 * approver. There is no third column to drift. The margin delta is two stored
 * KPI sets compared (`marginDelta`) — nothing here computes a profit.
 *
 * ONLY ORDERS THAT HAVE BEEN AMENDED (doc/order/amenment update.md §1: "the
 * register queries only records where amendment_no >= 1 … unamended baseline
 * orders are excluded"). Until 2026-09-23 every approvable order also showed
 * here as a line with "nothing raised yet"; the way to one of those now is
 * [ + Raise Amendment ], which opens an ORDER PICKER MODAL (spec §1) listing
 * exactly them, or [Amend] on the order list.
 *
 * ONE LIST, GROUPED BY ORDER (user 2026-09-22, screenshot 3024: "the table
 * and created order messed view"). Until then the page carried TWO lists that
 * said the same thing — an "orders that can be amended" strip naming every RE
 * No and customer, and a 12-column table naming them again on every entry,
 * with five of those columns wrapping. The order is the register's SUBJECT
 * and is now said ONCE: a line spanning the table (`DataTable`'s `spanRow`)
 * carrying RE No, customer, delivery and the approved budget, with its entries
 * beneath it minus the order columns. The
 * spec's seven columns (doc/order/amedment.md §1) stand; the duplicate `Date`
 * (it IS Created Date, the spec says so) is gone, and the created pair stays
 * last per the standing rule. Every code column declares a width and
 * `whitespace-nowrap`, so nothing wraps.
 *
 * [ + Raise Amendment ] opens the order picker; picking lands on the raise
 * page pre-picked (the door itself stays a page, user 2026-09-22). The order
 * list's [Amend] lands here with `?raise=<order id>` and goes straight there. A row opens the
 * entry page (`/orders/order-amendments/<id>`), which carries the variance
 * matrix, the change summary, the downstream documents and the approval
 * timeline.
 */

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarRange,
  ClipboardList,
  FileText,
  Layers,
  Package,
  Plus,
  TrendingDown,
  Undo2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import { Field } from "@/components/ui/field";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  createdByFacet,
  createdDateFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { fmtDate } from "@/lib/format";
import { isRefusal } from "@/lib/orders/budget/totals";
import {
  AMENDMENT_ENTRY_TYPES,
  AMENDMENT_MODULES,
  AMENDMENT_ORIGINS,
  ENTRY_STATUS_FILTERS,
  OFFERED_KINDS,
  entryIsOpen,
  entryScopeLabel,
  modulesOf,
  moduleLabel,
  entryStatusLabel,
  entryStatusMatches,
  entryStatusTone,
  marginAlert,
  originLabel,
  type AmendmentEntryStatus,
  type MarginDelta,
} from "@/lib/orders/amendments/amendment-entry";
import { revisionLandingOf } from "@/components/orders/amendment-tabs";
import { abandonOrderAmendment } from "@/lib/orders/order-amendments/actions";
import type { AmendableOrder, AmendmentRegisterRow } from "@/lib/orders/order-amendments/service";

/** The order line's facts — from `AmendableOrder` when the order can be amended now, else from its entries. */
type OrderHead = {
  key: string;
  order_id: string | null;
  re_no: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  budget_code: string | null;
  approved_at: string | null;
  /** Set when the order is amendable right now — it carries the Amend button. */
  amendable: AmendableOrder | null;
};

/** One flat array for `DataTable`: an order line, then its entries. */
type RegisterLine =
  | { kind: "order"; id: string; head: OrderHead; count: number }
  | ({ kind: "entry"; sno: number } & AmendmentRegisterRow);

/**
 * THE REGISTER'S FILTERS PANEL — the grouped drawer every Orders child draws
 * (user, 2026-09-23: "implement the Material BOM filter in every Orders
 * child"). It replaced three <Select>s — Customer, Origin, Approval status —
 * and keeps all three with the same semantics (Approval status still reads
 * `entryStatusMatches`, so "Open" is still draft + rejected). Every facet is
 * read off the `AmendmentRegisterRow` the table already carries.
 *
 * Three questions: where the entry stands and when; whose order, who asked and
 * what kind of change; what it did to the margin, and who raised it.
 *
 * ONLY CUSTOMER REACHES AN ORDER LINE WITH NOTHING RAISED. Every other facet
 * is a fact about an ENTRY, which that line has none of — so, as with Origin
 * and Status before, setting any of them hides it (`lines` below).
 */
const REGISTER_FACETS: FacetGroup<AmendmentRegisterRow>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "status",
        label: "Approval status",
        all: "All statuses",
        wide: true,
        counted: true,
        options: ENTRY_STATUS_FILTERS.filter((s) => s.value).map((s) => ({ value: s.value, label: s.label })),
        match: (r, v) => entryStatusMatches(v, r.status),
      },
      createdDateFacet(),
      { key: "closed", label: "Closed Date", all: "Any date", date: (r) => r.closed_at },
    ],
  },
  {
    title: "Customer & change",
    icon: <Users />,
    facets: [
      { key: "customer", label: "Customer", all: "All customers", wide: true, value: (r) => r.customer_name },
      {
        key: "origin",
        label: "Origin",
        all: "All origins",
        options: AMENDMENT_ORIGINS.map((o) => ({ value: o.value, label: `${o.label} (${o.code})` })),
        match: (r, v) => r.origin === v,
      },
      {
        // The spec's Module Category (0619) — derived from the entry's kinds.
        key: "module",
        label: "Module",
        all: "Any module",
        counted: true,
        options: AMENDMENT_MODULES.map((m) => ({ value: m.key, label: m.label })),
        match: (r, v) => (modulesOf(r.types) as string[]).includes(v),
      },
      {
        // An entry carries a UNION of categories (0616), so it matches every
        // one it names. Counted, so a category nobody has raised reads (0).
        key: "type",
        label: "Change Type",
        all: "Any change",
        counted: true,
        options: OFFERED_KINDS.map((k) => ({ value: k, label: AMENDMENT_ENTRY_TYPES.find((t) => t.value === k)?.label ?? k })),
        match: (r, v) => r.types.includes(v),
      },
    ],
  },
  {
    title: "Margin & creator",
    icon: <TrendingDown />,
    facets: [
      {
        // `marginAlert` — the same reading that tones the Margin Delta cell.
        key: "margin",
        label: "Margin Delta",
        all: "Any",
        wide: true,
        counted: true,
        options: [
          { value: "drop", label: "Margin dropped" },
          { value: "rise", label: "Margin rose" },
          { value: "flat", label: "No change" },
          { value: "unknown", label: "Not known yet" },
        ],
        match: (r, v) => marginAlert(r.margin) === v,
      },
      createdByFacet(),
    ],
  },
];

/**
 * THE PENDING / UPDATED / DRAFT BOX (user 2026-09-23: "in budget we have
 * pending, update, draft button need to implement same order module fully").
 * The three words over the entry's DERIVED status, read the way Budget
 * Approval reads its own budgets, since an entry's state IS its budget's:
 *
 *  - Pending — `pending_md_approval`: the revised budget is with the MD, the
 *    one decision the register is waiting on.
 *  - Updated — `approved` / `rejected`: the MD has decided (Budget Approval
 *    counts both as updated, and so does this).
 *  - Draft — `draft` / `returned`: still with the merchandiser. `returned` is
 *    "Rejected — revise", open and being re-worked, and the drawer's own Draft
 *    status already folds it in (`entryStatusMatches`) — one reading, not two.
 *  - abandoned / superseded → no word: closed without a decision. They show
 *    while the drawer's Status facet is set, when the box stands down.
 */
const QUICK_WORD: Record<AmendmentEntryStatus, QuickWord | null> = {
  pending_md_approval: "pending",
  approved: "updated",
  rejected: "updated",
  draft: "draft",
  returned: "draft",
  abandoned: null,
  superseded: null,
};
const entryWord = (r: AmendmentRegisterRow): QuickWord | null => QUICK_WORD[r.status] ?? null;

/**
 * WHERE OPENING AN ENTRY LANDS (client 2026-09-24) — its category's tab while
 * the merchandiser still has work in it (Draft, or Returned by the MD); the
 * Overview once it is with the MD or closed, since nothing on a tab can be
 * changed then and the Overview is where its state and figures are.
 */
const openHref = (r: AmendmentRegisterRow): string =>
  r.status === "draft" || r.status === "returned"
    ? revisionLandingOf(r.id, r.types)
    : `/orders/order-amendments/${r.id}`;

/** One labelled fact on an order line: "Delivery 31/12/2026". */
function HeadFact({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap text-xs">
      <span className="text-muted-foreground">{label}</span>{" "}
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </span>
  );
}

/** "+2.10%" / "-3.45%" in percentage points, toned; a refusal says why in words. */
export function MarginDeltaCell({ margin }: { margin: MarginDelta }) {
  const alert = marginAlert(margin);
  if (isRefusal(margin.delta)) {
    return (
      <span className="text-xs text-muted-foreground" title={margin.delta.refused}>
        —
      </span>
    );
  }
  const sign = margin.delta > 0 ? "+" : "";
  return (
    <span
      className={
        alert === "drop"
          ? "font-medium tabular-nums text-danger"
          : alert === "rise"
            ? "font-medium tabular-nums text-success"
            : "tabular-nums"
      }
    >
      {sign}
      {margin.delta.toFixed(2)}%
    </span>
  );
}

export function AmendmentRegisterScreen({
  rows,
  orders,
  perms,
}: {
  rows: AmendmentRegisterRow[];
  orders: AmendableOrder[];
  perms: { canEdit: boolean };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const facets = useFacetFilter(rows, REGISTER_FACETS);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  /* EVERY FILTER BUT THE BOX'S OWN — what the box counts (a count is what
     clicking that word would show) and what `filtered` narrows by the word. */
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatch(r)) return false;
      if (!q) return true;
      return [r.entry_no, r.re_no, r.order_code, r.customer_name, r.remarks, entryScopeLabel(r.types, r.details)]
        .filter((v): v is string => !!v)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, query, facetMatch]);
  const quick = useQuickStatus(entryWord, {
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    /* The figure on each word, over the searched and faceted list with this
       box's own word left off — an abandoned or superseded entry is in none
       of the three and so in no figure, the same way it is in no word. */
    countRows: base,
  });
  const qm = quick.matches;

  /* THE ORDER PICKER MODAL (spec §1). `origin` is the button's own rect so
     the sheet grows out of it (AGENTS.md, "A sub-detail Sheet's size"). */
  const [picking, setPicking] = useState<SheetOrigin | null>(null);
  const [pickedOrder, setPickedOrder] = useState<string | null>(null);
  const pickerRows = useMemo<PickerRow[]>(
    () =>
      orders.map((o) => ({
        id: o.id,
        label: o.re_no ?? o.code ?? o.id.slice(0, 8),
        sublabel: [
          o.customer_name,
          o.amending ? `under revision — ${o.amending.entry_no ?? "open entry"}` : o.delivery_date ? `Delivery ${fmtDate(o.delivery_date)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        code: o.code,
      })),
    [orders],
  );


  /* THE DOOR IS A PAGE (user 2026-09-22; it was a sheet until then). A
     `?raise=<order id>` link from the order list is forwarded to it. */
  const raiseHref = (orderId?: string | null) =>
    orderId ? `/orders/order-amendments/new?order=${orderId}` : "/orders/order-amendments/new";
  useEffect(() => {
    const id = params.get("raise");
    if (!id) return;
    router.replace(raiseHref(id));
  }, [params, router]);

  const filtered = useMemo(() => base.filter(qm), [base, qm]);

  /* THE LIST: one line per AMENDED order, its entries beneath, in ENTRY
     order. An order the filters emptied is dropped with its entries; an order
     with nothing raised is never listed (spec §1) — `orders` only enriches the
     heads of orders that have entries (delivery, budget, the Amend again
     button). Oldest first entry first. */
  const lines = useMemo<RegisterLine[]>(() => {
    const groups = new Map<string, { head: OrderHead; entries: AmendmentRegisterRow[] }>();
    for (const r of filtered) {
      const key = r.garment_order_id ?? (r.budget_id ? `budget:${r.budget_id}` : r.id);
      let g = groups.get(key);
      if (!g) {
        g = {
          head: {
            key,
            order_id: r.garment_order_id,
            re_no: r.re_no ?? r.order_code ?? (r.budget_code ? `Budget ${r.budget_code}` : null),
            customer_name: r.customer_name,
            delivery_date: null,
            budget_code: r.budget_code,
            approved_at: null,
            amendable: null,
          },
          entries: [],
        };
        groups.set(key, g);
      }
      g.entries.push(r);
    }
    for (const o of orders) {
      const g = groups.get(o.id);
      if (!g) continue;
      g.head.delivery_date = o.delivery_date;
      g.head.budget_code = o.budget_code ?? g.head.budget_code;
      g.head.approved_at = o.approved_at;
      g.head.amendable = o;
    }
    const sorted = [...groups.values()].sort((a, b) =>
      (a.entries[0]?.created_at ?? "").localeCompare(b.entries[0]?.created_at ?? ""),
    );
    const out: RegisterLine[] = [];
    /* S.No counts the ENTRY lines 1, 2, 3 down the page — the order heads
       between them are not rows of the register and take no number. */
    let sno = 0;
    for (const g of sorted) {
      out.push({ kind: "order", id: `order:${g.head.key}`, head: g.head, count: g.entries.length });
      for (const r of [...g.entries].sort((a, b) => a.amend_no - b.amend_no)) out.push({ kind: "entry", sno: ++sno, ...r });
    }
    return out;
  }, [filtered, orders]);

  function abandon(r: AmendmentRegisterRow) {
    if (
      !window.confirm(
        `Abandon revision ${r.entry_no ?? ""}? Every change made under it is discarded — the order, both BOMs and the budget go back to the approved version and the order locks again.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await abandonOrderAmendment(r.id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        res.outcome === "restored"
          ? `Revision ${r.entry_no ?? ""} abandoned — the approved version stands and the order is locked again`
          : `Revision ${r.entry_no ?? ""} abandoned — the order stays open and needs a fresh budget approval`,
      );
      router.refresh();
    });
  }

  /* Cells only ever see an ENTRY line: order lines are rendered by `spanRow`
     on both layouts, so `entryCol` narrows the union once here rather than in
     every cell. Widths are declared so the code columns cannot wrap (that was
     five wrapping columns in screenshot 3024); Change Type is the one column
     left to take the remaining width, through `Truncated`. */
  const entryCol = (
    header: string,
    cell: (r: AmendmentRegisterRow & { sno: number }) => ReactNode,
    extra?: Pick<Column<RegisterLine>, "align" | "className">,
  ): Column<RegisterLine> => ({
    header,
    cell: (l) => (l.kind === "entry" ? cell(l) : null),
    ...extra,
  });

  const columns: Column<RegisterLine>[] = [
    /* S.NO, NOT THE ENTRY NO (client 2026-09-24: "hide raw entry IDs, keep
       only a clean S.No"). REV/26-27/000n is still searched (the filter reads
       `entry_no`) and still names the entry on its own page, in the Abandon
       prompt and on the row menu — it is only no longer a column. The link to
       the entry moved onto Revision, the column that now identifies the row. */
    entryCol("S.No", (r) => <span className="tabular-nums">{r.sno}</span>, {
      align: "right",
      className: "w-[4rem] whitespace-nowrap",
    }),
    entryCol(
      "Revision",
      (r) => (
        <button
          type="button"
          className="tabular-nums font-medium text-primary hover:underline"
          onClick={() => router.push(openHref(r))}
        >
          Rev #{r.amend_no}
        </button>
      ),
      { className: "w-[6rem] whitespace-nowrap" },
    ),
    entryCol("Origin", (r) => originLabel(r.origin), { className: "w-[7.5rem] whitespace-nowrap" }),
    /* ONE CHIP PER MODULE (user 2026-09-24, screenshot 3049: the whole
       "Order Entry (Combo / Color Change, Quantity Addition) + Material BOM +
       Fabric BOM" sentence on one line pushed the table into a sideways
       scroll). The chips WRAP inside a bounded column, so the row grows down,
       never across. One neutral tone for every module: the pill tones are the
       app's STATUS vocabulary, and a green or red module would read as a
       state. Order Entry's kinds ride on its chip's tooltip; search still
       matches them (`entryScopeLabel` above), and the entry's own page lists
       them in full. */
    entryCol(
      "Change Type",
      (r) => {
        const kinds = entryScopeLabel(r.types, r.details);
        const mods = modulesOf(r.types);
        if (mods.length === 0) return <span className="text-xs">{kinds}</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {mods.map((m) => (
              <span
                key={m}
                title={m === "order_entry" ? kinds.split(" + ")[0] : undefined}
                className="inline-flex items-center whitespace-nowrap rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground"
              >
                {moduleLabel(m)}
              </span>
            ))}
          </div>
        );
      },
      { className: "min-w-[12rem] max-w-[20rem]" },
    ),
    entryCol("Margin Delta", (r) => <MarginDeltaCell margin={r.margin} />, {
      align: "right",
      className: "w-[7rem] whitespace-nowrap",
    }),
    entryCol(
      "Status",
      (r) => (
        /* The MD's reason rides on the badge (spec: "reason logged in the
           register"), and a revert that could not complete says so. */
        <span title={r.rejection_reason ?? r.revert_error ?? undefined}>
          <StatusPill tone={entryStatusTone(r.status)}>{entryStatusLabel(r.status)}</StatusPill>
        </span>
      ),
      { className: "w-[9rem] whitespace-nowrap" },
    ),
    rowActionsColumn((l) => {
      if (l.kind !== "entry") return null;
      const r = l;
      const open = entryIsOpen(r.status);
      return (
        <RowActions
          label={r.entry_no ?? r.re_no}
          onView={() => router.push(openHref(r))}
          isPending={isPending}
          menu={[
            ...(r.garment_order_id
              ? [
                  {
                    label: "Open order",
                    icon: ClipboardList,
                    onClick: () => router.push(`/orders/order-amendments/${r.id}/order`),
                  },
                  {
                    label: "Open Fabric BOM",
                    icon: Layers,
                    onClick: () => router.push(`/orders/order-amendments/${r.id}/fabric-bom`),
                  },
                  {
                    label: "Open Material BOM",
                    icon: Package,
                    onClick: () => router.push(`/orders/order-amendments/${r.id}/material-bom`),
                  },
                ]
              : []),
            ...(r.budget_id
              ? [
                  {
                    label: "Open budget",
                    icon: FileText,
                    onClick: () => router.push(`/orders/order-amendments/${r.id}/budget`),
                  },
                ]
              : []),
            ...(open && r.garment_order_id && perms.canEdit && r.status !== "pending_md_approval"
              ? [{ label: "Abandon revision", icon: Undo2, danger: true, onClick: () => abandon(r) }]
              : []),
          ]}
        />
      );
    }),
  ];

  /* The order line. Said once, above its entries: RE No, customer, delivery,
     the approved budget, and — when the order can be amended right now — its
     own Amend, "Amend again" while an entry is already open. An order the
     register knows only through its entries (no longer amendable: pending
     approval, or cancelled) gets no button; its entries say where it stands. */
  const orderLine = (l: RegisterLine) => {
    if (l.kind !== "order") return null;
    const h = l.head;
    const o = h.amendable;
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-mono text-xs font-semibold text-foreground">{h.re_no ?? "—"}</span>
          <Truncated className="max-w-[18rem] text-sm font-medium">{h.customer_name ?? "—"}</Truncated>
          {/* LABELLED FACTS, NOT A SENTENCE (user 2026-09-24, screenshot 3049:
              "delivery 31/12/2026 · budget 2 approved 22/09/2026" read as
              loose text). Label muted, value in the foreground. */}
          {h.delivery_date && <HeadFact label="Delivery" value={fmtDate(h.delivery_date)} />}
          {h.budget_code && <HeadFact label="Budget" value={h.budget_code} />}
          {h.approved_at && <HeadFact label="Approved" value={fmtDate(h.approved_at)} />}
        </div>
        {o && perms.canEdit && (
          <Button variant="outline" size="sm" onClick={() => router.push(raiseHref(o.id))}>
            <Plus className="h-3.5 w-3.5" /> {o.amending ? "Add module" : "Revise"}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Revisions"
        description="Every change raised on an approved order — who asked, what kind, what it does to the margin, and where it stands."
        actions={
          perms.canEdit ? (
            <Button
              size="md"
              onClick={(e) => {
                setPickedOrder(null);
                /* `currentTarget`, never `target` — the click can land on the icon. */
                setPicking(e.currentTarget.getBoundingClientRect());
              }}
            >
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
        searchPlaceholder="Search RE No, entry no, customer or remarks…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        right={`${filtered.length} of ${rows.length}`}
      />

      {/* dup-check: exempt -- a dated amendment entry; a second entry on the same RE is how a revision is raised */}
      <DataTable
        columns={withCreatedColumns(columns, lines)}
        rows={lines}
        getKey={(l) => l.id}
        spanRow={orderLine}
        empty={
          rows.length > 0
            ? quick.value
              ? `No ${quick.value} revision${facets.activeCount || query.trim() ? " matches these filters" : ""} — ${rows.length} in the register; pick another word above.`
              : "No revision matches these filters."
            : orders.length > 0
              ? "No revision has been raised yet — Raise Revision picks the approved order to change."
              : "No revision has been raised yet, and no order is approved to revise. An order can be revised once a budget that names it is approved (Orders ▸ Order Management ▸ Approval)."
        }
      />

      {/* THE ORDER PICKER MODAL (spec §1) — a sub-detail with no Save of its
          own, so `size="sm"` + `alignToPane` + `origin` (AGENTS.md). Its one
          action is Continue, which lands on the raise page pre-picked. */}
      <Sheet
        open={!!picking}
        onClose={() => setPicking(null)}
        title="Raise Revision — select order"
        size="sm"
        alignToPane
        origin={picking}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="md" onClick={() => setPicking(null)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={!pickedOrder}
              onClick={() => {
                if (!pickedOrder) return;
                setPicking(null);
                router.push(raiseHref(pickedOrder));
              }}
            >
              Continue
            </Button>
          </div>
        }
      >
        <Field label="Select Order" required htmlFor="oa-pick-order">
          <DataPicker
            id="oa-pick-order"
            label="Select Order"
            title="Orders that can be revised"
            compact
            rows={pickerRows}
            value={pickedOrder}
            onChange={setPickedOrder}
            required
            emptyHint="No order to revise — a revision is raised on an order whose budget has been approved. An open order is edited directly."
          />
        </Field>
        <p className="mt-2 text-xs text-muted-foreground">
          Approved orders, and orders already under a revision (a new one supersedes it and keeps what it opened).
        </p>
      </Sheet>

    </div>
  );
}
