"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { completeOrder } from "@/lib/orders/completions/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { RecordPicker } from "@/components/masters/record-picker";
import type {
  CompletionRow,
  OrderOption,
  BuyerOption,
} from "@/lib/orders/completions/service";

interface Props {
  completions: CompletionRow[];
  orders: OrderOption[];
  buyers: BuyerOption[];
}

/**
 * THE ENTRY IS THE TABLE'S FIRST ROW — CANCELLATION'S SHAPE, ASKED FOR HERE BY
 * NAME (client 2026-09-22: "same this changes in completion"). Everything
 * below is `cancellations/cancellations-table.tsx` with the completion
 * action, its date column and its labels; that file carries the history
 * (Sheet → first row, the width table, the no-scrollbar arithmetic) and this
 * one deliberately does not repeat it. Change the two together.
 *
 * ONE ROW, NOT A GRID. A completion is written one at a time — `completeOrder`
 * flips the order to Completed and there is nothing to batch — so this is a
 * single entry row that clears itself after each save, not a `ChildGrid` of
 * pending lines. The saved rows beneath it are read-only, as they were.
 *
 * `useUnsavedGuard(dirty || isPending)`: the auto-reload guard, since the Sheet
 * that used to register itself is gone (AGENTS.md, "Auto-reload guard").
 *
 * WIDTHS — NO SIDEWAYS SCROLLBAR (client 2026-09-22: "compact aa venum, scroll
 * bar irukka koodathu"). The first cut carried the Sheet's widths across
 * (range · party · party · term · code · name = 1120px of boxes) and the row
 * ran past the pane behind `DataTable`'s `overflow-x-auto`. The pane this
 * table gets is ~1250px (a 1536px viewport less the sidebar and the page
 * gutters); against it:
 *   nine cells x `dense` padding (px-2, 16px)                         144
 *   row actions column, `w-32`                                        128
 *   Created Date + Created User (`withCreatedColumns`, text)        ~170
 *   the six boxes: Completion No num 72 · RE No code 144 · Customer code 144
 *                  · Order No code 144 · Date code 144 · Remarks code 144   792
 *                                                                   ≈ 1234
 * so the row fits with ~16px to spare. Every step is one of `lib/ui/sizes.ts`'s
 * seven; Customer and Remarks are the two that gave the most (200 → 144 and
 * 288 → 144), and both are the kind of value that truncates and reveals on
 * hover — a picker, and a phrase. Completion No holds "(auto)" and nothing else,
 * so `num`. Widen any of these and the scrollbar is back before the widening
 * is visible.
 */
const ENTRY_ID = "__entry__";
const isEntry = (r: CompletionRow) => r.id === ENTRY_ID;

export function CompletionsTable({ completions, orders, buyers }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [orderId, setOrderId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState("");
  // The FACTORY's today, not `toISOString()`'s UTC day — which read
  // yesterday for the first 5½ hours of every IST day (screenshot 2965).
  const [completionDate, setCompletionDate] = useState(() => today());
  const [remarks, setRemarks] = useState("");

  const dirty = !!orderId || !!customerId || !!orderNo || !!remarks;
  useUnsavedGuard(dirty || isPending);

  // RE No picker items: {id, code: order_number, name: buyer_name}.
  const orderItems = useMemo(
    () =>
      orders.map((o) => ({
        id: o.id,
        code: o.order_number,
        name: o.buyer_name ?? "(no buyer)",
      })),
    [orders],
  );
  const buyerItems = useMemo(
    () => buyers.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    [buyers],
  );

  /* "New Completion" from the sidebar / command palette lands on the entry
     row's first typed field rather than opening anything — there is nothing
     to open. `useCreateIntent` reads the `?new=` param exactly as it did for
     the Sheet. */
  useCreateIntent(() => {
    const first = document.getElementById("gcm-order") as HTMLElement | null;
    first?.focus();
  });

  function reset() {
    setOrderId(null);
    setCustomerId(null);
    setOrderNo("");
    setRemarks("");
    setCompletionDate(today());
  }

  // Picking an RE No auto-loads the order's buyer as the Customer.
  function onSelectOrder(id: string | null) {
    setOrderId(id);
    if (id) {
      const o = orders.find((x) => x.id === id);
      if (o?.buyer_id) setCustomerId(o.buyer_id);
    }
  }

  function handleSubmit() {
    if (!orderId) {
      toastError("Select the RE No");
      return;
    }
    startTransition(async () => {
      const result = await completeOrder({
        order_id: orderId,
        customer_id: customerId,
        order_no: orderNo || null,
        completion_date: completionDate,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Order completed");
        reset();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  /* THE SAVED ROWS' CELLS — unchanged from the server-rendered table this
     replaces; only the entry row is new. */
  const columns: Column<CompletionRow>[] = [
    {
      header: "Completion No",
      cell: (row) =>
        isEntry(row) ? (
          <Field w="num">
            <Input id="gcm-no" value="(auto)" readOnly aria-label="Completion No" />
          </Field>
        ) : (
          <span className="font-mono text-xs font-medium text-primary">{row.code ?? "—"}</span>
        ),
    },
    {
      header: "RE No",
      cell: (row) =>
        isEntry(row) ? (
          /* `compact` — NO LABEL OF ITS OWN INSIDE THE CELL (client
             2026-09-22: "RE No * / Customer — remove this 2 heading in table
             inside"). The column header is the visible name; the picker's
             `label` stays as its accessible name and its "— Select … —"
             placeholder. The `*` goes with the label; `required` still holds
             the cursor and the Save is still gated on the value.
             `identity="code"`: on an RE No the CODE is the identity and the
             name is the customer, so without it five orders for one buyer all
             read alike. */
          <Field w="code">
            <RecordPicker
              id="gcm-order"
              label="RE No"
              compact
              identity="code"
              items={orderItems}
              value={orderId}
              onChange={onSelectOrder}
              required
            />
          </Field>
        ) : (
          <span className="font-mono text-xs">{row.sales_orders?.order_number ?? "—"}</span>
        ),
    },
    {
      header: "Customer",
      cell: (row) =>
        isEntry(row) ? (
          <Field w="code">
            <RecordPicker
              label="Customer"
              compact
              items={buyerItems}
              value={customerId}
              onChange={setCustomerId}
            />
          </Field>
        ) : (
          <span className="text-sm">{row.sales_orders?.buyers?.name ?? "—"}</span>
        ),
    },
    {
      header: "Order No",
      cell: (row) =>
        isEntry(row) ? (
          <Field w="code">
            <Input
              id="gcm-orderno"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              aria-label="Order No"
            />
          </Field>
        ) : (
          <span className="text-sm">{row.order_no ?? "—"}</span>
        ),
    },
    {
      header: "Date",
      /* LEFT, LIKE EVERY OTHER COLUMN (client 2026-09-22: "date heading
         align — do this correct, input field"). The Sheet-era table
         right-aligned this column, which was fine for a column of values; with
         an input box in the first row the header sat over the box's right
         edge and the box hung off the left of it. Header, box and the dates
         beneath now share one left edge. */
      cell: (row) =>
        isEntry(row) ? (
          /* `required` on the Field, not a `*` typed anywhere — the prop holds
             the cursor on a blank box (AGENTS.md, "Mandatory fields"). */
          <Field required w="code">
            <Input
              id="gcm-date"
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              required
              aria-label="Date"
            />
          </Field>
        ) : (
          <span className="tabular-nums text-xs text-muted-foreground">
            {fmtDate(row.completion_date)}
          </span>
        ),
    },
    {
      header: "Remarks",
      cell: (row) =>
        isEntry(row) ? (
          /* An `Input`, not the Sheet's `Textarea`: a table row is one line
             tall, and a remark on a completion is a phrase. */
          <Field w="code">
            <Input
              id="gcm-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              aria-label="Remarks"
            />
          </Field>
        ) : (
          // `truncate` + a `title` is an ellipsis with a tooltip the keyboard
          // and touch can never reach. <Truncated> writes the clamp itself,
          // measures the box, and reveals on hover OR press-and-hold — and only
          // when something is actually hidden (AGENTS.md, "Truncated values").
          <Truncated
            text={row.remarks ?? "—"}
            className="block max-w-[16rem] text-sm text-muted-foreground"
          />
        ),
    },
    /* The entry row's action is its Save; a saved row is view only — this list
       has no detail route to edit into, and no delete action exists for the
       record. The eye still earns its place: it answers "what is in this row?"
       without opening anything. */
    rowActionsColumn(
      (row) =>
        isEntry(row) ? (
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !orderId}>
            {isPending ? "Completing…" : "Complete order"}
          </Button>
        ) : (
          <RowActions label={row.code} />
        ),
      /* `w-32`, not the default `w-40`: the widest thing here is the entry
         row's "Complete order" (~110px), and the 32px were part of the
         scrollbar — see the width table above. */
      "w-32",
    ),
  ];

  /* `withCreatedColumns` reads the SAVED rows for `hasCreatedInfo`, so the
     entry sentinel — which carries no `created_at` — cannot switch the two
     columns off; its own cells there are blanked below rather than showing
     the dash a saved row without a creator shows. */
  const withCreated = withCreatedColumns(columns, completions).map((c) =>
    c.header.startsWith("Created")
      ? { ...c, cell: (r: CompletionRow) => (isEntry(r) ? null : c.cell(r)) }
      : c,
  );

  /* A sentinel row, not state: it carries nothing but its id, and every cell
     above reads the entry's values from this component's own state. */
  const rows: CompletionRow[] = [{ id: ENTRY_ID } as CompletionRow, ...completions];

  return (
    <DataTable
      columns={withCreated}
      rows={rows}
      getKey={(row) => row.id}
      /* `dense`: px-2 cells, the padding half of the width table above. */
      dense
      /* The entry row reads as the place to type, not as a record: tinted,
         and its cells vertically centred on the boxes. */
      rowClassName={(row) => (isEntry(row) ? "bg-primary/5 align-middle" : undefined)}
      empty="No completions yet."
    />
  );
}
