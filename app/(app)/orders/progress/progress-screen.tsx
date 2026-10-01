"use client";

import { useMemo, useState } from "react";
import { usePref } from "@/lib/ui/use-pref";
import { BarChart3, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { ProgressRow } from "@/lib/orders/progress/service";
import { toItem, type Bucket } from "@/lib/orders/progress/view";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { Overview } from "./overview";
import { OrdersView } from "./orders-view";

/**
 * Orders ▸ Order Management ▸ Order Progress — the client half
 * (doc/order/digitalisation-plan.md §1; layout approved 2026-10-01 as the
 * "Order Progress Metro" artifact).
 *
 * TWO VIEWS, ONE SET OF FILTERS. Overview answers "how is the order book" in
 * charts; Orders is the working list. Search / customer / merchandiser narrow
 * both. Clicking any part of a chart switches to Orders already filtered to it
 * (a week, a stage, a status, a customer, one order).
 *
 * The charts ALWAYS show every open order the search allows: the list's
 * status / week / stage filters never narrow them — a chart filtered to "On
 * track" was a wall of grey that said nothing (client review, 2026-10-01).
 */

export type View = "overview" | "orders";
export type Unit = "orders" | "pieces";
export type Segment = "open" | Bucket;
export type Sort = "urgent" | "due" | "re";
export type Group = "" | "customer" | "merchandiser" | "month";

export type ListFilters = {
  segment: Segment;
  week: number | null;
  stage: number | null;
  sort: Sort;
  group: Group;
  open: string | null;
};

const VIEW_KEY = "order-progress:view";
const UNIT_KEY = "order-progress:unit";

const VIEWS = ["overview", "orders"] as const;
const UNITS = ["orders", "pieces"] as const;

export function ProgressScreen({ rows, today, openId }: { rows: ProgressRow[]; today: string; openId: string | null }) {
  const items = useMemo(() => rows.map((r) => toItem(r, today)), [rows, today]);

  const [savedView, changeView] = usePref<View>(VIEW_KEY, VIEWS, "overview");
  const [unit, changeUnit] = usePref<Unit>(UNIT_KEY, UNITS, "orders");
  // An alert's `?open=<RE>` lands on the Orders list until the operator picks a view.
  const [arrivedOpen, setArrivedOpen] = useState(!!openId);
  const view: View = arrivedOpen ? "orders" : savedView;

  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [merch, setMerch] = useState("");
  const [list, setList] = useState<ListFilters>({
    segment: "open",
    week: null,
    stage: null,
    sort: "urgent",
    group: "",
    open: openId,
  });

  const customers = useMemo(() => [...new Set(items.map((i) => i.row.customer).filter((v): v is string => !!v))].sort(), [items]);
  const merchants = useMemo(() => [...new Set(items.map((i) => i.row.merchandiser).filter((v): v is string => !!v))].sort(), [items]);

  // The search / customer / merchandiser cut — what BOTH views see.
  const needle = q.trim().toLowerCase();
  const scoped = items.filter(
    (i) =>
      (!needle ||
        (i.row.orderNumber?.toLowerCase().includes(needle) ?? false) ||
        (i.row.amendmentCode?.toLowerCase().includes(needle) ?? false)) &&
      (!customer || i.row.customer === customer) &&
      (!merch || i.row.merchandiser === merch),
  );

  /** Open the Orders view filtered to one slice of a chart. */
  const drill = (patch: Partial<ListFilters> & { customer?: string; merch?: string }) => {
    const { customer: c, merch: m, ...rest } = patch;
    if (c !== undefined) setCustomer(c);
    if (m !== undefined) setMerch(m);
    setList((f) => ({ ...f, segment: "open", week: null, stage: null, open: null, ...rest }));
    changeView("orders");
  };

  const openCount = scoped.filter((i) => i.bucket !== "done").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Progress"
        // The sidebar already shows where this is; the plan removed the back link.
        back={false}
        description={`Where each order stands, from order entry to shipment — as of ${fmtDate(today)}.`}
        actions={
          <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5">
            {(
              [
                ["overview", "Overview", BarChart3],
                ["orders", "Orders", List],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setArrivedOpen(false);
                  changeView(v);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors",
                  view === v ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
                {v === "orders" && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] tabular-nums",
                      view === v ? "bg-primary-soft text-primary" : "bg-surface text-muted-foreground",
                    )}
                  >
                    {fmtNumber(openCount)}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search box filters, it never stores a value */}
        <Input
          type="search"
          uppercase={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RE No"
          aria-label="Search RE No"
          className="w-52"
        />
        <Select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" className="w-52">
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={merch} onChange={(e) => setMerch(e.target.value)} aria-label="Merchandiser" className="w-52">
          <option value="">All merchandisers</option>
          {merchants.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        {view === "overview" && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Counting
            <div role="group" aria-label="Count by" className="inline-flex rounded-md border border-border bg-surface-muted p-0.5">
              {(["orders", "pieces"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={unit === u}
                  onClick={() => changeUnit(u)}
                  className={cn(
                    "h-7 rounded px-2.5 text-xs font-semibold capitalize",
                    unit === u ? "bg-surface text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {view === "overview" ? (
        <Overview items={scoped} today={today} unit={unit} drill={drill} />
      ) : (
        <OrdersView
          items={scoped}
          today={today}
          filters={list}
          setFilters={setList}
          clearScope={() => {
            setQ("");
            setCustomer("");
            setMerch("");
          }}
          scopeChips={[
            ...(q ? [{ key: "q", label: `“${q}”`, clear: () => setQ("") }] : []),
            ...(customer ? [{ key: "c", label: customer, clear: () => setCustomer("") }] : []),
            ...(merch ? [{ key: "m", label: merch, clear: () => setMerch("") }] : []),
          ]}
        />
      )}
    </div>
  );
}

export type Drill = (patch: Partial<ListFilters> & { customer?: string; merch?: string }) => void;
