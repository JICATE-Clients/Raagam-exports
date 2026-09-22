"use client";

import { useMemo, useState } from "react";
import { Check, Clock3, Pencil, Send, X } from "lucide-react";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import { DaysOut, StatusSegment } from "@/components/orders/bom-queue";
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
  const [statusFilter, setStatusFilter] = useState<"" | QueueStatus>("");
  /* THE PENDING / UPDATED BOX, FABRIC BOM'S OWN (user 2026-09-21: "update and
     pending options displayed to be like fabric bom") — the same component, at
     the front of the search row. A budget has five states, not a BOM's two
     ends, so the two words are read as the question the box asks on the BOM
     queues — is the work still to do, or done:
       Pending = "Not budgeted" (no budget on the order yet — the work waiting)
       Updated = a budget exists, whatever its approval state
       Draft   = a budget exists and is still being written (user 2026-09-22,
                 the third word on every one of the three queues)
     Its OWN state, as on `BomQueue`: it never moves the Filters panel's Status
     facet, which still reaches Draft / Submitted / Approved / Rejected.
     OPENS ON PENDING (user 2026-09-22), as the BOM queues and Budget Approval
     do — the orders not yet budgeted are the work this screen exists for. */
  const [quickFilter, setQuickFilter] = useState<"" | "pending" | "updated" | "draft">("pending");

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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ready.filter((o) => {
      if (statusFilter && statusOf(o) !== statusFilter) return false;
      if (quickFilter === "pending" && statusOf(o) !== "none") return false;
      if (quickFilter === "updated" && statusOf(o) === "none") return false;
      if (quickFilter === "draft" && statusOf(o) !== "draft") return false;
      if (!needle) return true;
      return [o.re_no, o.order_code, o.po_no, o.customer_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [ready, query, statusFilter, quickFilter]);

  /** Counted per state, in work order. A state with no orders is shown and not
   *  choosable, `BomQueue`'s rule, so the options never reshuffle. */
  const counts = useMemo(
    () => QUEUE_ORDER.map((status) => ({ status, count: ready.filter((o) => statusOf(o) === status).length })),
    [ready],
  );

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
      label: "SQ Qty",
      value: o.sq_qty != null ? fmtNumber(o.sq_qty) : (o.sq_refusal ?? "—"),
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
        activeCount={statusFilter ? 1 : 0}
        leading={<StatusSegment value={quickFilter} onChange={setQuickFilter} draft />}
        onReset={statusFilter ? () => setStatusFilter("") : undefined}
        right={`${summary} · ${filtered.length} of ${ready.length}`}
      >
        <div>
          <Label htmlFor="budget-queue-status">Status</Label>
          <Select
            id="budget-queue-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | QueueStatus)}
          >
            <option value="">All ({ready.length})</option>
            {counts.map((c) => (
              <option key={c.status} value={c.status} disabled={c.count === 0 && c.status !== statusFilter}>
                {statusText(c.status)} ({c.count})
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

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
