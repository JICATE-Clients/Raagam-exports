"use client";

/**
 * ONE AMENDMENT ENTRY — the audit page (doc/order/amedment.md §2–§5).
 *
 *  1. THE HEADER — entry no, RE No, customer, Amend #n, origin, categories,
 *     remarks, who raised it and when, its status.
 *  2. THE BUDGET VARIANCE AUDIT MATRIX (§4) — Original Approved (the money
 *     baseline frozen when the entry opened) beside Amended Proposed (the
 *     budget's figures NOW, from `budgetFiguresOf` — the same assembler the
 *     budget screen and submit use) with the delta and a direction. Row for
 *     row this is `compareToBaseline` — nothing here computes a figure — with
 *     the order's quantity and the margin on top, from the two KPI sets.
 *  3. WHAT CHANGED — the V0 order snapshot diffed against the order as it
 *     stands (`order_amendment_changes`): rows added / removed / changed per
 *     section, the header's changed columns by name.
 *  4. DOWNSTREAM DOCUMENTS (§3, as decided: stale-and-gate) — each BOM's
 *     freshness (`bomStatusOf`: "Recalculate" when the order moved under it)
 *     with a button that opens it; saving it is what re-stamps its basis. The
 *     budget's "Refresh from BOMs" then pulls the recomputed lines. Nothing is
 *     rewritten by itself, and `submitBudget` refuses while any of this is
 *     stale.
 *  5. THE APPROVAL (§5) — the revised budget's run and timeline; "Send for
 *     approval" is the budget's own Submit, opened from here.
 *
 * Abandon is on this page too (`abandon_order_amendment`): nothing changed →
 * the approved version stands and the order re-locks; something changed → the
 * order stays open and needs a fresh approval. Refused while with the approver.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, ClipboardList, FileText, Minus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import type { BaselineRow } from "@/lib/orders/budget/amendment";
import {
  amendmentTypesLabel,
  entryStatusLabel,
  entryStatusTone,
  originLabel,
} from "@/lib/orders/amendments/amendment-entry";
import { abandonOrderAmendment } from "@/lib/orders/order-amendments/actions";
import type { AmendmentEntryDetail } from "@/lib/orders/order-amendments/service";

type Kind = "amount" | "percent" | "qty";

function fmt(v: number | Refusal, kind: Kind, unit?: string): string {
  if (isRefusal(v)) return `— (${v.refused})`;
  if (kind === "percent") return `${fmtNumber(v)}%`;
  if (kind === "qty") return `${fmtNumber(v)}${unit ? ` ${unit}` : ""}`;
  return fmtMoney(v);
}

/** The matrix's direction column: an arrow and a word, toned by what it means
 *  for the business — more cost is `danger`, more revenue or profit `success`. */
function Direction({ v, kind, good }: { v: number | Refusal; kind: "cost" | "revenue" | "profit" | "qty" | "margin"; good?: "up" | "down" }) {
  if (isRefusal(v)) return <span className="text-xs text-muted-foreground">—</span>;
  if (v === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> No change
      </span>
    );
  }
  const up = v > 0;
  const word =
    kind === "cost" ? (up ? "Cost up" : "Cost down") :
    kind === "revenue" ? (up ? "Revenue up" : "Revenue down") :
    kind === "profit" ? (up ? "Profit up" : "Profit down") :
    kind === "margin" ? (up ? "Margin up" : "ALERT — margin down") :
    up ? "Increase" : "Reduced";
  const favourable = good ? (good === "up") === up : kind === "cost" ? !up : up;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        favourable ? "text-success" : "text-danger",
        kind === "margin" && !up && "uppercase",
      )}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {word}
    </span>
  );
}

function VarianceTable({ detail }: { detail: AmendmentEntryDetail }) {
  const b = detail.baselineKpis;
  const c = detail.currentKpis;
  const unit = b && !isRefusal(b.order_unit) ? b.order_unit : c && !isRefusal(c.order_unit) ? c.order_unit : undefined;

  const delta = (x: number | Refusal | undefined, y: number | Refusal | undefined): number | Refusal => {
    if (x === undefined) return { refused: "No approved baseline recorded" };
    if (y === undefined) return { refused: detail.currentRefusal ?? "The budget's figures could not be read" };
    if (isRefusal(x)) return { refused: `Approved figure unknown — ${x.refused}` };
    if (isRefusal(y)) return { refused: `Current figure unknown — ${y.refused}` };
    return Math.round((y - x) * 100) / 100;
  };

  type Row = { label: string; kind: Kind; dir: "cost" | "revenue" | "profit" | "qty" | "margin"; was: number | Refusal | undefined; now: number | Refusal | undefined; strong?: boolean };
  const top: Row[] = [
    { label: "Total order quantity", kind: "qty", dir: "qty", was: b?.order_qty, now: c?.order_qty },
  ];

  const byKey = new Map(detail.variance.map((r) => [r.key, r] as const));
  const costRows: BaselineRow[] = detail.variance.filter(
    (r) => !["total", "sales", "income", "profit", "margin", "cost_per_piece"].includes(r.key),
  );
  const pick = (k: string) => byKey.get(k as BaselineRow["key"]);

  const money = (r: BaselineRow | undefined, label: string, dir: Row["dir"], strong = false): Row => ({
    label,
    kind: r?.kind === "percent" ? "percent" : "amount",
    dir,
    was: r?.baseline,
    now: r?.current,
    strong,
  });

  const rows: (Row | "rule")[] = [
    ...top,
    "rule",
    money(pick("sales"), "Gross sales value (revenue)", "revenue", true),
    money(pick("income"), "Other incomes", "revenue"),
    "rule",
    ...costRows.map((r) => money(r, r.label, "cost")),
    "rule",
    money(pick("total"), "Total estimated expenses", "cost", true),
    "rule",
    money(pick("profit"), "Net profit amount", "profit", true),
    money(pick("margin"), "Net profit margin %", "margin", true),
    money(pick("cost_per_piece"), "Cost per piece", "cost"),
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-semibold">Financial cost head</th>
            <th className="py-2 px-3 text-right font-semibold">Original approved</th>
            <th className="py-2 px-3 text-right font-semibold">Amended proposed</th>
            <th className="py-2 px-3 text-right font-semibold">Variance (delta)</th>
            <th className="py-2 pl-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) =>
            r === "rule" ? (
              <tr key={`rule-${i}`}>
                <td colSpan={5} className="border-t border-border" />
              </tr>
            ) : (
              <tr key={r.label} className={cn("border-b border-border/60", r.strong && "font-medium")}>
                <td className="py-1.5 pr-3">{r.label}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{r.was === undefined ? "—" : fmt(r.was, r.kind, unit)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">
                  {r.now === undefined ? (
                    <span className="text-xs text-muted-foreground" title={detail.currentRefusal ?? undefined}>—</span>
                  ) : (
                    fmt(r.now, r.kind, unit)
                  )}
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums">
                  {(() => {
                    const d = delta(r.was, r.now);
                    if (isRefusal(d)) return <span className="text-xs text-muted-foreground" title={d.refused}>—</span>;
                    const sign = d > 0 ? "+" : "";
                    return `${sign}${fmt(d, r.kind, unit)}`;
                  })()}
                </td>
                <td className="py-1.5 pl-3"><Direction v={delta(r.was, r.now)} kind={r.dir} /></td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AmendmentEntryScreen({ detail }: { detail: AmendmentEntryDetail }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const { row } = detail;
  const isOpen = row.outcome === "open";
  const withApprover = row.status === "pending_approval";

  function abandon() {
    if (
      !window.confirm(
        `Abandon amendment ${row.entry_no ?? ""}? If nothing was changed the approved version stands and the order re-locks; if something was, the order stays open and needs a fresh budget approval.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await abandonOrderAmendment(row.id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        res.outcome === "restored"
          ? "Abandoned — nothing had changed, the approved version stands and the order is locked again"
          : "Abandoned — the order stays open and needs a fresh budget approval",
      );
      router.refresh();
    });
  }

  const orderHref = row.garment_order_id ? `/orders/amendments?open=${row.garment_order_id}` : null;
  const budgetHref = row.budget_id ? `/orders/budgets?open=${row.budget_id}` : null;

  /* THE COMPARISON, AND ONLY THE COMPARISON (user 2026-09-22: "the eye icon
     showing a lot of unnecessary details, we need the comparison only"). The
     page used to carry a header card, the MD-gate banner, a "what changed"
     table, the downstream documents and the approval timeline; all of that is
     still in `detail` for whoever needs it, but the screen prints one identity
     line, the variance matrix, and the buttons that act. */
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Amendment ${row.entry_no ?? `#${row.amend_no}`}`}
        description={[
          row.re_no ?? row.order_code ?? "—",
          row.customer_name ?? "—",
          `Amend #${row.amend_no}`,
          amendmentTypesLabel(row.types),
          originLabel(row.origin),
        ].join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={entryStatusTone(row.status)}>{entryStatusLabel(row.status)}</StatusPill>
            <Button variant="outline" size="md" onClick={() => router.push("/orders/order-amendments")}>
              ← Back
            </Button>
            {orderHref && (
              <Button variant="outline" size="md" onClick={() => router.push(orderHref)}>
                <ClipboardList className="h-4 w-4" /> Open order
              </Button>
            )}
            {budgetHref && (
              <Button size="md" onClick={() => router.push(budgetHref)}>
                <FileText className="h-4 w-4" /> Open budget
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{`Budget variance audit${row.re_no ? ` — ${row.re_no}` : ""}`}</CardTitle>
          <span className="text-xs text-muted-foreground">Original approved vs amended proposed</span>
        </CardHeader>
        <CardBody>
          {!detail.baseline ? (
            <p className="text-sm text-muted-foreground">No approved baseline was recorded for this entry.</p>
          ) : (
            <>
              {detail.currentRefusal && (
                <p className="mb-2 text-xs text-warning">Amended figures could not be read: {detail.currentRefusal}</p>
              )}
              <VarianceTable detail={detail} />
            </>
          )}
        </CardBody>
      </Card>

      {isOpen && row.garment_order_id && detail.perms.canEdit && (
        <div className="flex justify-end">
          <Button variant="outline" size="md" onClick={abandon} disabled={isPending || withApprover} title={withApprover ? "The revised budget is with the approver" : undefined}>
            <Undo2 className="h-4 w-4" /> {isPending ? "Abandoning…" : "Abandon amendment"}
          </Button>
        </div>
      )}
    </div>
  );
}
