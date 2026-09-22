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
 * ONE LIST, GROUPED BY ORDER (user 2026-09-22, screenshot 3024: "the table
 * and created order messed view"). Until then the page carried TWO lists that
 * said the same thing — an "orders that can be amended" strip naming every RE
 * No and customer, and a 12-column table naming them again on every entry,
 * with five of those columns wrapping. The order is the register's SUBJECT
 * and is now said ONCE: a line spanning the table (`DataTable`'s `spanRow`)
 * carrying RE No, customer, delivery and the approved budget, with its entries
 * beneath it minus the order columns. An amendable order with nothing raised
 * yet is a line with no rows under it — that is all the strip ever meant. The
 * spec's seven columns (doc/order/amedment.md §1) stand; the duplicate `Date`
 * (it IS Created Date, the spec says so) is gone, and the created pair stays
 * last per the standing rule. Every code column declares a width and
 * `whitespace-nowrap`, so nothing wraps.
 *
 * [ + Raise Amendment ] opens the door sheet; the order list's [Amend] lands
 * here with `?raise=<order id>` and the sheet pre-picked. A row opens the
 * entry page (`/orders/order-amendments/<id>`), which carries the variance
 * matrix, the change summary, the downstream documents and the approval
 * timeline.
 */

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, FileText, Layers, Package, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { isRefusal } from "@/lib/orders/budget/totals";
import {
  AMENDMENT_ORIGINS,
  ENTRY_STATUS_FILTERS,
  amendmentTypesLabel,
  entryStatusLabel,
  entryStatusMatches,
  entryStatusTone,
  marginAlert,
  originLabel,
  type MarginDelta,
} from "@/lib/orders/amendments/amendment-entry";
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
  | ({ kind: "entry" } & AmendmentRegisterRow);

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
  const [customer, setCustomer] = useState("");
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState("");

  /* THE DOOR IS A PAGE (user 2026-09-22; it was a sheet until then). A
     `?raise=<order id>` link from the order list is forwarded to it. */
  const raiseHref = (orderId?: string | null) =>
    orderId ? `/orders/order-amendments/new?order=${orderId}` : "/orders/order-amendments/new";
  useEffect(() => {
    const id = params.get("raise");
    if (!id) return;
    router.replace(raiseHref(id));
  }, [params, router]);

  const customers = useMemo(
    () => [...new Set(rows.map((r) => r.customer_name).filter((v): v is string => !!v))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (customer && r.customer_name !== customer) return false;
      if (origin && r.origin !== origin) return false;
      if (!entryStatusMatches(status, r.status)) return false;
      if (!q) return true;
      return [r.entry_no, r.re_no, r.order_code, r.customer_name, r.remarks, amendmentTypesLabel(r.types)]
        .filter((v): v is string => !!v)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, query, customer, origin, status]);

  /* THE LIST: one line per order, its entries beneath, in ENTRY order. An
     order the filters emptied is dropped with its entries; an amendable order
     with nothing raised yet shows only while no origin / status filter is on
     (it has no entry those facets could match) and it passes customer and
     search itself. Orders with entries come first, oldest entry first; the
     never-amended ones follow by approval date. */
  const lines = useMemo<RegisterLine[]>(() => {
    const q = query.trim().toLowerCase();
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
      if (g) {
        g.head.delivery_date = o.delivery_date;
        g.head.budget_code = o.budget_code ?? g.head.budget_code;
        g.head.approved_at = o.approved_at;
        g.head.amendable = o;
        continue;
      }
      if (origin || status) continue;
      if (customer && o.customer_name !== customer) continue;
      if (q && ![o.re_no, o.code, o.customer_name].some((v) => v?.toLowerCase().includes(q))) continue;
      groups.set(o.id, {
        head: {
          key: o.id,
          order_id: o.id,
          re_no: o.re_no ?? o.code,
          customer_name: o.customer_name,
          delivery_date: o.delivery_date,
          budget_code: o.budget_code,
          approved_at: o.approved_at,
          amendable: o,
        },
        entries: [],
      });
    }
    const sorted = [...groups.values()].sort((a, b) => {
      const ea = a.entries[0]?.created_at;
      const eb = b.entries[0]?.created_at;
      if (ea && eb) return ea.localeCompare(eb);
      if (ea) return -1;
      if (eb) return 1;
      return (a.head.approved_at ?? "").localeCompare(b.head.approved_at ?? "");
    });
    const out: RegisterLine[] = [];
    for (const g of sorted) {
      out.push({ kind: "order", id: `order:${g.head.key}`, head: g.head, count: g.entries.length });
      for (const r of [...g.entries].sort((a, b) => a.amend_no - b.amend_no)) out.push({ kind: "entry", ...r });
    }
    return out;
  }, [filtered, orders, query, customer, origin, status]);

  const activeCount = (customer ? 1 : 0) + (origin ? 1 : 0) + (status ? 1 : 0);

  function abandon(r: AmendmentRegisterRow) {
    if (
      !window.confirm(
        `Abandon amendment ${r.entry_no ?? ""}? If nothing was changed the approved version stands and the order re-locks; if something was, the order stays open and needs a fresh budget approval.`,
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
          ? `Amendment ${r.entry_no ?? ""} abandoned — nothing had changed, the approved version stands`
          : `Amendment ${r.entry_no ?? ""} abandoned — the order stays open and needs a fresh budget approval`,
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
    cell: (r: AmendmentRegisterRow) => ReactNode,
    extra?: Pick<Column<RegisterLine>, "align" | "className">,
  ): Column<RegisterLine> => ({
    header,
    cell: (l) => (l.kind === "entry" ? cell(l) : null),
    ...extra,
  });

  const columns: Column<RegisterLine>[] = [
    entryCol(
      "Entry No",
      (r) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => router.push(`/orders/order-amendments/${r.id}`)}
        >
          {r.entry_no ?? `Rev ${r.amend_no}`}
        </button>
      ),
      { className: "w-[9.5rem] whitespace-nowrap" },
    ),
    entryCol("Amend Ver", (r) => <span className="tabular-nums">#{r.amend_no}</span>, {
      align: "right",
      className: "w-[6rem] whitespace-nowrap",
    }),
    entryCol("Origin", (r) => originLabel(r.origin), { className: "w-[7.5rem] whitespace-nowrap" }),
    entryCol("Change Type", (r) => <Truncated>{amendmentTypesLabel(r.types)}</Truncated>),
    entryCol("Margin Delta", (r) => <MarginDeltaCell margin={r.margin} />, {
      align: "right",
      className: "w-[7rem] whitespace-nowrap",
    }),
    entryCol(
      "Status",
      (r) => <StatusPill tone={entryStatusTone(r.status)}>{entryStatusLabel(r.status)}</StatusPill>,
      { className: "w-[9rem] whitespace-nowrap" },
    ),
    rowActionsColumn((l) => {
      if (l.kind !== "entry") return null;
      const r = l;
      const open = r.status === "draft" || r.status === "rejected" || r.status === "pending_approval";
      return (
        <RowActions
          label={r.entry_no ?? r.re_no}
          onView={() => router.push(`/orders/order-amendments/${r.id}`)}
          isPending={isPending}
          menu={[
            ...(r.garment_order_id
              ? [
                  {
                    label: "Open order",
                    icon: ClipboardList,
                    onClick: () => router.push(`/orders/amendments?open=${r.garment_order_id}`),
                  },
                  {
                    label: "Open Fabric BOM",
                    icon: Layers,
                    onClick: () => router.push(`/orders/fabric-bom?open=${r.garment_order_id}`),
                  },
                  {
                    label: "Open Material BOM",
                    icon: Package,
                    onClick: () => router.push(`/orders/material-bom?open=${r.garment_order_id}`),
                  },
                ]
              : []),
            ...(r.budget_id
              ? [
                  {
                    label: "Open budget",
                    icon: FileText,
                    onClick: () => router.push(`/orders/budgets?open=${r.budget_id}`),
                  },
                ]
              : []),
            ...(open && r.garment_order_id && perms.canEdit && r.status !== "pending_approval"
              ? [{ label: "Abandon amendment", icon: Undo2, danger: true, onClick: () => abandon(r) }]
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
          <span className="text-xs text-muted-foreground">
            {h.delivery_date ? `delivery ${fmtDate(h.delivery_date)}` : null}
            {h.delivery_date && h.budget_code ? " · " : null}
            {h.budget_code
              ? `budget ${h.budget_code}${h.approved_at ? ` approved ${fmtDate(h.approved_at)}` : ""}`
              : null}
            {l.count === 0 ? " · nothing raised yet" : null}
          </span>
        </div>
        {o && perms.canEdit && (
          <Button variant="outline" size="sm" onClick={() => router.push(raiseHref(o.id))}>
            <Plus className="h-3.5 w-3.5" /> {o.amending ? "Amend again" : "Amend"}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Amendments"
        description="Every change raised on an approved order — who asked, what kind, what it does to the margin, and where it stands."
        actions={
          perms.canEdit ? (
            <Button size="md" onClick={() => router.push(raiseHref())}>
              <Plus className="h-4 w-4" />
              Raise Amendment
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search RE No, entry no, customer or remarks…"
        activeCount={activeCount}
        onReset={
          activeCount
            ? () => {
                setCustomer("");
                setOrigin("");
                setStatus("");
              }
            : undefined
        }
        right={`${filtered.length} of ${rows.length}`}
      >
        <div>
          <Label htmlFor="oa-customer">Customer</Label>
          <Select id="oa-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="oa-origin">Origin</Label>
          <Select id="oa-origin" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">All origins</option>
            {AMENDMENT_ORIGINS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} ({o.code})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="oa-status">Approval status</Label>
          <Select id="oa-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {ENTRY_STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {/* dup-check: exempt -- a dated amendment entry; a second entry on the same RE is how a revision is raised */}
      <DataTable
        columns={withCreatedColumns(columns, lines)}
        rows={lines}
        getKey={(l) => l.id}
        spanRow={orderLine}
        empty={
          rows.length > 0 || orders.length > 0
            ? "No order or amendment matches these filters."
            : "No amendment has been raised yet, and no order is approved to amend. An order becomes amendable once a budget that names it is approved (Orders ▸ Order Management ▸ Approval)."
        }
      />

    </div>
  );
}
