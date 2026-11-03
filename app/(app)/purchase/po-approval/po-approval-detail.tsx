"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CircleCheck, FileText, Quote, TrendingUp, TriangleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtDateTime, fmtFixed, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { poBudgetImpact } from "@/lib/purchase/re-po/types";
import type { PoWithDetails } from "@/lib/purchase/po-service";
import type { PoVariance } from "@/lib/purchase/po-escalation";
import type { PoLineItem } from "@/lib/purchase/types";
import type { Uom } from "@/lib/masters/types";
import type { TimelineRow } from "@/lib/approvals/types";

/**
 * THE SELECTED PO, BESIDE THE LIST (user 2026-11-03: "merge PO Approval and More than
 * Budget Approval in one single screen … better UI, uncomplicated, clean"; plan artifact
 * "PO Approval and More than Budget Plan", recommendations accepted).
 *
 * One column, read top to bottom: who and what (facts) → the budget verdict → the
 * lines → the approval trail. An OVER-BUDGET PO is not another screen — it is the same
 * detail with a red banner, the Purchase Manager's reason and the budget / excess
 * columns on its lines. A within-budget PO shows a green banner and nothing extra.
 *
 * Replaces the three-column `po-approval-overview.tsx` page (profile card · tiles + ring
 * · trail), which needed a full-screen sheet to fit and is gone with it.
 *
 * Budget figures reach this only for an approver (`variance` null otherwise, spec point
 * 7): a Purchase Manager sees "over budget · waiting for the MD" and no figures.
 */

type Line = PoLineItem & { garment_order_id?: string | null; iwo_id?: string | null };

export function PoApprovalDetail({
  po,
  uoms,
  sourceNos,
  variance,
  statusPill,
  timeline,
  names,
  raisedBy,
  override = false,
  decision,
}: {
  po: PoWithDetails;
  uoms: Uom[];
  sourceNos: Record<string, string>;
  /** Line id → budget rate (₹, GST-inclusive); null when the reader is not an approver. */
  variance: PoVariance | null;
  statusPill: ReactNode;
  /** The run's steps, or null when the PO has no run (sent before 0764). */
  timeline: TimelineRow[] | null;
  names: Record<string, string>;
  raisedBy: string | null;
  override?: boolean;
  /** The remark + Approve / Request Rework / Reject block, drawn by the screen. */
  decision?: ReactNode;
}) {
  const raw = po as unknown as Record<string, unknown>;
  const lines = po.lines as Line[];
  const uomCode = Object.fromEntries(uoms.map((u) => [u.id, u.code]));
  const gstPct = Number(raw.gst_pct ?? 0);
  const isImport = po.po_type === "import";
  const fx = isImport ? Number(po.exchange_rate ?? 0) || 1 : 1;

  // GST-inclusive on both sides (re-po/types.ts, 2026-10-31) — the same sums as My Approvals.
  const impact = poBudgetImpact(lines, variance ?? {}, { fx, defaultGstPct: gstPct });
  const known = !!variance;
  const overLines = known ? impact.over : [];
  const overAmt = known ? impact.profitHit : 0; // rupees
  const reason = typeof raw.budget_reason === "string" && raw.budget_reason.trim() ? raw.budget_reason : null;
  // A PM never sees figures, but a reason on the PO means it was sent above budget.
  const isOver = known ? overLines.length > 0 : !!reason;
  const unbudgeted = known ? impact.unbudgeted.length : 0;
  // The lines above budget, in rupees incl. GST: what the budget allowed, and its share of what they now cost.
  const overBudget = overLines.reduce((a, l) => a + (impact.budgetOf(l) ?? 0) * Number(l.quantity), 0);
  const budgetShare = overBudget + overAmt > 0 ? (overBudget / (overBudget + overAmt)) * 100 : 100;

  const orders = [...new Set(lines.map((l) => (l.garment_order_id ?? l.iwo_id) as string | null).filter((v): v is string => !!v))]
    .map((id) => sourceNos[id])
    .filter(Boolean);
  const classes = [...new Set(lines.map((l) => l.item_class).filter((v): v is string => !!v))];
  const printable = !["draft", "pending_approval", "cancelled"].includes(po.status);

  const facts: [string, string][] = [
    // total_amount is in rupees on every PO (an import keeps its own currency in the lines).
    ["PO value", `₹ ${fmtFixed(Number(po.total_amount ?? 0), 2)}`],
    ["Deliver by", po.expected_date ? fmtDate(po.expected_date) : "—"],
    ["Item class", classes.join(", ") || "—"],
  ];

  return (
    <div className="space-y-4">
      {/* WHO AND WHAT */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-base font-semibold text-foreground">{po.code ?? "Purchase Order"}</div>
          {/* Who raised it and when is the trail's first step ("Submitted") — not said twice. */}
          <Truncated className="block max-w-[28rem] text-sm text-muted-foreground">{po.vendor_name ?? "—"}</Truncated>
          {/* The RE No is on the list row beside this — said here only on a phone, where the list is hidden. */}
          <span className="block font-mono text-xs text-muted-foreground lg:hidden">{orders.join(", ")}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* The status box and the trail already say where it stands; only a rejected PO is pilled. */}
          {po.status === "cancelled" ? statusPill : null}
          {/* PRINT PO IS THE REPORT ICON (user 2026-11-03: "print PO as report icon will make better
              sense") — the PO list's and the DC screen's shape. Before approval it stays, greyed,
              saying why, and "Open PO" is the way in. */}
          {printable ? null : (
            <Link href={`/purchase/orders/${po.id}`} className="text-sm font-semibold text-primary hover:underline">
              Open PO
            </Link>
          )}
          {printable ? (
            <Tooltip label="Print PO">
              <Link
                href={`/purchase/orders/${po.id}/print`}
                aria-label={`Print PO ${po.code ?? ""}`}
                className={`${buttonClasses({ variant: "ghost", size: "icon" })} text-primary`}
              >
                <FileText aria-hidden />
              </Link>
            </Tooltip>
          ) : (
            <Tooltip label="Print opens once the PO is approved" touch>
              <span
                aria-disabled
                aria-label={`Print PO ${po.code ?? ""} — print opens once the PO is approved`}
                className={`${buttonClasses({ variant: "ghost", size: "icon" })} cursor-not-allowed text-muted-foreground opacity-50`}
              >
                <FileText aria-hidden />
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="m-0 text-sm font-semibold tabular-nums text-foreground">
              <Truncated className="block">{value}</Truncated>
            </dd>
          </div>
        ))}
      </dl>

      {/* THE BUDGET CARD (user 2026-11-03: the one-line banner + a separate reason strip
          "need better visual look"). Over budget: three figures for the lines above budget —
          what the budget allowed, what this PO pays, the difference — a bar of the same, and
          the Purchase Manager's reason quoted inside the card it explains. */}
      {isOver ? (
        // COMPACT AND QUIET (user 2026-11-03: "uncomplicated, clean, better colouring"): a
        // neutral card, colour only where it means something — the red icon well and the
        // excess. No colour rail (memory: colour lives in the icon well).
        <div className="flex gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger/10 text-danger" aria-hidden>
            <TrendingUp className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm text-foreground">
                {known ? (
                  <>
                    Over budget by <b className="text-danger tabular-nums">₹ {fmtFixed(overAmt, 2)}</b>
                    <span className="ml-1 text-xs font-semibold text-danger">({fmtFixed(impact.overPct, 1)}%)</span>
                  </>
                ) : (
                  <b className="text-danger">Over budget · waiting for the MD</b>
                )}
              </span>
              {known ? (
                <span className="text-xs text-muted-foreground">
                  {overLines.length} of {lines.length} line{lines.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {known ? (
              <>
                <div className="text-xs tabular-nums text-muted-foreground">
                  Budget <span className="font-semibold text-foreground">₹ {fmtFixed(overBudget, 2)}</span>
                  <span className="mx-1.5">→</span>
                  PO <span className="font-semibold text-foreground">₹ {fmtFixed(overBudget + overAmt, 2)}</span>
                </div>
                {/* Budget's share of what these lines now cost; the red rest is the excess. */}
                <div className="flex h-1.5 overflow-hidden rounded-full bg-danger/50" aria-hidden>
                  <span className="h-full rounded-full bg-primary" style={{ width: `${budgetShare}%` }} />
                </div>
              </>
            ) : null}
            {reason ? (
              <p className="m-0 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Quote aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{reason}</span> — Purchase Manager
                </span>
              </p>
            ) : null}
          </div>
        </div>
      ) : known ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/10 text-success" aria-hidden>
            <CircleCheck className="size-4" />
          </span>
          {unbudgeted === lines.length
            ? "No budget on these lines — approved on the PO alone"
            : `Within budget${unbudgeted ? ` · ${unbudgeted} line${unbudgeted === 1 ? "" : "s"} with no budget` : ""}`}
        </div>
      ) : null}

      {/* THE LINES — budget and excess columns only where they say something. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-left font-semibold">Item</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Rate</th>
              {known && isOver ? (
                <>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Budget (incl. GST)</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Excess</th>
                </>
              ) : (
                <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
              )}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {lines.map((l) => {
              const b = known ? impact.budgetOf(l) : null; // rupees, incl. GST
              const rateInr = impact.netRateOf(l) * fx;
              const over = b != null && rateInr > b + 1e-9;
              const excess = over ? (rateInr - b!) * Number(l.quantity) : 0;
              const src = l.garment_order_id ?? l.iwo_id;
              return (
                <tr key={l.id} className={cn("border-t border-border", known && isOver && !over && "text-muted-foreground")}>
                  <th scope="row" className="max-w-[18rem] px-3 py-2 text-left font-normal">
                    <Truncated className="block">{l.description}</Truncated>
                    {/* The RE under each item only when the PO spans several — one RE is already in Orders above. */}
                    {orders.length > 1 && src && sourceNos[src] ? <span className="block text-[11px] text-muted-foreground">{sourceNos[src]}</span> : null}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {fmtNumber(l.quantity)} <span className="text-[11px] text-muted-foreground">{(l.uom_id && uomCode[l.uom_id]) || ""}</span>
                  </td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right", over && "font-semibold text-danger")}>
                    {/* Compared incl. GST — the rate the budget was approved as. */}
                    {known && isOver ? fmtFixed(rateInr, 2) : fmtFixed(l.unit_price, 2)}
                  </td>
                  {known && isOver ? (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{b == null ? <span className="text-xs text-warning">No budget</span> : fmtFixed(b, 2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {over ? <span className="font-semibold text-danger">₹ {fmtFixed(excess, 2)}</span> : b == null ? "—" : <span className="text-xs text-success">within</span>}
                      </td>
                    </>
                  ) : (
                    <td className="whitespace-nowrap px-3 py-2 text-right">{fmtFixed(l.amount, 2)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {override ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          You are not an approver on this step — acting here is recorded as an override.
        </div>
      ) : null}

      {decision}

      {/* THE TRAIL, ONE LINE A STEP (user 2026-11-03: "make it uncomplicated, clean, no extra
          text"). The engine's own override sentence is not repeated — the "override" tag says
          it; a remark a person typed is still shown. */}
      <div className="space-y-1.5 border-t border-border pt-3">
        <h3 className="text-sm font-semibold text-foreground">Approval</h3>
        <ol className="space-y-1 text-sm">
          {typeof raw.created_at === "string" ? (
            <TrailLine tone="done" what="Raised" who={raisedBy} when={raw.created_at} />
          ) : null}
          {(timeline ?? []).map((r, i) => (
            <TrailLine
              key={`${r.step_order}-${i}`}
              tone={r.action === "approve" ? "done" : r.action ? "bad" : r.is_current ? "wait" : "idle"}
              what={`${r.step_label} · ${r.action ? (STEP_WORD[r.action] ?? r.action) : r.is_current ? "waiting" : "next"}`}
              who={r.actor_id ? (names[r.actor_id] ?? null) : null}
              when={r.acted_at}
              override={r.is_override}
              remark={r.comment && !/as an override/i.test(r.comment) ? r.comment : null}
            />
          ))}
        </ol>
        {/* The notes repeat the trail's remarks; shown only for a PO with no trail (sent before 0764). */}
        {po.notes && !(timeline && timeline.length > 0) ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{po.notes}</p> : null}
      </div>
    </div>
  );
}

const STEP_WORD: Record<string, string> = { approve: "approved", reject: "sent back", return: "returned" };

function TrailLine({
  tone,
  what,
  who,
  when,
  override = false,
  remark = null,
}: {
  tone: "done" | "bad" | "wait" | "idle";
  what: string;
  who: string | null;
  when: string | null;
  override?: boolean;
  remark?: string | null;
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={cn(
          "inline-block size-2 shrink-0 translate-y-[-1px] rounded-full",
          tone === "done" && "bg-success",
          tone === "bad" && "bg-danger",
          tone === "wait" && "bg-warning",
          tone === "idle" && "border border-border",
        )}
      />
      <span className="min-w-0">
        <span className="font-medium text-foreground">{what}</span>
        <span className="text-muted-foreground">
          {[who, when ? fmtDateTime(when) : null].filter(Boolean).map((t) => ` · ${t}`).join("")}
        </span>
        {override ? <span className="ml-1.5 rounded bg-warning/15 px-1.5 text-[11px] font-semibold text-warning">override</span> : null}
        {remark ? <span className="block text-xs text-muted-foreground">“{remark}”</span> : null}
      </span>
    </li>
  );
}
