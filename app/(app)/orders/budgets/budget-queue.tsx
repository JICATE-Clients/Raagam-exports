"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Check, ClipboardCheck, Clock3, Pencil, Send, Users, X } from "lucide-react";
import { fmtDate, fmtNumber } from "@/lib/format";
import { FilterBar } from "@/components/ui/filter-bar";
import { flagFacet, urgencyFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import { DaysOut, useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
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
 * across (`MobileCardList columns={6}`), the tone badge, and `DaysOut` beside
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
 */
const budgetWord = (o: BudgetableOrder): QuickWord => {
  const s = statusOf(o);
  return s === "none" ? "pending" : s === "draft" ? "draft" : "updated";
};
const statusText = (s: QueueStatus) => (s === "none" ? "Not budgeted" : budgetStatusText(s));
/** Not budgeted is the work waiting, so it takes the warning colour. An order
 *  with the approver is `info` here, so it doesn't read as another pending job. */
const statusTone = (s: QueueStatus): StatusTone =>
  s === "none" ? "warning" : s === "submitted" ? "info" : budgetStatusTone(s);

function statusIcon(s: QueueStatus) {
  switch (s) {
    case "none":
      return <Clock3 className="h-4 w-4" />;
    case "draft":
      return <Pencil className="h-4 w-4" />;
    case "submitted":
      return <Send className="h-4 w-4" />;
    case "approved":
      return <Check className="h-4 w-4" />;
    default:
      return <X className="h-4 w-4" />;
  }
}

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
  const quick = useQuickStatus(budgetWord, {
    /* The figure on each word, over READY orders — the same set the drawer's
       Status facet counts, and the same one `filtered` is drawn from. The
       orders still waiting on a BOM are not cards here and are not counted
       here either; the summary on the right of the bar is what says how many
       they are. */
    rows: ready,
  });
  const quickMatches = quick.matches;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ready.filter((o) => {
      if (!facetMatch(o)) return false;
      if (!quickMatches(o)) return false;
      if (!needle) return true;
      return [o.re_no, o.order_code, o.po_no, o.customer_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [ready, query, quickMatches, facetMatch]);

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
      ? `${head} · ${waiting} more waiting on their Fabric / Material BOM`
      : head;
  }, [ready, waiting]);

  const stats = (o: BudgetableOrder): CardStat[] => [
    {
      /* NO UNIT AND NO `lead` — the BOM cards' shape. Six cards across leave
         each figure ~70px, and "5,000 PCS" at the lead size was cut to
         "5,00…" (screenshot 2964). The unit is on the budget's own header. */
      label: "Order Qty",
      value: o.qty != null ? fmtNumber(o.qty) : (o.sales_refusal ?? "—"),
    },
    {
      // Pieces MADE (order + excess + rejection + approval), what CMT and the
      // garment processes are priced on.
      label: "Cut Qty",
      value: o.cut_qty != null ? fmtNumber(o.cut_qty) : (o.cut_refusal ?? "—"),
    },
    {
      label: "Delivery",
      value: o.delivery_date ? (
        <>
          {fmtDate(o.delivery_date)}
          <DaysOut iso={o.delivery_date} />
        </>
      ) : (
        "—"
      ),
    },
  ];

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
      />

      <MobileCardList<BudgetableOrder>
        columns={6}
        rows={filtered}
        getKey={(o) => o.id}
        title={(o) => <span className="font-mono">{o.re_no ?? o.order_code ?? "—"}</span>}
        subtitle={(o) => (
          <Truncated>
            {o.customer_name ?? "—"}
            {o.po_no ? <span className="font-mono"> · {o.po_no}</span> : null}
          </Truncated>
        )}
        pill={(o) => <StatusPill tone={statusTone(statusOf(o))}>{statusText(statusOf(o))}</StatusPill>}
        stats={stats}
        /* THE BUDGET IT IS IN, by its number, or why it cannot be valued yet.
           A budget cannot be approved on an order with no sales value, so that
           sentence belongs on the card before anyone opens it. */
        hint={(o) =>
          o.bom_refusal ? (
            <span className="text-danger">{o.bom_refusal}</span>
          ) : o.sales_value == null ? (
            <span className="text-danger">{o.sales_refusal ?? "No sales value yet"}</span>
          ) : o.in_budget?.code ? (
            <span className="text-muted-foreground">Budget {o.in_budget.code}</span>
          ) : null
        }
        tone={(o) => statusTone(statusOf(o))}
        badge={(o) => ({ tone: statusTone(statusOf(o)), icon: statusIcon(statusOf(o)) })}
        onEdit={onOpen}
        canDelete={canDelete}
        canDeleteRow={canDeleteRow}
        onDelete={onDelete}
        isPending={isPending}
        empty={
          waiting > 0
            ? `No order is ready to budget yet — ${waiting} ${waiting === 1 ? "is" : "are"} waiting on a saved Fabric BOM and Material BOM.`
            : "No confirmed garment orders yet. A budget is built on an order's saved Fabric BOM and Material BOM."
        }
      />
    </>
  );
}
