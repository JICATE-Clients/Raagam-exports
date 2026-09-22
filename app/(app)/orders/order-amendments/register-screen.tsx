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
 * [ + Raise Amendment ] opens the door sheet; the order list's [Amend] lands
 * here with `?raise=<order id>` and the sheet pre-picked. A row opens the
 * entry page (`/orders/order-amendments/<id>`), which carries the variance
 * matrix, the change summary, the downstream documents and the approval
 * timeline.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
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

  const columns: Column<AmendmentRegisterRow>[] = [
    {
      header: "Entry No",
      cell: (r) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => router.push(`/orders/order-amendments/${r.id}`)}
        >
          {r.entry_no ?? `Rev ${r.amend_no}`}
        </button>
      ),
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.created_at)}</span> },
    {
      header: "Order No / RE",
      cell: (r) => <span className="font-mono text-xs">{r.re_no ?? r.order_code ?? (r.budget_code ? `Budget ${r.budget_code}` : "—")}</span>,
    },
    { header: "Customer", cell: (r) => <Truncated>{r.customer_name ?? "—"}</Truncated> },
    {
      header: "Amend Ver",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">Amend #{r.amend_no}</span>,
    },
    { header: "Origin", cell: (r) => <span className="text-sm">{originLabel(r.origin)}</span> },
    { header: "Change Type", cell: (r) => <Truncated>{amendmentTypesLabel(r.types)}</Truncated> },
    { header: "Margin Delta", align: "right", cell: (r) => <MarginDeltaCell margin={r.margin} /> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={entryStatusTone(r.status)}>{entryStatusLabel(r.status)}</StatusPill>,
    },
    rowActionsColumn((r) => {
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

      {/* APPROVED ORDERS, READY TO AMEND (user 2026-09-22: "i have approved on
          budget but in order amendment its not listing"). The table below is
          the register of ENTRIES; an approved order is the thing an entry is
          raised ON, and until 09-22 it was visible only inside the Raise
          sheet's picker — so an operator who had just approved a budget saw an
          empty page and read it as broken. Listed here with its own Amend, and
          the empty state beneath says which of the two lists is empty. */}
      {orders.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Orders that can be amended ({orders.length})
            </span>
          </div>
          <ul className="divide-y divide-border/60 text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-mono text-xs font-medium">{o.re_no ?? o.code ?? "—"}</span>
                  <Truncated className="max-w-[16rem]">{o.customer_name ?? "—"}</Truncated>
                  <span className="text-xs text-muted-foreground">
                    {o.amending
                      ? `amending — ${o.amending.entry_no ?? "open entry"} (${amendmentTypesLabel(o.amending.types)})`
                      : `${o.budget_code ? `budget ${o.budget_code}` : "budget"}${o.approved_at ? ` approved ${fmtDate(o.approved_at)}` : ""}`}
                    {o.delivery_date ? ` · delivery ${fmtDate(o.delivery_date)}` : ""}
                  </span>
                </span>
                {perms.canEdit && (
                  <Button variant="outline" size="sm" onClick={() => router.push(raiseHref(o.id))}>
                    <Plus className="h-3.5 w-3.5" /> {o.amending ? "Amend again" : "Amend"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* dup-check: exempt -- a dated amendment entry; a second entry on the same RE is how a revision is raised */}
      <DataTable
        columns={withCreatedColumns(columns, filtered)}
        rows={filtered}
        getKey={(r) => r.id}
        empty={
          rows.length > 0
            ? "No amendment matches these filters."
            : orders.length > 0
              ? "No amendment has been raised yet — pick an order above and press Amend."
              : "No amendment has been raised yet, and no order is approved to amend. An order becomes amendable once a budget that names it is approved (Orders ▸ Order Management ▸ Approval)."
        }
      />

    </div>
  );
}
