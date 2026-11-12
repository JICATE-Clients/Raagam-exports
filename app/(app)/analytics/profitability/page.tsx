import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { loadBudgets } from "@/lib/analytics/sources";
import { LOW_MARGIN_PCT, profitBoard, type BudgetIn } from "@/lib/analytics/compute";
import { inRange, parsePeriod } from "@/lib/analytics/period";
import { fmtCompactInr, fmtCompactNumber, fmtPct } from "@/lib/dashboard/format";
import { fmtDate } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/ui/status-tone";
import { GlowBars, NeedsDoing, Strip, Tape, VizCard } from "@/components/viz/kit";
import { MarginLadder } from "@/components/analytics/pictures";
import { BoardHeader, LoadError, NoAccess, Row3, n, viewOf } from "@/components/analytics/board-ui";

/**
 * ANALYTICS ▸ PROFITABILITY — "Which orders make money, and which lose it?"
 *
 * WHO SEES IT (user 2026-11-05, option B): anyone who can open Orders ▸ Budgeting, so a
 * merchandiser sees the margin of the orders their Budgeting screen shows them. The figures are
 * each budget's frozen summary — the margin the MD approved, not a recalculation.
 */
export default async function ProfitabilityBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const sp = await searchParams;
  const period = parsePeriod(sp.p);
  const view = viewOf(sp.view);
  const res = await loadBudgets();

  const header = <BoardHeader title="Profitability" question="Which orders make money, and which lose it?" period={period.key} view={view} />;
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header}
        {res.reason === "access" ? <NoAccess what="Order margin" screen="Orders ▸ Budgeting" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const b = profitBoard(res.data, period);
  const rows = res.data.filter((r) => inRange(r.budgetDate, period));
  const label = (r: { code: string; reNos: string[] }) => (r.reNos.length ? r.reNos.join(", ") : `Budget ${r.code}`);
  const href = (id: string) => `/orders/budgets?budget=${id}`;
  const pts = b.margin != null && b.prevMargin != null ? b.margin - b.prevMargin : null;
  const tone = (p: number) => (p < LOW_MARGIN_PCT ? "var(--danger)" : p < 15 ? "var(--warning)" : "var(--success)");
  const justAbove = b.byBudget.filter((r) => r.marginPct! >= LOW_MARGIN_PCT && r.marginPct! < LOW_MARGIN_PCT + 3);

  if (view === "list") {
    return (
      <div className="space-y-3">
        {header}
        <DataTable
          rows={rows}
          getKey={(r) => r.id}
          empty={`No submitted or approved budget in ${period.label}.`}
          columns={withCreatedColumns<BudgetIn>(
            [
              { header: "Order", cell: (r) => <Link className="font-semibold text-primary hover:underline" href={href(r.id)}>{label(r)}</Link> },
              { header: "Buyer", cell: (r) => r.buyers.join(", ") || "—" },
              { header: "Budget date", cell: (r) => fmtDate(r.budgetDate) },
              { header: "Income", align: "right", cell: (r) => <span className="tabular-nums">{fmtCompactInr(r.income)}</span> },
              { header: "Profit", align: "right", cell: (r) => <span className="tabular-nums">{fmtCompactInr(r.profit)}</span> },
              { header: "Margin", align: "right", cell: (r) => <span className="font-semibold tabular-nums">{r.marginPct == null ? "Not stated" : fmtPct(r.marginPct)}</span> },
              { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{r.status === "approved" ? "Approved" : "With MD"}</StatusPill> },
            ],
            rows,
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {header}
      <Strip
        cells={[
          {
            label: `Margin · ${period.label}`,
            value: fmtPct(b.margin),
            hint: pts != null ? `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts vs ${period.prev!.label}` : "profit ÷ income, all budgets",
            mood: b.margin == null ? "quiet" : b.margin < LOW_MARGIN_PCT ? "problem" : "normal",
          },
          { label: "Profit", value: fmtCompactInr(b.profit), hint: `on ${fmtCompactInr(b.income)} income`, mood: "good" },
          {
            label: `Under ${LOW_MARGIN_PCT}%`,
            value: n(b.low.length, "budget"),
            hint: b.low.length ? b.low.map(label).join(" · ") : "none",
            mood: b.low.length ? "problem" : "good",
          },
          {
            label: "Just above it",
            value: n(justAbove.length, "budget"),
            hint: justAbove.length ? justAbove.map((r) => `${label(r)} ${fmtPct(r.marginPct)}`).join(" · ") : `none between ${LOW_MARGIN_PCT}% and ${LOW_MARGIN_PCT + 3}%`,
            mood: justAbove.length ? "look" : "normal",
          },
          { label: "With the MD", value: fmtCompactNumber(b.withMd), hint: b.withMd ? "submitted, not decided" : "nothing waiting", mood: b.withMd ? "look" : "good", href: "/orders/budgets" },
        ]}
      />
      <VizCard title="Which orders make money, and which do not?" question={`Each order is a dot on its margin — a bigger dot is a bigger order. The red band is under ${LOW_MARGIN_PCT}%.`}>
        <MarginLadder
          low={LOW_MARGIN_PCT}
          money={fmtCompactInr}
          points={b.byBudget.map((r) => ({ id: r.id, label: label(r), pct: r.marginPct!, income: r.income ?? 0, href: href(r.id), buyer: r.buyers.join(", ") || "—" }))}
        />
      </VizCard>
      <Row3>
        <VizCard title="Which buyer pays best?" question="Margin, weighted by income" padded>
          <GlowBars rows={b.byBuyer.map((r) => ({ key: r.key, label: r.label, value: r.value, colour: tone(r.value) }))} format={(v) => fmtPct(v)} />
        </VizCard>
        <VizCard title="Where does each rupee go?" question="All budgets in the period" padded>
          <Tape
            parts={[
              { label: "Cost", value: b.expenses, colour: "var(--primary)" },
              { label: "Profit", value: Math.max(0, b.profit), colour: "var(--success)" },
            ]}
            format={fmtCompactInr}
            note={b.income > 0 ? `Out of every ₹100 of income, ₹${Math.round((b.profit / b.income) * 100)} is profit.` : undefined}
          />
        </VizCard>
        <VizCard title="How are margins spread?" question="Budgets in each band" padded>
          <Tape
            parts={b.bands.map((x) => ({
              label: x.label,
              value: x.value,
              colour: x.key === "loss" || x.key === "low" ? "var(--danger)" : x.key === "mid" ? "var(--warning)" : x.key === "good" ? "var(--primary)" : "var(--success)",
            }))}
            format={(v) => fmtCompactNumber(v)}
          />
        </VizCard>
      </Row3>
      {b.unknown > 0 ? (
        <p className="text-xs text-warning">
          {n(b.unknown, "budget")} could not state a margin (a figure was refused at submit) and {b.unknown === 1 ? "is" : "are"} left out of the averages.
        </p>
      ) : null}
      <NeedsDoing
        cells={[
          {
            title: `Under ${LOW_MARGIN_PCT}%`,
            mood: b.low.length ? "problem" : "good",
            count: b.low.length ? n(b.low.length, "order") : "None",
            text: b.low.length ? b.low.map((r) => `${label(r)} ${fmtPct(r.marginPct)}`).join(" · ") : "Every order clears the line",
            href: b.low[0] ? href(b.low[0].id) : undefined,
            linkText: "Open the budget",
          },
          {
            title: "Waiting with the MD",
            mood: b.withMd ? "look" : "good",
            count: b.withMd ? n(b.withMd, "budget") : "None",
            text: b.withMd ? "Submitted and not yet decided" : "Nothing waiting for a decision",
            href: b.withMd ? "/orders/budgets" : undefined,
            linkText: "Open Budgeting",
          },
          {
            title: "Margin not stated",
            mood: b.unknown ? "look" : "good",
            count: b.unknown ? n(b.unknown, "budget") : "None",
            text: b.unknown ? "A figure was refused when it was submitted" : "Every budget states its margin",
            href: b.unknown ? "/orders/budgets" : undefined,
            linkText: "Open Budgeting",
          },
        ]}
      />
    </div>
  );
}
