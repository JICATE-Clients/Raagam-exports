"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRegisterWorkspaceTab } from "@/lib/workspace-tabs";
import { fmtNumber } from "@/lib/format";
import type { ManualCostRow, ProfitOrderRow } from "@/lib/orders/profitability/types";
import { PLAIN, STAGE_LABEL, lakh, rupees, toBvaItem, type BvaItem } from "@/lib/orders/profitability/view";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ManualCostsEditor } from "./manual-costs-editor";

/**
 * One order's Budget vs Actual, behind three tabs so nobody scrolls past a form
 * to read a result (plan approved 2026-10-01):
 *   Result · Costs typed by hand · Where the figures come from
 */

const GOOD = "var(--success)";
const BAD = "var(--danger)";
const WARN = "var(--warning)";
const PLAN = "color-mix(in srgb, var(--muted-foreground) 30%, transparent)";

type Tab = "result" | "typed" | "sources";

export function OrderStory({ row, manual, canEdit }: { row: ProfitOrderRow; manual: ManualCostRow[]; canEdit: boolean }) {
  const i = toBvaItem(row);
  const [tab, setTab] = useState<Tab>("result");
  // The workspace tab guesses its name from the path, which here is the order's uuid.
  useRegisterWorkspaceTab({ href: `/orders/profit-check/${row.salesOrderId}`, title: `${row.reNo ?? "Order"} · Profit Check` });
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "result", label: "Result" },
    { key: "typed", label: "Costs typed by hand", count: manual.length },
    { key: "sources", label: "Where the figures come from", count: row.documents.length },
  ];

  return (
    <div className="space-y-4">
      <Link href="/orders/profit-check" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="size-3.5" /> Order Profit Check
      </Link>
      <PageHeader
        title={row.reNo ?? "Order"}
        back={false}
        description={[row.customer, row.merchandiser && `Merchandiser ${row.merchandiser}`, row.budgetCode && `Budget ${row.budgetCode}`, STAGE_LABEL[i.stage]]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link href={`/orders/${row.salesOrderId}/budget`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-sm font-semibold hover:bg-surface-muted">
            Open budget <ExternalLink className="size-3.5" />
          </Link>
        }
      />

      <div role="tablist" aria-label="Order" className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count != null && <span className="rounded-full bg-surface-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === "result" && <Result i={i} />}
      {tab === "typed" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Stitching (CMT), freight and other costs that no purchase order records — and any other income such as a scrap sale. Add them here so the
            result is complete.
          </p>
          <ManualCostsEditor salesOrderId={row.salesOrderId} initial={manual} canEdit={canEdit} />
        </div>
      )}
      {tab === "sources" && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-[13px]">
            <thead>
              <tr className="bg-surface-muted text-left text-xs text-muted-foreground">
                <th className="h-9 px-3 font-medium">Entry</th>
                <th className="h-9 px-3 font-medium">Number / description</th>
                <th className="h-9 px-3 font-medium">Counts towards</th>
                <th className="h-9 px-3 text-right font-medium">PO value</th>
                <th className="h-9 px-3 text-right font-medium">Counted</th>
              </tr>
            </thead>
            <tbody>
              {row.documents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No purchase orders, process orders or shipments carry this RE No yet.
                  </td>
                </tr>
              ) : (
                row.documents.map((d, k) => (
                  <tr key={k} className="border-t border-border">
                    <td className="h-10 px-3">{d.kind}</td>
                    <td className="px-3 font-mono text-xs">{d.code ?? "—"}</td>
                    <td className="px-3">{d.bucket === "sales" ? "Money from buyer" : d.bucket === "income" ? "Other income" : PLAIN[d.bucket].label}</td>
                    <td className="px-3 text-right tabular-nums">{d.committed == null ? "—" : rupees(d.committed)}</td>
                    <td className="px-3 text-right tabular-nums">{rupees(d.actual)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border border-border bg-surface p-4", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Result({ i }: { i: BvaItem }) {
  const row = i.row;
  const worst = i.costs
    .filter((c) => c.plan != null && c.spent != null)
    .map((c) => ({ label: c.label, d: (c.spent ?? 0) - (c.plan ?? 0) }))
    .sort((a, b) => b.d - a.d)[0];
  const short = (row.orderQty ?? 0) - row.shippedQty;

  let sentence: ReactNode;
  let tone: "good" | "bad" | "wait" = "wait";
  if (i.stage === "done" && i.gap != null) {
    tone = i.gap < 0 ? "bad" : "good";
    sentence =
      i.gap < 0 ? (
        <>
          This order earned <b>{rupees(-i.gap)} less</b> than planned.
          {worst && worst.d > 0 && (
            <>
              {" "}
              Most of it is <b>{worst.label.toLowerCase()}</b>, which cost {rupees(worst.d)} more than the budget
            </>
          )}
          {short > 0 && (
            <>
              {worst && worst.d > 0 ? ", and " : " "}
              <b>{fmtNumber(short)} pieces</b> were not shipped
            </>
          )}
          .
        </>
      ) : (
        <>
          This order earned <b>{rupees(i.gap)} more</b> than planned.
        </>
      );
  } else if (i.stage === "run") {
    const ahead = (i.spendPct ?? 0) - (i.shipPct ?? 0);
    sentence = (
      <>
        Still running, so the profit is not known yet.{" "}
        {ahead > 25 ? (
          <>
            <b>Watch:</b> it has spent {Math.round(i.spendPct ?? 0)}% of its budget but shipped only {Math.round(i.shipPct ?? 0)}% of the pieces.
          </>
        ) : (
          "Spending is in step with shipping."
        )}
      </>
    );
  } else if (i.stage === "cancelled") {
    sentence = "This order was cancelled, so it is not counted.";
  } else {
    sentence = "Nothing has been bought or shipped for this order yet.";
  }

  const costMax = Math.max(1, ...i.costs.map((c) => Math.max(c.plan ?? 0, c.spent ?? 0)));
  const flowMax = Math.max(1, i.planSales ?? 0, i.sales ?? 0, i.planCost ?? 0, i.spentCost ?? 0);

  return (
    <div className="space-y-4">
      {row.budgetRefusal && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{row.budgetRefusal}</p>}
      <div className="grid gap-3.5 lg:grid-cols-[1.15fr_1fr]">
        <Card title="The result">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Big label="Planned profit" value={i.planProfit != null ? rupees(i.planProfit) : "—"} sub={i.planMargin != null ? `${i.planMargin.toFixed(1)}% of sales` : "Budget incomplete"} />
            {i.stage === "run" ? (
              <Big label="Spent so far" value={`${Math.round(i.spendPct ?? 0)}%`} sub={`of the planned cost · shipped ${Math.round(i.shipPct ?? 0)}%`} />
            ) : (
              <Big
                label="Actual profit"
                value={i.profit != null ? rupees(i.profit) : "—"}
                sub={i.margin != null ? `${i.margin.toFixed(1)}% of sales` : "known once something has shipped"}
                color={i.gap == null ? undefined : i.gap < 0 ? BAD : GOOD}
              />
            )}
          </div>
          <p className={cn("rounded-lg px-3 py-2.5 text-sm leading-relaxed", tone === "bad" ? "bg-danger-soft" : tone === "good" ? "bg-success-soft" : "bg-surface-muted")}>{sentence}</p>
        </Card>
        <Card title="Money in and out">
          <Flow label="Money in" value={i.sales ?? 0} plan={i.planSales ?? 0} max={flowMax} color="var(--primary)" />
          <Flow label="Money out" value={i.spentCost ?? 0} plan={i.planCost ?? 0} max={flowMax} color={WARN} />
          {i.stage === "done" && i.profit != null && i.planProfit != null && (
            <Flow label="Profit" value={Math.max(0, i.profit)} plan={i.planProfit} max={flowMax} color={i.profit < i.planProfit ? BAD : GOOD} />
          )}
          <p className="text-xs text-muted-foreground">Grey = still to come as planned · coloured = so far</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Each cost: planned vs spent</h2>
        <p className="text-[12.5px] text-muted-foreground">The black line is the plan. Anything past it is overspend.</p>
      </div>
      <div className="rounded-xl border border-border bg-surface px-4">
        {i.costs.map((c) => (
          <Meter key={c.key} label={c.label} hint={c.hint} plan={c.plan} actual={c.spent} po={c.po} max={costMax} running={i.stage === "run"} kind="cost" />
        ))}
        <Meter
          label="Money from buyer"
          hint={`Value of what was shipped · ${fmtNumber(row.shippedQty)} of ${fmtNumber(row.orderQty)} pcs`}
          plan={i.planSales}
          actual={i.sales}
          po={null}
          max={Math.max(1, i.planSales ?? 0, i.sales ?? 0)}
          running={i.stage === "run"}
          kind="sales"
        />
      </div>
      {row.notes.map((n) => (
        <p key={n} className="text-sm text-warning">
          {n}
        </p>
      ))}
    </div>
  );
}

function Big({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="rounded-lg bg-surface-muted px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums tracking-tight" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function Flow({ label, value, plan, max, color }: { label: string; value: number; plan: number; max: number; color: string }) {
  const w = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_7rem] items-center gap-2.5 text-[13px]">
      <span>{label}</span>
      <span className="flex h-5 overflow-hidden rounded-md bg-surface-muted" title={`Planned ${rupees(plan)}`}>
        <i className="block h-full" style={{ width: w(Math.min(value, plan)), background: color }} />
        {value > plan && <i className="block h-full" style={{ width: w(value - plan), background: BAD }} />}
        <i className="block h-full" style={{ width: w(Math.max(0, plan - value)), background: PLAN }} />
      </span>
      <span className="text-right font-semibold tabular-nums">{rupees(value)}</span>
    </div>
  );
}

function Meter({
  label,
  hint,
  plan,
  actual,
  po,
  max,
  running,
  kind,
}: {
  label: string;
  hint: string;
  plan: number | null;
  actual: number | null;
  po: number | null;
  max: number;
  running: boolean;
  kind: "cost" | "sales";
}) {
  const w = (v: number) => `${(v / max) * 100}%`;
  const has = actual != null && plan != null;
  const diff = has ? actual! - plan! : 0;
  const pct = has && plan ? (actual! / plan!) * 100 : 0;
  const bad = kind === "cost" ? diff > (plan ?? 0) * 0.05 : diff < -(plan ?? 0) * 0.05;
  const warn = kind === "cost" ? diff > 0 : diff < 0;
  const color = bad ? BAD : warn ? WARN : GOOD;
  let pill: ReactNode;
  if (!has) pill = <StatusPill tone="neutral">{plan == null ? "No plan" : "Nothing yet"}</StatusPill>;
  else if (running && kind === "cost" && diff <= 0) pill = <StatusPill tone="info">{Math.round(pct)}% used</StatusPill>;
  else if (kind === "cost")
    pill = bad ? <StatusPill tone="danger">{lakh(diff)} over</StatusPill> : warn ? <StatusPill tone="warning">{lakh(diff)} over</StatusPill> : <StatusPill tone="success">{lakh(-diff)} saved</StatusPill>;
  else pill = diff < 0 ? <StatusPill tone={bad ? "danger" : "warning"}>{lakh(-diff)} less</StatusPill> : <StatusPill tone="success">{lakh(diff)} more</StatusPill>;

  return (
    <div className="grid items-center gap-3.5 border-t border-border py-3 first:border-t-0 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1.6fr)_9rem_10rem]">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div>
        <div className="relative h-3.5 rounded-full bg-surface-muted">
          {has && <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(Math.min(actual!, plan!)), background: color }} />}
          {has && diff > 0 && (
            <i
              className="absolute inset-y-0 rounded-r-full"
              style={{ left: w(plan!), width: w(diff), background: `repeating-linear-gradient(135deg, ${kind === "cost" ? BAD : GOOD} 0 4px, transparent 4px 8px)` }}
            />
          )}
          {plan != null && <span className="absolute -inset-y-1 w-0.5 rounded bg-foreground" style={{ left: w(plan) }} />}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {has ? `${kind === "cost" ? "Spent" : "Received"} ${Math.round(pct)}% of the plan` : "Nothing recorded yet"}
          {po != null && ` · POs raised ${rupees(po)}`}
        </p>
      </div>
      <div className="text-right tabular-nums">
        <p className="text-sm font-semibold">{actual != null ? rupees(actual) : "—"}</p>
        <p className="text-xs text-muted-foreground">of {plan != null ? rupees(plan) : "—"} planned</p>
      </div>
      <div className="text-right">{pill}</div>
    </div>
  );
}
