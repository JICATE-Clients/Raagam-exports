"use client";

/**
 * Orders ▸ Budgeting — step 7 of the client's order flow (0428).
 *
 * A budget covers a GROUP of garment orders, costs them from their Fabric and
 * Material BOMs, and is submitted for approval (step 8, `/orders/budget-approval`).
 *
 * ## SUBMIT IS IN THE HEADER, NEVER THE FOOTER
 *
 * `submitTargetOf` takes the footer's LAST non-disabled button, so a workflow
 * button placed after Save means Enter off the last field submits the document
 * for approval instead of saving it. doc/orders-six-step.md records this about
 * the Approve bar and it is the same hazard one step earlier.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, ListChecks, Receipt, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RecordPicker } from "@/components/masters/record-picker";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { RowActions } from "@/components/ui/row-actions";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  BUDGET_SOURCES,
  BUDGET_SOURCE_LABELS,
  budgetTotals,
  isRefusal,
  lineAmount,
  PULLED_SOURCES,
  type BudgetSource,
} from "@/lib/orders/budget/totals";
import {
  budgetStatusText,
  budgetStatusTone,
  canTransition,
  type BudgetStatus,
  type OrderBudget,
} from "@/lib/orders/budget/types";
import type { BudgetFormData } from "@/lib/orders/budget/service";
import {
  createOrderBudget,
  deleteOrderBudget,
  loadCostLines,
  submitBudget,
  updateOrderBudget,
} from "@/lib/orders/budget/actions";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type OrderRow = { key: string; garment_order_id: string | null };

type CostRow = {
  key: string;
  source: string;
  garment_order_id: string | null;
  item_id: string | null;
  description: string;
  qty: string;
  uom_id: string | null;
  rate: string;
};

type Form = {
  budget_date: string;
  description: string;
  currency_code: string;
  exchange_rate: string;
  remark: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const BLANK = (): Form => ({
  budget_date: today(),
  description: "",
  currency_code: "",
  exchange_rate: "1",
  remark: "",
});

const blankCost = (key: string, source: BudgetSource = "expense"): CostRow => ({
  key,
  source,
  garment_order_id: null,
  item_id: null,
  description: "",
  // 1 IS PRE-FILLED, VISIBLY, for a typed line. `lineAmount` refuses a blank
  // quantity and says "use 1 for a lump sum"; putting the 1 in the box is that
  // sentence made unnecessary rather than a silent default the operator cannot
  // see. A pulled line overwrites it with the BOM's real figure.
  qty: "1",
  uom_id: null,
  rate: "",
});

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function BudgetScreen({
  budgets,
  data,
  perms,
}: {
  budgets: OrderBudget[];
  data: BudgetFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [status, setStatus] = useState<BudgetStatus>("draft");
  const [form, setForm] = useState<Form>(BLANK);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");

  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutOrders = (fn: (xs: OrderRow[]) => OrderRow[]) => {
    setOrders(fn);
    setDirty(true);
  };
  const mutCosts = (fn: (xs: CostRow[]) => CostRow[]) => {
    setCosts(fn);
    setDirty(true);
  };
  const setCost = (key: string, patch: Partial<CostRow>) =>
    mutCosts((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /** A budget stops being the operator's once it is submitted. Mirrors
   *  `assertEditable` in the actions — the screen closes the door and the server
   *  is what actually holds it. */
  const editable = status === "draft" || status === "rejected";

  const orderById = useMemo(
    () => new Map(data.orders.map((o) => [o.id, o] as const)),
    [data.orders],
  );

  // ---- opening -------------------------------------------------------------

  function openNew() {
    setEditId(null);
    setStatus("draft");
    setForm(BLANK());
    setOrders([{ key: newKey(), garment_order_id: null }]);
    setCosts([]);
    setDirty(false);
    setMode("edit");
  }

  function openExisting(id: string) {
    const b = budgets.find((x) => x.id === id);
    if (!b) return;
    setEditId(b.id);
    setStatus(b.status);
    setForm({
      budget_date: b.budget_date,
      description: b.description ?? "",
      currency_code: b.currency_code ?? "",
      exchange_rate: String(b.exchange_rate ?? 1),
      remark: b.remark ?? "",
    });
    setOrders(
      (b.orders ?? []).map((o) => ({ key: newKey(), garment_order_id: o.garment_order_id })),
    );
    setCosts(
      (b.lines ?? []).map((l) => ({
        key: newKey(),
        source: l.source,
        garment_order_id: l.garment_order_id,
        item_id: l.item_id,
        description: l.description ?? "",
        qty: l.qty == null ? "" : String(l.qty),
        uom_id: l.uom_id,
        rate: l.rate == null ? "" : String(l.rate),
      })),
    );
    setDirty(false);
    setMode("edit");
  }

  // ---- pulling the BOM costs ----------------------------------------------

  /**
   * ADDS the BOM lines that are not already here. Never replaces.
   *
   * Same call the Fabric BOM's seed makes and for the same reason: the button is
   * most useful on a half-built budget, and wholesale replacement would throw
   * away typed rates to re-add rows the operator had already accepted. "Already
   * here" is (source, order, item) — the tuple that identifies a pulled cost.
   */
  function pullFromBoms() {
    const ids = orders.map((o) => o.garment_order_id).filter(Boolean) as string[];
    start(async () => {
      const res = await loadCostLines(ids);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const key = (l: { source: string; garment_order_id: string | null; item_id: string | null }) =>
        `${l.source}|${l.garment_order_id ?? ""}|${l.item_id ?? ""}`;
      const held = new Set(costs.filter((c) => PULLED_SOURCES.has(c.source as BudgetSource)).map(key));
      const fresh = res.lines.filter((l) => !held.has(key(l)));

      if (fresh.length === 0) {
        success("Every BOM line for these orders is already on the budget");
        return;
      }
      mutCosts((xs) => [
        ...xs,
        ...fresh.map((l) => ({
          key: newKey(),
          source: l.source as string,
          garment_order_id: l.garment_order_id,
          item_id: l.item_id,
          description: l.description,
          qty: String(l.qty),
          uom_id: l.uom_id,
          rate: l.rate == null ? "" : String(l.rate),
        })),
      ]);
      success(
        res.skipped > 0
          ? // THE SKIPPED COUNT IS SAID OUT LOUD. A refused BOM figure dropped
            // in silence makes a budget look complete while a real cost is
            // missing from it — and this document gets approved.
            `${fresh.length} cost lines pulled · ${res.skipped} BOM figures skipped as unanswered`
          : `${fresh.length} cost line${fresh.length === 1 ? "" : "s"} pulled from the BOMs`,
      );
    });
  }

  // ---- the grids -----------------------------------------------------------

  const orderColumns: ChildGridColumn<OrderRow>[] = [
    {
      header: "Garment order",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Garment order"
          compact
          required
          disabled={!editable}
          items={data.orders.map((o) => ({
            id: o.id,
            code: o.sc_no ?? o.order_code,
            name: [o.sc_no ?? o.order_code, o.po_no, o.customer_name].filter(Boolean).join(" · "),
            inactive: false,
          }))}
          // PICK-ONCE. The same order twice would double its costs and its sales
          // value, and the totals would look internally consistent.
          usedIds={orders.filter((x) => x.key !== r.key).map((x) => x.garment_order_id ?? "")}
          value={r.garment_order_id}
          onChange={(id) =>
            mutOrders((xs) => xs.map((x) => (x.key === r.key ? { ...x, garment_order_id: id } : x)))
          }
        />
      ),
    },
    {
      header: "Customer",
      width: "12rem",
      cell: (r) => (
        <Truncated>
          {(r.garment_order_id && orderById.get(r.garment_order_id)?.customer_name) || "—"}
        </Truncated>
      ),
    },
    {
      header: "Delivery",
      width: "8rem",
      cell: (r) => {
        const d = r.garment_order_id ? orderById.get(r.garment_order_id)?.delivery_date : null;
        return <span className="tabular-nums text-sm">{d ? fmtDate(d) : "—"}</span>;
      },
    },
    {
      header: "Order value",
      align: "right",
      width: "12rem",
      cell: (r) => {
        const o = r.garment_order_id ? orderById.get(r.garment_order_id) : null;
        if (!o) return <span className="text-muted-foreground">—</span>;
        // THE REFUSAL IS PRINTED. "No value" and "not valued yet" are the same
        // empty cell otherwise, and only one of them is something to act on.
        return o.sales_value == null ? (
          <span className="text-xs text-danger">{o.sales_refusal ?? "no value"}</span>
        ) : (
          <span className="tabular-nums text-sm">{fmtNumber(o.sales_value)}</span>
        );
      },
    },
    {
      header: "Already budgeted",
      width: "11rem",
      cell: (r) => {
        const b = r.garment_order_id ? orderById.get(r.garment_order_id)?.in_budget : null;
        if (!b || b.id === editId) return <span className="text-muted-foreground">—</span>;
        // ADVISORY, never a block. Two DRAFT budgets over one order is someone
        // comparing two groupings; only APPROVAL is refused (0428), and it is
        // refused by the server with the other budget named.
        return (
          <span className={b.status === "approved" ? "text-xs text-danger" : "text-xs text-warning"}>
            {b.code ?? "another budget"} ({budgetStatusText(b.status)})
          </span>
        );
      },
    },
  ];

  const costColumns: ChildGridColumn<CostRow>[] = [
    {
      header: "For",
      width: "10rem",
      required: true,
      cell: (r) => (
        <Select
          className="h-8"
          required
          disabled={!editable}
          value={r.source}
          onChange={(e) => setCost(r.key, { source: e.target.value })}
        >
          {BUDGET_SOURCES.map((sname) => (
            <option key={sname} value={sname}>
              {BUDGET_SOURCE_LABELS[sname]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Order",
      width: "12rem",
      cell: (r) => (
        <RecordPicker
          label="Order"
          compact
          disabled={!editable}
          items={orders
            .filter((o) => o.garment_order_id)
            .map((o) => {
              const oo = orderById.get(o.garment_order_id as string);
              return {
                id: o.garment_order_id as string,
                code: oo?.sc_no ?? oo?.order_code ?? null,
                name: oo?.sc_no ?? oo?.order_code ?? "(order)",
                inactive: false,
              };
            })}
          value={r.garment_order_id}
          // BLANK MEANS THE WHOLE GROUP — right for a shared overhead, wrong for
          // fabric. Said in the box rather than left as an empty cell.
          placeholder="Whole group"
          onChange={(id) => setCost(r.key, { garment_order_id: id })}
        />
      ),
    },
    {
      header: "Item",
      cell: (r) => (
        <RecordPicker
          label="Item"
          compact
          disabled={!editable}
          items={data.items}
          value={r.item_id}
          onChange={(id) => setCost(r.key, { item_id: id })}
        />
      ),
    },
    {
      header: "Description",
      cell: (r) => (
        <Input
          className="h-8"
          uppercase
          readOnly={!editable}
          value={r.description}
          onChange={(e) => setCost(r.key, { description: e.target.value })}
        />
      ),
    },
    {
      header: "Qty",
      align: "right",
      width: "8rem",
      required: true,
      cell: (r) => (
        <Input
          className="h-8 text-right"
          required
          readOnly={!editable}
          inputMode="decimal"
          value={r.qty}
          onChange={(e) => setCost(r.key, { qty: e.target.value })}
        />
      ),
    },
    {
      header: "Unit",
      width: "7rem",
      cell: (r) => (
        <RecordPicker
          label="Unit"
          compact
          disabled={!editable}
          items={data.uoms}
          value={r.uom_id}
          onChange={(id) => setCost(r.key, { uom_id: id })}
        />
      ),
    },
    {
      header: "Rate",
      align: "right",
      width: "8rem",
      required: true,
      cell: (r) => (
        <Input
          className="h-8 text-right"
          required
          readOnly={!editable}
          inputMode="decimal"
          value={r.rate}
          onChange={(e) => setCost(r.key, { rate: e.target.value })}
        />
      ),
    },
    {
      header: "Amount",
      align: "right",
      width: "10rem",
      total: {
        kind: "sum",
        of: (r) => {
          const a = lineAmount({ source: r.source, qty: numOrNull(r.qty), rate: numOrNull(r.rate) });
          // A REFUSED LINE CONTRIBUTES 0 TO THE BAND AND IS COUNTED ELSEWHERE.
          // The band is a running total of what is on screen; the authoritative
          // count of unanswered lines is in the Summary section, where it can
          // carry a sentence.
          return isRefusal(a) ? 0 : a;
        },
      },
      cell: (r) => {
        const a = lineAmount({ source: r.source, qty: numOrNull(r.qty), rate: numOrNull(r.rate) });
        return isRefusal(a) ? (
          <span className="text-xs text-danger">{a.refused}</span>
        ) : (
          <span className="tabular-nums text-sm">{fmtNumber(a)}</span>
        );
      },
    },
  ];

  // ---- the totals ----------------------------------------------------------

  const totals = useMemo(
    () =>
      budgetTotals(
        costs.map((c) => ({ source: c.source, qty: numOrNull(c.qty), rate: numOrNull(c.rate) })),
        orders
          .filter((o) => o.garment_order_id)
          .map((o) => {
            const oo = orderById.get(o.garment_order_id as string);
            return {
              label: oo?.sc_no ?? oo?.order_code ?? "This order",
              sales_value: oo?.sales_value ?? null,
              refusal: oo?.sales_refusal ?? null,
            };
          }),
      ),
    [costs, orders, orderById],
  );

  // ---- validity ------------------------------------------------------------

  const pickedOrders = orders.filter((o) => o.garment_order_id);

  const validity = sectionValidity({
    sections: [{ key: "budget" }, { key: "orders" }, { key: "costs" }, { key: "summary" }],
    values: form,
    fields: [
      { section: "budget", id: "bg-date", label: "Date", required: true, empty: (f) => !f.budget_date },
    ],
    extra: [
      ...(pickedOrders.length === 0
        ? [
            {
              section: "orders",
              label: "Orders",
              message: "Add at least one garment order.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(totals.unpriced.length > 0
        ? [
            {
              section: "costs",
              label: "Cost lines",
              // The ENGINE'S sentence for the first one, and the count. A list of
              // eight identical messages is noise; one plus "and 7 more" is not.
              message:
                totals.unpriced.length === 1
                  ? totals.unpriced[0].reason
                  : `${totals.unpriced[0].reason} — and ${totals.unpriced.length - 1} more unpriced ${totals.unpriced.length === 2 ? "line" : "lines"}`,
              kind: "custom" as const,
            },
          ]
        : []),
      ...(numOrNull(form.exchange_rate) == null || (numOrNull(form.exchange_rate) as number) <= 0
        ? [
            {
              section: "budget",
              label: "Exchange rate",
              message: "Exchange rate must be more than 0",
              kind: "custom" as const,
            },
          ]
        : []),
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- sections ------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "budget",
      label: "Budget",
      icon: Coins,
      done: !!form.budget_date,
      content: (
        <SectionBody title="Budget" hint="What this budget is, and the currency it is stated in.">
          <FieldGrid>
            <Field label="Date" required size="sm" htmlFor="bg-date">
              <Input
                id="bg-date"
                type="date"
                readOnly={!editable}
                value={form.budget_date}
                onChange={(e) => set({ budget_date: e.target.value })}
              />
            </Field>
            <Field label="Group" size="sm" htmlFor="bg-desc">
              <Input
                id="bg-desc"
                uppercase
                readOnly={!editable}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            <Field label="Currency" size="sm" htmlFor="bg-cur">
              <Select
                id="bg-cur"
                disabled={!editable}
                value={form.currency_code}
                onChange={(e) => set({ currency_code: e.target.value })}
              >
                <option value="">—</option>
                {data.currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Exchange rate" size="sm" htmlFor="bg-rate">
              <Input
                id="bg-rate"
                inputMode="decimal"
                readOnly={!editable}
                value={form.exchange_rate}
                onChange={(e) => set({ exchange_rate: e.target.value })}
              />
            </Field>
            <Field label="Remark" size="full" htmlFor="bg-remark">
              <Textarea
                id="bg-remark"
                rows={2}
                readOnly={!editable}
                value={form.remark}
                onChange={(e) => set({ remark: e.target.value })}
              />
            </Field>
          </FieldGrid>

          {!editable && (
            <p className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {status === "submitted"
                ? "This budget is with the approver. It cannot be changed until it comes back."
                : "An approved budget cannot be changed. Raise a new one to revise it."}
            </p>
          )}
        </SectionBody>
      ),
    },
    {
      key: "orders",
      label: "Orders",
      icon: ListChecks,
      done: pickedOrders.length > 0,
      content: (
        <SectionBody
          title="Orders"
          hint="The garment orders this budget covers. Their costs come from their own BOMs."
        >
          <ChildGrid<OrderRow>
            columns={orderColumns}
            rows={orders}
            seedRow
            hideAdd={!editable}
            lockExisting={!editable}
            onAdd={() => mutOrders((xs) => [...xs, { key: newKey(), garment_order_id: null }])}
            onRemove={(r) => mutOrders((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add order"
          />
        </SectionBody>
      ),
    },
    {
      key: "costs",
      label: "Costs",
      icon: Receipt,
      done: costs.length > 0,
      content: (
        <SectionBody
          title="Costs"
          hint="Fabric and material are pulled from the BOMs. Processing, CMT and other lines are typed."
        >
          {editable && (
            <div className="mb-3 flex items-center justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={pullFromBoms}
                disabled={pickedOrders.length === 0 || isPending}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Pull costs from the BOMs
              </Button>
            </div>
          )}
          <ChildGrid<CostRow>
            columns={costColumns}
            rows={costs}
            forceCards
            hideAdd={!editable}
            lockExisting={!editable}
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {costColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() => mutCosts((xs) => [...xs, blankCost(newKey())])}
            onRemove={(r) => mutCosts((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add cost line"
          />
        </SectionBody>
      ),
    },
    {
      key: "summary",
      label: "Summary",
      icon: Coins,
      done: !isRefusal(totals.profit),
      content: (
        <SectionBody title="Summary" hint="Sales against cost. Recomputed as you type.">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Figure label="Sales value" value={totals.sales} />
            <Figure label="Total cost" value={totals.cost} />
            <Figure label="Other income" value={totals.income} />
            <Figure label="Profit / loss" value={totals.profit} strong />
            <Figure label="Margin %" value={totals.profitPct} suffix="%" />
          </dl>

          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
            {(Object.keys(BUDGET_SOURCE_LABELS) as BudgetSource[])
              .filter((k) => totals.costBySource[k] !== 0)
              .map((k) => (
                <div key={k} className="flex justify-between gap-4">
                  <span>{BUDGET_SOURCE_LABELS[k]}</span>
                  <span className="tabular-nums">{fmtNumber(totals.costBySource[k])}</span>
                </div>
              ))}
          </div>

          {totals.unpriced.length > 0 && (
            // NEVER SILENTLY EXCLUDED. A cost total that quietly ignored a
            // half-typed line is smaller, plausible, and about to be approved.
            <p className="mt-4 text-xs text-danger">
              {totals.unpriced.length} cost{" "}
              {totals.unpriced.length === 1 ? "line is" : "lines are"} unpriced and excluded from
              these figures.
            </p>
          )}
        </SectionBody>
      ),
    },
  ];

  // ---- saving --------------------------------------------------------------

  function payloadOf(): Parameters<typeof createOrderBudget>[0] {
    return {
      budget_date: form.budget_date,
      description: form.description || null,
      currency_code: form.currency_code || null,
      exchange_rate: numOrNull(form.exchange_rate) ?? 1,
      remark: form.remark || null,
      orders: pickedOrders.map((o, i) => {
        const oo = orderById.get(o.garment_order_id as string);
        return {
          sno: i + 1,
          garment_order_id: o.garment_order_id as string,
          // THE SNAPSHOT, taken at save. 0428: an approved budget must keep
          // meaning what it meant.
          sales_value: oo?.sales_value ?? null,
          sales_refusal: oo?.sales_refusal ?? null,
        };
      }),
      lines: costs.map((c, i) => ({
        sno: i + 1,
        source: c.source as BudgetSource,
        garment_order_id: c.garment_order_id,
        item_id: c.item_id,
        description: c.description || null,
        qty: numOrNull(c.qty),
        uom_id: c.uom_id,
        rate: numOrNull(c.rate),
        notes: null,
      })),
    };
  }

  function submit() {
    start(async () => {
      const res = editId
        ? await updateOrderBudget(editId, payloadOf())
        : await createOrderBudget(payloadOf());
      if (res.ok) {
        success(editId ? "Budget updated" : "Budget created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  /** Save, then send to the approver — never one without the other. Submitting a
   *  budget whose latest edits are only in the browser is how an approver ends up
   *  approving a document nobody can reproduce. */
  function saveAndSubmit() {
    start(async () => {
      const res = editId
        ? await updateOrderBudget(editId, payloadOf())
        : await createOrderBudget(payloadOf());
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const sent = await submitBudget(res.id as string);
      if (!sent.ok) {
        toastError(sent.error);
        return;
      }
      success("Budget sent for approval");
      setDirty(false);
      setMode("list");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteOrderBudget(id);
      if (res.ok) {
        success("Budget deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list ------------------------------------------------------------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return budgets;
    return budgets.filter((b) =>
      [b.code, b.description].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [budgets, search]);

  const columns: Column<OrderBudget>[] = [
    {
      header: "Budget",
      cell: (b) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => openExisting(b.id)}
        >
          {b.code ?? b.id.slice(0, 8)}
        </button>
      ),
    },
    { header: "Group", cell: (b) => <Truncated>{b.description ?? "—"}</Truncated> },
    {
      header: "Date",
      cell: (b) => <span className="tabular-nums text-sm">{fmtDate(b.budget_date)}</span>,
    },
    {
      header: "Orders",
      align: "right",
      cell: (b) => <span className="tabular-nums text-sm">{(b.orders ?? []).length}</span>,
    },
    {
      header: "Lines",
      align: "right",
      cell: (b) => <span className="tabular-nums text-sm">{(b.lines ?? []).length}</span>,
    },
    {
      header: "Status",
      cell: (b) => <StatusPill tone={budgetStatusTone(b.status)}>{budgetStatusText(b.status)}</StatusPill>,
    },
    rowActionsColumn<OrderBudget>((b) => (
      <RowActions
        label={b.code ?? b.description}
        onEdit={() => openExisting(b.id)}
        canEdit={perms.canEdit}
        // A SUBMITTED OR APPROVED BUDGET IS NOT DELETABLE. The first is with
        // someone else and the second is what purchase is acting on.
        canDelete={perms.canDelete && (b.status === "draft" || b.status === "rejected")}
        onDelete={() => remove(b.id)}
        deleteLabel="Delete budget"
        isPending={isPending}
      />
    )),
  ];

  const canSubmit =
    editable && canTransition(status, "submitted") && validity.canSave && costs.length > 0;

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Budgeting"
          description="Step 7 — cost a group of orders from their BOMs, and send the budget for approval."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-64"
            placeholder="Search budget or group…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-1 items-center justify-end gap-2">
            {perms.canCreate && (
              <Button size="md" onClick={openNew}>
                + New Budget
              </Button>
            )}
          </div>
        </div>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(b) => b.id}
          empty="No budgets yet. A budget groups several orders and costs them from their BOMs."
        />
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">budget</span>
          </>
        }
        header={{
          initials: "BG",
          title: form.description || (editId ? "Budget" : "New budget"),
          badges: (
            <span className="flex items-center gap-2">
              <StatusPill tone={budgetStatusTone(status)}>{budgetStatusText(status)}</StatusPill>
              {dirty && <span className="text-[11px] font-medium text-warning">● Unsaved</span>}
            </span>
          ),
          meta: (
            <>
              <span>
                {pickedOrders.length} {pickedOrders.length === 1 ? "order" : "orders"}
              </span>
              <span>· {costs.length} cost lines</span>
              {form.budget_date && <span>· {fmtDate(form.budget_date)}</span>}
            </>
          ),
          // SUBMIT LIVES HERE, NOT IN THE FOOTER. See the file header:
          // `submitTargetOf` reads the footer's last enabled button, so Enter off
          // the last field would otherwise send the document for approval.
          right: canSubmit ? (
            <Button type="button" variant="outline" size="sm" onClick={saveAndSubmit} disabled={isPending}>
              <Send className="h-4 w-4" aria-hidden />
              Save &amp; send for approval
            </Button>
          ) : undefined,
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New budget",
          onCancel: () => setMode("list"),
          onSave: submit,
          saveLabel: "Save budget",
          canSave: validity.canSave && editable,
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />
    </>
  );
}

/** One summary figure — or the sentence saying why there isn't one. */
function Figure({
  label,
  value,
  suffix = "",
  strong = false,
}: {
  label: string;
  value: number | { refused: string };
  suffix?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          isRefusal(value)
            ? "text-right text-xs text-danger"
            : `text-right tabular-nums ${strong ? "text-base font-semibold" : "text-sm"} ${
                (value as number) < 0 ? "text-danger" : "text-foreground"
              }`
        }
      >
        {isRefusal(value) ? value.refused : `${fmtNumber(value as number)}${suffix}`}
      </dd>
    </div>
  );
}
