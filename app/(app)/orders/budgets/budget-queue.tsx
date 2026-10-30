"use client";

import { useMemo, useState } from "react";
import { CalendarRange, ClipboardCheck, Users } from "lucide-react";
import { fmtDate, fmtNumber } from "@/lib/format";
import { FilterBar } from "@/components/ui/filter-bar";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { flagFacet, urgencyFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { StatusPill } from "@/components/ui/status-pill";
import { DaysOut, QUICK_WORDS_3, useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { GlowRecordCard } from "@/app/(app)/sales/sample-costing/costing-card";
import { CardAction, CardDeleteAction, DUO } from "@/components/ui/card-action";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";
import { GLOW_RULE } from "@/lib/ui/buyer-glow";
import { sharedPrefix, sharedValue } from "@/lib/ui/shared-words";
import { cn } from "@/lib/utils";
import { FigureCell, OrderQueueTable } from "@/components/orders/order-queue-table";
import type { StatusTone } from "@/lib/ui/tone";
import {
  budgetStatusText,
  budgetStatusTone,
  type BudgetableOrder,
  type BudgetStatus,
} from "@/lib/orders/budget/types";

/**
 * THE ORDERS READY TO BUDGET, AS CARDS — the Material BOM / Fabric BOM queue,
 * one step on (user 2026-09-19: "list the completed order entry with material
 * bom and fabric bom … in card how we listing for material bom and fabric bom").
 *
 * READY means the prerequisite gate: Order Entry recorded AND both BOMs saved
 * (`bom_refusal` null). An order still waiting on a BOM is not a card, because
 * nothing can be done with it HERE. It is counted in the summary so it isn't
 * silently missing. AN ORDER THAT ALREADY HAS A BUDGET ALWAYS KEEPS ITS CARD,
 * ready or not (a BOM sent back to draft after budgeting): since the Budgets
 * table left the page (user 2026-09-20) the card is the budget's only door,
 * and it says why the order is no longer ready.
 *
 * THE SAME DRAWING AS `BomQueue` (`components/orders/bom-queue.tsx`): the
 * `FilterBar` with a counted Status facet, the summary on its right, six cards
 * across — since 2026-10-26 the Costing glow card (`GlowRecordCard`), not
 * `MobileCardList` — and, on the Updated table, `DaysOut` beside
 * the delivery date. Not `BomQueue` itself, which is built on the BOM statuses
 * (Pending / Draft / Updated / Recalculate); a budget has its own vocabulary.
 *
 * Opening a card that is already in a budget opens THAT budget; opening one
 * that is not starts a new budget with the order picked and its lines already
 * pulled. Since 2026-09-20 this is the page's ONLY list (the Budgets table was
 * removed), so it is also where a budget is deleted.
 */

/** "Not budgeted" plus the four budget states. */
export type QueueStatus = "none" | BudgetStatus;

/** What needs doing, first: the order nobody has budgeted, then the one sent
 *  back, then the drafts; what is with the approver or done comes last. */
const QUEUE_ORDER: readonly QueueStatus[] = ["none", "rejected", "draft", "submitted", "approved"];

const statusOf = (o: BudgetableOrder): QueueStatus => o.in_budget?.status ?? "none";

/**
 * WHICH OF THE THREE WORDS AN ORDER COUNTS AS — one word per order, and that
 * is the whole point of stating it as a function.
 *
 * DRAFT USED TO SHOW UNDER UPDATED AS WELL (user, 2026-09-24: "budgeting la
 * draft datas lam updated la kaatuthu"). The box was hand-rolled here as a
 * `useState` and three independent `if` lines in the filter, and the Updated
 * line read `statusOf(o) === "none"` — "a budget exists, whatever its state" —
 * so a draft satisfied Draft AND Updated. Three separate tests over one state
 * can overlap; a `wordOf` cannot, because it returns ONE word. That is why the
 * screen now goes through `useQuickStatus` rather than keeping the three lines
 * with the middle one patched.
 *
 * `rejected` stays UPDATED, unchanged by that fix — it is a budget that has
 * been through the approver, which is what the word means on the Approval
 * queue beside this one. It is also editable again here, so if it should read
 * as Draft ("back with the merchandiser", the reading `returned` gets on the
 * Order Revisions register) that is a separate decision, not this bug.
 *
 * A REVISION WITH THE MD IS PENDING (client 2026-09-24: "any revision
 * submitted for MD approval must default to Pending"). A revised budget goes
 * back to `submitted`, which read Updated here — so the one budget still
 * waiting on a decision sat under the word for "done", out of sight of the
 * list that opens on Pending. `in_revision` (an OPEN entry on Orders ▸ Order
 * Revisions) is what tells it from a first submit, which stays Updated: the
 * Revision register and Budget Approval already file the same budget under
 * Pending, so this makes the three lists agree rather than adding a meaning.
 */
const budgetWord = (o: BudgetableOrder): QuickWord => {
  const s = statusOf(o);
  /* PENDING · UNDER PROGRESS · APPROVED · DRAFT (user 2026-10-15). Not
     budgeted is the untouched work; a budget with the MD, or sent back for
     rework, is worked on and not approved — Under Progress. A revision with
     the MD used to be forced to Pending and every other saved budget read
     Updated; Approved now holds only what the MD approved. */
  /* A SAVED BUDGET IS UNDER PROGRESS (client 2026-10-30): Draft is only the
     budget nobody has saved yet, and that has no row to list — so the box
     drops the Draft word (QUICK_WORDS_3) rather than count it at zero. */
  if (s === "none") return "pending";
  if (s === "approved") return "approved";
  return "progress";
};
const statusText = (s: QueueStatus) => (s === "none" ? "Not budgeted" : budgetStatusText(s));
/** Not budgeted is the work waiting, so it takes the warning colour. An order
 *  with the approver is `info` here, so it doesn't read as another pending job. */
const statusTone = (s: QueueStatus): StatusTone =>
  s === "none" ? "warning" : s === "submitted" ? "info" : budgetStatusTone(s);

/**
 * THE QUEUE'S FILTERS PANEL — the grouped drawer every Orders child draws
 * (user, 2026-09-23: "implement the Material BOM filter in every Orders
 * child"). Three questions, every facet read off the `BudgetableOrder` the card
 * already carries, so none costs a query: where the budget stands and when the
 * order is due; whose order and what shape it is; and whether it can be valued.
 *
 * STATUS IS THE FACET THE PANEL ALWAYS HAD — counted, in `QUEUE_ORDER` (what
 * needs doing, first), a state with no orders shown and not choosable. The
 * Pending / Updated box at the front of the row stays its OWN state, as on
 * `BomQueue`; it never moves this facet.
 *
 * No Created pair: `listBudgetableOrders` selects no `created_at` for an
 * order, and a facet with nothing to read would only ever match nothing.
 */
const BUDGET_QUEUE_FACETS: FacetGroup<BudgetableOrder>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "status",
        label: "Status",
        all: "All",
        wide: true,
        counted: true,
        options: QUEUE_ORDER.map((s) => ({ value: s, label: statusText(s) })),
        match: (o, v) => statusOf(o) === v,
      },
      { key: "delivery", label: "Delivery Date", all: "Any date", date: (o) => o.delivery_date },
      urgencyFacet((o) => o.delivery_date),
    ],
  },
  {
    title: "Customer & order",
    icon: <Users />,
    facets: [
      { key: "customer", label: "Customer", all: "All customers", wide: true, value: (o) => o.customer_name },
      // An order born of a sample quotation carries its `sq_no`; the ordinary
      // one is booked straight off a customer PO (null). The number itself is
      // never shown — only which of the two it is.
      flagFacet("source", "Booked From", (o) => !!o.sq_no, "Sample quotation", "Customer PO"),
      {
        key: "styles",
        label: "Styles",
        all: "Any",
        options: [
          { value: "single", label: "Single style" },
          { value: "multiple", label: "Multiple styles" },
        ],
        match: (o, v) => (v === "multiple") === o.styles.length > 1,
      },
    ],
  },
  {
    title: "Valuation",
    icon: <ClipboardCheck />,
    facets: [
      // THE CARD'S RED HINT, AS A QUESTION: a budget cannot be approved on an
      // order with no sales value, so "which can't be valued yet?" is the
      // one a merchandiser asks before opening any.
      flagFacet("value", "Sales Value", (o) => o.sales_value != null, "Valued", "No sales value yet"),
      flagFacet("boms", "BOMs", (o) => !o.bom_refusal, "Both saved", "Waiting on a BOM"),
      { key: "currency", label: "Currency", all: "Any", value: (o) => o.currency_code },
    ],
  },
];

export function BudgetQueue({
  orders,
  onOpen,
  canDelete = false,
  canDeleteRow,
  onDelete,
  isPending = false,
}: {
  /** Every confirmed order, as `listBudgetableOrders` returns them. */
  orders: readonly BudgetableOrder[];
  onOpen: (o: BudgetableOrder) => void;
  /** DELETING A BUDGET HAPPENS ON ITS CARD — the Budgets table that used to
   *  carry the action left the page (user 2026-09-20). The caller decides
   *  which budget may go (`canDeleteBudget`); the card list asks to confirm. */
  canDelete?: boolean;
  canDeleteRow?: (o: BudgetableOrder) => boolean;
  onDelete?: (o: BudgetableOrder) => void;
  isPending?: boolean;
}) {
  const [query, setQuery] = useState("");
  /** Ready orders, in work order and then by delivery, soonest first. */
  const ready = useMemo(
    () =>
      orders
        .filter((o) => !o.bom_refusal || o.in_budget)
        .sort(
          (a, b) =>
            QUEUE_ORDER.indexOf(statusOf(a)) - QUEUE_ORDER.indexOf(statusOf(b)) ||
            (a.delivery_date ?? "9999").localeCompare(b.delivery_date ?? "9999"),
        ),
    [orders],
  );
  const waiting = orders.length - ready.length;

  /* THE GROUPED DRAWER (2026-09-23) — it replaced the lone Status <Select>,
     which is now the drawer's first, counted facet. Counts are over the READY
     orders, the same set the old `counts` memo counted. */
  const facets = useFacetFilter(ready, BUDGET_QUEUE_FACETS);
  const facetMatch = facets.matches;

  /* THE PENDING / UPDATED BOX, FABRIC BOM'S OWN (user 2026-09-21: "update and
     pending options displayed to be like fabric bom") — the same component, at
     the front of the search row. A budget has five states, not a BOM's two
     ends, so the two words are read as the question the box asks on the BOM
     queues — is the work still to do, or done:
       Pending = "Not budgeted" (no budget on the order yet — the work waiting)
       Updated = a budget that has left the merchandiser — Submitted, Approved
                 or Rejected
       Draft   = a budget exists and is still being written (user 2026-09-22,
                 the third word on every one of the three queues)
     `budgetWord` above says which, and says why it is a function rather than
     three tests in the filter.
     Its OWN state, as on `BomQueue`: it never moves the Filters panel's Status
     facet, which still reaches Draft / Submitted / Approved / Rejected — so no
     `standDown` and no `onPick` here, unlike Budget Approval's box (user
     2026-09-21: "Pending and Update should not be connected to the filters").
     OPENS ON PENDING (user 2026-09-22), as the BOM queues and Budget Approval
     do — the orders not yet budgeted are the work this screen exists for. */
  /* THE SET THE FIGURES ARE COUNTED OVER — READY orders with the search and
     the Filters panel applied and this box's own word left off, so a figure is
     exactly what clicking that word would show. The orders still waiting on a
     BOM are not cards here and are not counted here either; the summary on the
     right of the bar is what says how many they are. */
  const base = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ready.filter((o) => {
      if (!facetMatch(o)) return false;
      if (!needle) return true;
      return [o.re_no, o.order_code, o.po_no, o.customer_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [ready, query, facetMatch]);

  const quick = useQuickStatus(budgetWord, { countRows: base, words: QUICK_WORDS_3 });
  const quickMatches = quick.matches;

  const filtered = useMemo(() => base.filter(quickMatches), [base, quickMatches]);
  /* CARD VIEW / LIST VIEW (user 2026-10-26, screenshot 100646: "budgeting
     screen kum intha mari venum") — the switch every costing and plan queue
     carries. Until the operator picks, the tab decides as before. */
  const viewMode = useViewMode("order-budgets", quick.value === "updated" ? "list" : "cards");

  const summary = useMemo(() => {
    const open = ready.filter((o) => statusOf(o) === "none").length;
    const head =
      ready.length === 0
        ? "No order is ready to budget yet"
        : open > 0
          ? `${open} order${open === 1 ? "" : "s"} waiting on a budget`
          : "Every ready order has a budget";
    // THE ORDERS THAT ARE NOT CARDS ARE STILL SAID — an order the operator
    // knows exists and cannot find would otherwise read as a broken list.
    return waiting > 0
      ? `${head} · ${waiting} more waiting on their Fabric / Accessories Plan`
      : head;
  }, [ready, waiting]);

  const pg = usePagination(filtered);
  /* EACH WORD ONCE, as on the costing cards: the RE series and the delivery
     year every card on the page shares are left off the card. */
  const shared = useMemo(
    () => ({
      re: sharedPrefix(filtered.map((o) => o.re_no ?? o.order_code)),
      year: sharedValue(filtered.map((o) => o.delivery_date?.slice(0, 4))),
    }),
    [filtered],
  );

  /** Why this card cannot be budgeted / approved yet — said on the card,
   *  before anyone opens it. */
  const warningOf = (o: BudgetableOrder): string | null =>
    o.bom_refusal ?? (o.sales_value == null ? (o.sales_refusal ?? "No sales value yet") : null);

  /**
   * THE COSTING CARD (user 2026-10-26, screenshot 095211: "budgeting screen
   * also … intha card aa costing la irukka card screen mari venum") —
   * `GlowRecordCard`, as the IWO plans draw it: the RE number in its chip, the
   * customer beside its initials, the PO and the budget it is in under it, the
   * three figures with no label row, and the actions as one row of duotone
   * tiles. The state is the tab's, so the card does not repeat it.
   */
  const card = (o: BudgetableOrder) => {
    const s = statusOf(o);
    const reNo = o.re_no ?? o.order_code;
    const code = reNo && shared.re && reNo.startsWith(shared.re) ? reNo.slice(shared.re.length) : reNo;
    const budgetLine = o.in_budget?.code
      ? `${o.in_budget.code}${o.in_budget.in_revision && o.in_budget.status === "submitted" ? " · revision with the MD" : ""}`
      : null;
    const warning = warningOf(o);
    const deletable = !!o.in_budget && (canDeleteRow ? canDeleteRow(o) : true);
    return (
      <GlowRecordCard
        key={o.id}
        code={code ?? "—"}
        title={o.customer_name}
        sub={[o.po_no, budgetLine].filter(Boolean).join(" · ") || "—"}
        start={s === "none" ? "Start budget" : undefined}
        figures={[
          { label: "Order Qty", value: o.qty != null ? fmtNumber(o.qty) : (o.sales_refusal ?? "—") },
          { label: "Cut Qty", value: o.cut_qty != null ? fmtNumber(o.cut_qty) : (o.cut_refusal ?? "—") },
          {
            label: "Delivery",
            value: o.delivery_date ? (shared.year ? fmtDate(o.delivery_date).slice(0, 5) : fmtDate(o.delivery_date)) : "—",
          },
        ]}
        onOpen={() => onOpen(o)}
        footer={
          <div className={cn("mx-3 flex min-h-10 items-center justify-between gap-1 py-1", GLOW_RULE)}>
            <CardAction
              label={s === "none" ? "Start budget" : "Open budget"}
              tone="primary"
              icon={DUO.editRing}
              disabled={isPending}
              onClick={() => onOpen(o)}
            />
            {warning ? (
              <CardAction
                label={warning}
                tone="warning"
                icon={DUO.alert}
                onClick={() => onOpen(o)}
              />
            ) : null}
            {canDelete ? (
              <CardDeleteAction
                label="Delete"
                reason={
                  deletable
                    ? null
                    : !o.in_budget
                      ? "Not budgeted — nothing to delete"
                      : `${statusText(s)} — it cannot be deleted`
                }
                isPending={isPending}
                onConfirm={() => onDelete?.(o)}
              />
            ) : null}
          </div>
        }
      />
    );
  };
  const emptyText =
    waiting > 0
      ? `No order is ready to budget yet — ${waiting} ${waiting === 1 ? "is" : "are"} waiting on a saved Fabric Plan and Accessories Plan.`
      : "No confirmed garment orders yet. A budget is built on an order's saved Fabric Plan and Accessories Plan.";

  return (
    <>
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search RE No, PO or customer…"
        activeCount={facets.activeCount}
        leading={quick.segment}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        right={`${summary} · ${filtered.length} of ${ready.length}`}
        trailing={<ViewToggle value={viewMode.view} onChange={viewMode.setView} />}
      />

      {/* UPDATED IS A TABLE IN THE ORDER ENTRY LISTING'S LAYOUT, CARRYING THIS
          QUEUE'S OWN DETAILS (user, 2026-09-24, screenshot 3045) — the same
          switch as the BOM queues. Since 2026-10-26 the View toggle picks it,
          on any tab. */}
      {viewMode.view === "list" ? (
        <OrderQueueTable<BudgetableOrder>
          rows={filtered}
          heading={(o) => ({ reNo: o.re_no ?? o.order_code, customer: o.customer_name, poNo: o.po_no })}
          /* THIS QUEUE'S OWN CARD, AS COLUMNS — the budget it is in (number and
             state: "Updated" here is every order that HAS a budget, so a
             rejected one and an approved one must not read alike), then the
             card's three figures in the card's order. */
          columns={[
            {
              header: "Budget",
              cell: (o) => (
                <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                  {o.in_budget?.code && <span className="font-mono">{o.in_budget.code}</span>}
                  <StatusPill tone={statusTone(statusOf(o))}>{statusText(statusOf(o))}</StatusPill>
                </span>
              ),
            },
            {
              header: "Order Qty",
              cell: (o) => <FigureCell value={o.qty != null ? fmtNumber(o.qty) : null} refusal={o.sales_refusal} />,
            },
            {
              header: "Cut Qty",
              cell: (o) => <FigureCell value={o.cut_qty != null ? fmtNumber(o.cut_qty) : null} refusal={o.cut_refusal} />,
            },
            {
              header: "Delivery",
              cell: (o) =>
                o.delivery_date ? (
                  <span className="whitespace-nowrap tabular-nums text-xs">
                    {fmtDate(o.delivery_date)}
                    <DaysOut iso={o.delivery_date} />
                  </span>
                ) : (
                  <span className="text-xs">—</span>
                ),
            },
          ]}
          onOpen={onOpen}
          canDelete={canDelete}
          canDeleteRow={canDeleteRow}
          onDelete={onDelete}
          isPending={isPending}
          empty={
            ready.length > 0
              ? "No orders match the search or filters."
              : "No confirmed garment orders yet. A budget is built on an order's saved Fabric Plan and Accessories Plan."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
              {ready.length > 0 ? "No orders match the search or filters." : emptyText}
            </div>
          ) : (
            /* `pb-3`: room for the glow under the last row of cards. */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 pb-3">{pg.paged.map(card)}</div>
          )}
          {pg.pageCount > 1 && (
            <PaginationBar
              page={pg.page}
              pageCount={pg.pageCount}
              total={pg.total}
              pageSize={pg.pageSize}
              onPageChange={pg.setPage}
              onPageSizeChange={pg.setPageSize}
            />
          )}
        </div>
      )}
    </>
  );
}
