"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, FileText, TriangleAlert } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { GlassRing, LegendRow, type GlassRingCentre } from "@/components/orders/budget-breakdown-chart";
import { ApprovalTrail } from "@/app/(app)/orders/budget-approval/approval-overview";
import { fmtDate, fmtDateTime, fmtFixed, fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { poBudgetImpact } from "@/lib/purchase/re-po/types";
import type { PoWithDetails } from "@/lib/purchase/po-service";
import type { PoVariance } from "@/lib/purchase/po-escalation";
import type { PoLineItem } from "@/lib/purchase/types";
import type { Uom } from "@/lib/masters/types";
import type { TimelineRow } from "@/lib/approvals/types";

/**
 * THE PO, IN ORDERS ▸ APPROVAL'S PAGE (user 2026-10-28: "take reference from the order
 * budget approval … at most match it", then the canvas "PO Approval — single page",
 * approved). `orders/budget-approval/approval-overview.tsx` piece for piece:
 *
 *   LEFT 3   the profile card  → the PO: vendor initials, PO No, vendor, pills, its facts
 *   MIDDLE 6 four compact tiles → PO value · Budget · Profit impact · the over-budget ring
 *            the GLASS RING     → where the PO money goes (the budget page's own
 *                                 `GlassRing` + `LegendRow`, so the two draw alike)
 *            Cost Lines         → the PO lines, rate beside budget
 *   RIGHT 3  Approval          → the budget page's own `ApprovalTrail`
 *            Per Piece Summary → the PO summary: the money, the lines' budget state
 *            override note, the Purchase Manager's reason
 *
 * Budget figures reach this only for an approver (`variance` null otherwise, spec
 * point 7) — the ring and tiles then speak of the PO alone.
 */

type Line = PoLineItem & { garment_order_id?: string | null; iwo_id?: string | null };

const initialsOf = (s: string | null | undefined) =>
  (s ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/* The budget page's compact tile (`TILE` in approval-overview.tsx). */
const TILE = "min-w-0 rounded-xl border border-border bg-surface px-3 py-2";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={TILE}>
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <Truncated text={value} className={cn("block text-base font-bold leading-6 tabular-nums", tone)} />
      <Truncated text={sub} className="block text-[11px] text-muted-foreground" />
    </div>
  );
}

/** The margin ring's tile, as a METER of how far over budget: 0–50% is a full turn. */
function OverTile({ pct, known }: { pct: number; known: boolean }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const over = known && pct > 0;
  const frac = Math.max(0, Math.min(1, pct / 50));
  return (
    <div className={cn(TILE, "flex items-center gap-2.5")}>
      <svg viewBox="0 0 64 64" className="size-10 shrink-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="9" className="stroke-surface-muted" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(over ? frac : known ? 1 : 0) * C} ${C}`}
          className={over ? "stroke-danger" : "stroke-success"}
        />
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-muted-foreground">Over budget</div>
        <div className={cn("text-base font-bold leading-6 tabular-nums", !known ? "text-muted-foreground" : over ? "text-danger" : "text-success")}>
          {!known ? "—" : over ? `${fmtFixed(pct, 1)}%` : "Within"}
        </div>
        <Truncated
          text={!known ? "no budget figure" : over ? "on the lines above" : "every budgeted line"}
          className={cn("block text-[11px]", over ? "text-danger" : "text-muted-foreground")}
        />
      </div>
    </div>
  );
}

function SummaryGroup({ title }: { title: string }) {
  return (
    <tr>
      <td colSpan={2} className="pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </td>
    </tr>
  );
}

function SummaryRow({ label, value, strong = false, rule = false, tone }: { label: string; value: ReactNode; strong?: boolean; rule?: boolean; tone?: string }) {
  return (
    <tr className={cn(strong && "font-semibold", tone)}>
      <td className={cn("py-0.5", rule && "border-t border-border pt-1.5")}>{label}</td>
      <td className={cn("py-0.5 text-right", rule && "border-t border-border pt-1.5")}>{value}</td>
    </tr>
  );
}

const COLOR = { within: "var(--viz-1)", over: "var(--viz-2)", gst: "var(--viz-4)", charges: "var(--viz-3)" } as const;
type SliceKey = keyof typeof COLOR;

export function PoApprovalOverview({
  po,
  uoms,
  sourceNos,
  variance,
  statusPill,
  timeline,
  names,
  raisedBy,
  override = false,
}: {
  po: PoWithDetails;
  uoms: Uom[];
  sourceNos: Record<string, string>;
  /** Line id → budget rate (₹, ex-GST); null when the reader is not an approver. */
  variance: PoVariance | null;
  statusPill: ReactNode;
  /** The run's steps, or null when the PO has no run (sent before 0764). */
  timeline: TimelineRow[] | null;
  names: Record<string, string>;
  raisedBy: string | null;
  override?: boolean;
}) {
  const [hover, setHover] = useState<SliceKey | null>(null);
  const [pinned, setPinned] = useState<SliceKey | null>(null);
  const active = hover ?? pinned;
  const pick = (k: SliceKey) => setPinned((p) => (p === k ? null : k));

  const raw = po as unknown as Record<string, unknown>;
  const lines = po.lines as Line[];
  const uomCode = Object.fromEntries(uoms.map((u) => [u.id, u.code]));
  const gstPct = Number(raw.gst_pct ?? 0);
  const gstKind = raw.gst_kind === "igst" ? "IGST" : "CGST + SGST";
  const isImport = po.po_type === "import";
  const cur = isImport ? (po.foreign_currency_code ?? "") : "₹";
  const fx = isImport ? Number(po.exchange_rate ?? 0) || 1 : 1;
  // The money, worked exactly as the PO page's review works it (one PO never reads two ways).
  const taxable = lines.reduce((a, l) => a + Number(l.amount || 0), 0);
  const gst = Math.round(taxable * gstPct) / 100;
  const fgn = (c: { inr_amount: number; fgn_amount: number }) => (isImport ? c.fgn_amount : c.inr_amount);
  const chargesNet = po.additional_charges.reduce((a, c) => a + (c.charge_type === "less" ? -1 : 1) * fgn(c), 0);
  const total = taxable + gst + chargesNet;

  const impact = poBudgetImpact(lines, variance ?? {}, { fx });
  const known = !!variance;
  const budgetOf = (l: Line) => (variance ? impact.budgetOf(l) : null);
  const budgeted = lines.filter((l) => budgetOf(l) != null);
  const budgetTotal = budgeted.reduce((a, l) => a + (budgetOf(l)! / fx) * Number(l.quantity), 0);
  const overAmt = known ? impact.profitHit / fx : 0;
  const overLines = known ? impact.over : [];
  const unbudgeted = known ? impact.unbudgeted : [];
  const reason = typeof raw.budget_reason === "string" && raw.budget_reason.trim() ? raw.budget_reason : null;

  const classes = [...new Set(lines.map((l) => l.item_class).filter((v): v is string => !!v))];
  const orders = [...new Set(lines.map((l) => (l.garment_order_id ?? l.iwo_id) as string | null).filter((v): v is string => !!v))]
    .map((id) => sourceNos[id])
    .filter(Boolean);
  const printable = !["draft", "pending_approval", "cancelled"].includes(po.status);

  /* WHERE THE PO MONEY GOES — the budget page's ring, its slices the PO's own parts. */
  const slices: { key: SliceKey; label: string; amount: number }[] = [
    { key: "within" as const, label: overAmt > 0 ? "At budget rate" : "Taxable", amount: taxable - overAmt },
    { key: "over" as const, label: "Over budget", amount: overAmt },
    { key: "gst" as const, label: `GST ${gstPct}%`, amount: gst },
    { key: "charges" as const, label: "Charges", amount: chargesNet },
  ].filter((s) => s.amount > 0);
  const base = slices.reduce((a, s) => a + s.amount, 0);
  const pctOf = (n: number) => (base > 0 ? (n / base) * 100 : 0);
  const maxPct = Math.max(1, ...slices.map((s) => pctOf(s.amount)));
  const focus = active ? slices.find((s) => s.key === active) : null;
  const money = (n: number) => (isImport ? `${cur} ${fmtFixed(n, 2)}` : fmtMoney(n));
  const centre: GlassRingCentre = focus
    ? { label: focus.label.split(" ")[0], value: `${fmtFixed(pctOf(focus.amount), 1)}%`, sub: money(focus.amount), color: COLOR[focus.key] }
    : overAmt > 0
      ? { label: "Over budget", value: `${fmtFixed(impact.overPct, 1)}%`, sub: `−${money(overAmt)} profit`, tone: "text-danger" }
      : known && budgeted.length
        ? { label: "Budget", value: "Within", sub: "every budgeted line", tone: "text-success" }
        : { label: "Taxable", value: `${fmtFixed(pctOf(taxable), 1)}%`, sub: money(taxable), tone: "" };

  return (
    <div className="grid items-start gap-3 xl:grid-cols-12">
      {/* ═══ LEFT — the PO's identity, as the profile card ═══ */}
      <div className="xl:col-span-3">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-primary-soft text-lg font-bold text-primary">
                {initialsOf(po.vendor_name) || <FileText aria-hidden className="size-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold text-foreground">{po.code ?? "Purchase Order"}</div>
                <Truncated text={po.vendor_name ?? "—"} className="block text-xs text-muted-foreground" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone="info">
                {isImport ? `Import · ${cur}` : "Local"} · {lines.length} line{lines.length === 1 ? "" : "s"}
              </StatusPill>
              {statusPill}
            </div>
            <dl className="divide-y divide-border rounded-lg border border-border">
              {(
                [
                  ["Orders", orders.join(", ") || null],
                  ["Item class", classes.join(", ") || null],
                  ["PO date", po.order_date ? fmtDate(po.order_date) : null],
                  ["Deliver by", po.expected_date ? fmtDate(po.expected_date) : null],
                  ...(isImport ? ([["Currency", `${cur} @ ₹${fmtFixed(po.exchange_rate ?? 0, 2)}`]] as [string, string][]) : []),
                  ["GST", gstPct ? `${gstPct}% · ${gstKind}` : null],
                  ["Payment", po.payment_terms ?? null],
                  ["Raised by", raisedBy],
                  ["Raised", typeof raw.created_at === "string" ? fmtDateTime(raw.created_at) : null],
                ] as [string, string | null][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
                  <dd className="m-0 min-w-0 text-right">
                    <Truncated text={value ?? "—"} className="block text-xs font-semibold text-foreground" />
                  </dd>
                </div>
              ))}
            </dl>
            <Link
              href={printable ? `/purchase/orders/${po.id}/print` : `/purchase/orders/${po.id}`}
              className="flex h-8 w-full items-center justify-center gap-1 rounded-control border border-border px-3 text-xs font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {printable ? "View the PO print" : "Open the PO page"}
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* ═══ MIDDLE — tiles, the ring, the lines ═══ */}
      <div className="min-w-0 space-y-3 xl:col-span-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="PO value" value={money(total)} sub="incl. GST" tone="text-primary" />
          <Tile
            label="Budget"
            value={known && budgeted.length ? money(budgetTotal) : "—"}
            sub={known ? `ex-GST · ${budgeted.length} of ${lines.length} line${lines.length === 1 ? "" : "s"}` : "approvers only"}
          />
          <Tile
            label="Profit impact"
            value={overAmt > 0 ? `−${money(overAmt)}` : known ? money(0) : "—"}
            sub={overAmt > 0 ? `${overLines.length} line${overLines.length === 1 ? "" : "s"} over budget` : "nothing over budget"}
            tone={overAmt > 0 ? "text-danger" : known ? "text-success" : undefined}
          />
          <OverTile pct={impact.overPct} known={known && budgeted.length > 0} />
        </div>

        {/* THE GLASS RING — `BudgetBreakdownChart`'s wide panel, its parts the PO's. */}
        <div className="relative isolate overflow-hidden rounded-[22px]" style={{ background: "var(--glass-ground)" }}>
          <span aria-hidden className="pointer-events-none absolute -left-16 -top-10 size-60 rounded-full blur-[40px]" style={{ background: "var(--glass-blob-a)" }} />
          <span aria-hidden className="pointer-events-none absolute -right-16 top-40 size-56 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-b)" }} />
          <span aria-hidden className="pointer-events-none absolute -bottom-20 left-10 h-52 w-64 rounded-full blur-[48px]" style={{ background: "var(--glass-blob-c)" }} />
          <div
            className="relative m-3 flex flex-col gap-3.5 rounded-[18px] p-4 backdrop-blur-[22px] backdrop-saturate-[1.7]"
            style={{ background: "var(--glass)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Where the PO money goes</span>
              <span className="text-[11px] text-muted-foreground">% of PO total</span>
            </div>
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:gap-6">
              <GlassRing
                className="size-[11rem] sm:size-[9.5rem]"
                slices={slices.map((s) => ({ key: s.key, amount: s.amount, color: COLOR[s.key] }))}
                base={base}
                active={active}
                onHover={(k) => setHover(k as SliceKey | null)}
                onPick={(k) => pick(k as SliceKey)}
                centre={centre}
              />
              <ul className="grid min-w-0 gap-1.5 sm:flex-1 sm:gap-1">
                {slices.map((s) => (
                  <LegendRow
                    key={s.key}
                    color={COLOR[s.key]}
                    label={s.label}
                    pct={pctOf(s.amount)}
                    amount={s.amount}
                    maxPct={maxPct}
                    inline
                    danger={s.key === "over"}
                    lifted={active === s.key}
                    dim={!!active && active !== s.key}
                    onPoint={(on) => setHover(on ? s.key : null)}
                    onPick={() => pick(s.key)}
                  />
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* THE LINES — the Cost Lines card's table. */}
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">PO Lines</h2>
            {/* FITS ITS CARD, NO SIDEWAYS SCROLL (user 2026-10-28, screenshot 3823): fixed
                columns, and the item takes what is left, cut with its reveal. The figures:
                Qty 88 + Rate 64 + Budget 72 + Over by 80 + Amount 96 = 400px, so in the
                ~730px middle column the item keeps ~330px. */}
            <div>
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-[5.5rem]" />
                  <col className="w-16" />
                  {known ? (
                    <>
                      <col className="w-[4.5rem]" />
                      <col className="w-20" />
                    </>
                  ) : null}
                  <col className="w-24" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-1.5 pr-3 text-left font-semibold">Item</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-semibold">Qty</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">Rate</th>
                    {known ? (
                      <>
                        <th scope="col" className="px-3 py-1.5 text-right font-semibold">Budget</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-semibold">Over by</th>
                      </>
                    ) : null}
                    <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {lines.map((l) => {
                    const b = budgetOf(l);
                    const bRate = b == null ? null : b / fx;
                    const diff = bRate == null ? 0 : Number(l.unit_price) - bRate;
                    const over = diff > 1e-9;
                    const src = l.garment_order_id ?? l.iwo_id;
                    return (
                      <tr key={l.id} className="border-b border-border/60">
                        <th scope="row" className="min-w-0 py-1.5 pr-3 text-left font-normal">
                          <Truncated className="block">{l.description}</Truncated>
                          <Truncated
                            text={[src ? sourceNos[src] : null, l.delivery_date ? `deliver ${fmtDate(l.delivery_date)}` : null].filter(Boolean).join(" · ")}
                            className="block text-[11px] text-muted-foreground"
                          />
                        </th>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {fmtNumber(l.quantity)} <span className="text-[11px] text-muted-foreground">{(l.uom_id && uomCode[l.uom_id]) || ""}</span>
                        </td>
                        <td className={cn("px-3 py-1.5 text-right", over && "font-semibold text-danger")}>{fmtFixed(l.unit_price, 2)}</td>
                        {known ? (
                          <>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">
                              {bRate == null ? <span className="text-xs font-semibold text-warning">No budget</span> : fmtFixed(bRate, 2)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right">
                              {bRate == null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : over ? (
                                <span className="block font-semibold text-danger">
                                  +{fmtFixed(diff, 2)}
                                  <span className="block text-[11px] font-normal">{fmtFixed((diff / bRate) * 100, 1)}%</span>
                                </span>
                              ) : (
                                <span className="text-xs text-success">Within</span>
                              )}
                            </td>
                          </>
                        ) : null}
                        <td className="py-1.5 pl-3 text-right">{fmtFixed(l.amount, 2)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface-muted font-semibold">
                    <th scope="row" colSpan={known ? 5 : 3} className="py-1.5 pr-3 pl-2 text-left">
                      Taxable
                    </th>
                    <td className="py-1.5 pr-2 pl-3 text-right">{fmtFixed(taxable, 2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ═══ RIGHT — the trail, the summary, the override ═══ */}
      <div className="space-y-3 xl:col-span-3">
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Approval</h2>
            {timeline && timeline.length > 0 ? (
              <ApprovalTrail
                rows={timeline}
                names={names}
                submitted={typeof raw.created_at === "string" ? `${raisedBy ? `${raisedBy} · ` : ""}${fmtDateTime(raw.created_at)}` : null}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Sent before approval routing — no steps to show.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">PO Summary</h2>
            <table className="w-full text-sm">
              <tbody className="tabular-nums">
                {known ? (
                  <>
                    <SummaryGroup title="Lines" />
                    <SummaryRow label="Within budget" value={budgeted.length - overLines.length} />
                    <SummaryRow label="Above budget" value={overLines.length} tone={overLines.length ? "text-danger" : undefined} />
                    <SummaryRow label="No budget" value={unbudgeted.length} tone={unbudgeted.length ? "text-warning" : undefined} />
                  </>
                ) : null}
                <SummaryGroup title="Money" />
                <SummaryRow label="Taxable" value={fmtFixed(taxable, 2)} />
                <SummaryRow label={`${gstKind} ${gstPct}%`} value={fmtFixed(gst, 2)} />
                {po.additional_charges.map((c) => (
                  <SummaryRow
                    key={c.id}
                    label={`${c.charge_type === "less" ? "Less" : "Add"} · ${c.label}`}
                    value={`${c.charge_type === "less" ? "−" : ""}${fmtFixed(fgn(c), 2)}`}
                    tone={c.charge_type === "less" ? "text-danger" : undefined}
                  />
                ))}
                <SummaryRow label="Total" value={`${cur} ${fmtFixed(total, 2)}`} strong rule />
                {isImport ? <SummaryRow label="In rupees" value={`₹ ${fmtFixed(po.total_amount, 2)}`} /> : null}
              </tbody>
            </table>
          </CardBody>
        </Card>

        {reason ? (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
            <div className="text-[11px] font-semibold text-warning">Purchase Manager&apos;s reason</div>
            <div className="text-sm font-semibold text-foreground">{reason}</div>
          </div>
        ) : null}

        {po.notes ? (
          <Card>
            <CardBody className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">History</h2>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{po.notes}</p>
            </CardBody>
          </Card>
        ) : null}

        {/* THE OVERRIDE, SAID BEFORE THE CLICK — as on the budget page. */}
        {override && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            You are not an approver on this step — acting here is recorded as an override.
          </div>
        )}
      </div>
    </div>
  );
}
