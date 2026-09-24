"use client";

/**
 * Order Entry ▸ CAD — this order's CAD lifecycle, per style (user 2026-09-24:
 * "Both" — the CAD team keeps the cross-order list on Orders ▸ CAD ▸ CAD
 * Lifecycle; the merchandiser reads and acts on ONE order here without
 * leaving it).
 *
 * THE SAME STEPS, NOT A COPY. The next-step button, the corrections menu and
 * the four sheets come from `useCadActions`, which the listing uses too — so a
 * style can never be offered one step here and another there.
 *
 * ITS OWN COMPONENT, READING ITS OWN ROWS (`getOrderCad`). The order editor
 * returns early above ~19,000 lines and must not grow a hook below that return
 * (AGENTS.md "Hooks above every early return"); a component rendered in a
 * section owns its hooks. Same shape as the Fabric BOM's T&A tab.
 *
 * A SEPARATE DOCUMENT INSIDE THE ORDER (`SeparateDocumentScope`). CAD records
 * are outside the order lock (0576 left them out, 0628 kept it so): a buyer's
 * rework arrives after approval too. So on an approved order this tab still
 * works — but only through its own actions, never the order's Save. The Eye's
 * read-only view passes `canEdit={false}` and the tab shows, never acts.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { SeparateDocumentScope } from "@/components/ui/field";
import { fmtDate } from "@/lib/format";
import { today as istToday } from "@/lib/calendar";
import { getOrderCad } from "@/lib/orders/cad-lifecycle/actions";
import {
  CAD_STATE_META,
  cadLateness,
  cadOrderReady,
  cadTypeLabel,
  latestVersion,
  layoutLabel,
  type CadStyleRow,
  type PatternMakerRow,
} from "@/lib/orders/cad-lifecycle/types";
import { useCadActions } from "./use-cad-actions";

export function OrderCadTab({ orderId, canEdit }: { orderId: string | null; canEdit: boolean }) {
  const [data, setData] = useState<{
    forOrder: string;
    rows: CadStyleRow[];
    employees: PatternMakerRow[];
    canEdit: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    getOrderCad(orderId).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setError(null);
        setData({ forOrder: orderId, rows: r.rows, employees: r.employees, canEdit: r.canEdit });
      } else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, tick]);

  const current = data && data.forOrder === orderId ? data : null;
  const editable = canEdit && !!current?.canEdit;
  const cad = useCadActions({ employees: current?.employees ?? [], canEdit: editable, onChanged: reload });
  const today = istToday();

  if (!orderId) {
    return (
      <p className="text-sm text-muted-foreground">
        Save the order first — the CAD is allocated per style of a saved order.
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!current) return <p className="text-sm text-muted-foreground">Loading the CAD…</p>;

  const onOrder = current.rows.filter((r) => r.on_order);
  const ready = cadOrderReady(current.rows);
  const openCount = onOrder.filter((r) => r.state !== "approved").length;

  const columns: Column<CadStyleRow>[] = [
    {
      header: "Style",
      cell: (r) => (
        <div className="min-w-0 leading-tight">
          <Truncated className="text-sm font-medium">{r.style_ref_no}</Truncated>
          {!r.on_order ? (
            <span className="text-xs text-warning">No longer on the order</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {r.layout_type ? layoutLabel(r.layout_type) : "Layout not declared"}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Ver",
      align: "right",
      cell: (r) => {
        const v = latestVersion(r.versions);
        return <span className="tabular-nums text-sm">{v ? `V${v.version_no}` : "—"}</span>;
      },
    },
    {
      header: "Pattern Maker",
      cell: (r) => {
        const v = latestVersion(r.versions);
        return v ? (
          <div className="min-w-0 leading-tight">
            <Truncated className="text-sm">{v.pattern_maker_name ?? "—"}</Truncated>
            <span className="text-xs text-muted-foreground">{cadTypeLabel(v.cad_type)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      header: "Target",
      cell: (r) => {
        const v = latestVersion(r.versions);
        return <span className="text-sm tabular-nums">{v ? fmtDate(v.target_date) : "—"}</span>;
      },
    },
    {
      header: "Dispatched",
      cell: (r) => {
        const d = latestVersion(r.versions)?.dispatch;
        return <span className="text-sm tabular-nums">{d ? fmtDate(d.dispatch_date) : "—"}</span>;
      },
    },
    {
      header: "Expected",
      cell: (r) => {
        const d = latestVersion(r.versions)?.dispatch;
        return <span className="text-sm tabular-nums">{d?.expected_approval_date ? fmtDate(d.expected_approval_date) : "—"}</span>;
      },
    },
    {
      header: "Status",
      cell: (r) => {
        const meta = CAD_STATE_META[r.state];
        const late = cadLateness(latestVersion(r.versions), today);
        const comments = latestVersion(r.versions)?.decision?.buyer_comments;
        return (
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1">
              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
              {late.late && <StatusPill tone="danger">{`${late.days}d ${late.what}`}</StatusPill>}
            </div>
            {r.state === "rework" && comments && (
              <Truncated className="text-xs text-danger">{comments}</Truncated>
            )}
          </div>
        );
      },
    },
    { header: "Next", cell: (r) => cad.stepButton(r) },
    {
      header: "",
      cell: (r) => (
        <RowActions
          label={r.style_ref_no}
          view={false}
          onView={() => cad.showHistory(r)}
          menu={cad.menuFor(r)}
          isPending={cad.isPending}
        />
      ),
    },
  ];

  return (
    <SeparateDocumentScope>
      <div className="space-y-3">
        <div
          role="status"
          className={
            ready
              ? "flex flex-wrap items-center justify-between gap-2 rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success"
              : "flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning"
          }
        >
          <span>
            {onOrder.length === 0
              ? "This order has no styles yet — add them on Order Info ▸ Style(s), then allocate each one's CAD."
              : ready
                ? "Every style's CAD is approved — the Fabric BOM can be created."
                : `${openCount} of ${onOrder.length} ${onOrder.length === 1 ? "style" : "styles"} still need an approved CAD before the Fabric BOM can be created.`}
          </span>
          <Link href="/orders/cad-lifecycle" className="shrink-0 text-xs font-medium underline">
            All orders&apos; CAD
          </Link>
        </div>
        {/* A DOCUMENT'S OWN TABLE — every style of this order, never paged
            (AGENTS.md "Pagination": a table that is part of a document). */}
        <DataTable
          columns={columns}
          rows={current.rows}
          getKey={(r) => r.key}
          paginate={false}
          empty="No styles on this order yet."
        />
      </div>
      {cad.sheets}
    </SeparateDocumentScope>
  );
}
