"use client";

import Link from "next/link";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Truncated } from "@/components/ui/truncated";
import { Td, Th, ReportTable, SectionCard, SheetLabel, SheetMasthead, SummaryTiles, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { totalsOf } from "@/lib/orders/season-report/derive";
import {
  FULFILMENT_LABEL,
  type SeasonDetail,
  type SeasonOrder,
  type SeasonStyleDetail,
} from "@/lib/orders/season-report/types";
import { FULFILMENT_COLOR, StatusChip, Thumb, dueText } from "./visuals";

/**
 * Orders ▸ Season Report ▸ the TEXT report — the same figures as the Overview,
 * laid out the way every other order report is (masthead → tiles → section
 * cards → ruled tables), so it can be read, printed and filed like them.
 *
 * Two formats, from the client's own brief:
 *
 *   SUMMARY   one row per order — picture, reference, buyer, delivery, pieces,
 *             status. For reviewing the season's commitments at a glance.
 *   DETAILED  each order opened out — every colourway and the pieces under
 *             every size, with the fabric the order still has to receive.
 */

type Company = { name: string | null };

function Opening({ label, orders, today, company, kind }: { label: string; orders: SeasonOrder[]; today: string; company: Company; kind: string }) {
  const t = totalsOf(orders);
  return (
    <>
      <SheetMasthead
        company={{ name: company.name }}
        kind={kind}
        reNo={label}
        meta={`${t.orders} order${t.orders === 1 ? "" : "s"} · as of ${fmtDate(today)}`}
      />
      <div className="border-x border-b border-border bg-white px-5 py-4">
        <SheetLabel>This season</SheetLabel>
        <SummaryTiles
          tiles={[
            { label: "Orders", value: t.orders, note: `${t.customers} buyer${t.customers === 1 ? "" : "s"}` },
            { label: "Pieces committed", value: fmtNumber(t.qty), unit: "pcs" },
            { label: "Shipped", value: fmtNumber(t.shippedQty), unit: "pcs", note: `${t.shippedPct}% of pieces` },
            { label: "Balance to ship", value: fmtNumber(t.balanceQty), unit: "pcs", note: t.late + t.atRisk ? `${t.late} late · ${t.atRisk} at risk` : "none late or at risk" },
          ]}
        />
      </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-white px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
  );
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

export function TextSummary({ orders, label, today, company }: { orders: SeasonOrder[]; label: string; today: string; company: Company }) {
  const t = totalsOf(orders);
  return (
    <div className="space-y-4">
      <Opening label={label} orders={orders} today={today} company={company} kind="Season Report · Summary" />
      {orders.length === 0 ? (
        <Empty>No orders match the status boxes ticked above.</Empty>
      ) : (
        <SectionCard title="Orders in the season" total={fmtNumber(t.qty)} totalLabel="Pieces">
          <ReportTable fixed bare>
            <colgroup>
              <col style={{ width: "64px" }} />
              <col style={{ width: "17%" }} />
              <col />
              <col style={{ width: "110px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "150px" }} />
            </colgroup>
            <thead>
              <tr>
                <Th>Style</Th>
                <Th>Order / Ref No</Th>
                <Th>Buyer</Th>
                <Th>Delivery</Th>
                <Th right>Total Qty</Th>
                <Th right>Shipped</Th>
                <Th right>Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const due = dueText(o, today);
                return (
                  <tr key={o.salesOrderId} style={stripeRow(i)}>
                    <Td>
                      <Thumb order={o} className="size-11 rounded-md" />
                    </Td>
                    <Td className="align-middle">
                      <Link href={`/orders/${o.salesOrderId}`} className="font-mono font-semibold text-primary hover:underline">
                        {o.reNo ?? "—"}
                      </Link>
                      {o.poNo && <span className="block text-[11px] text-muted-foreground">PO {o.poNo}</span>}
                    </Td>
                    <Td className="align-middle">
                      <Truncated>{o.customer ?? "—"}</Truncated>
                      <span className="block text-[11px] text-muted-foreground">
                        <Truncated>{o.styles.map((s) => s.styleRef).join(" · ") || "no style"}</Truncated>
                      </span>
                    </Td>
                    <Td className="align-middle">
                      <span className="whitespace-nowrap">{o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}</span>
                      <span className="block text-[11px]" style={{ color: due.bad ? "var(--danger)" : "var(--muted-foreground)" }}>
                        {due.text}
                      </span>
                    </Td>
                    <Td right mono className="align-middle font-semibold">{fmtNumber(o.qty)}</Td>
                    <Td right mono className="align-middle">{fmtNumber(o.shippedQty)}</Td>
                    <Td right mono className="align-middle">{fmtNumber(o.balanceQty)}</Td>
                    <Td className="align-middle">
                      <StatusChip f={o.fulfilment} />
                      {(o.riskLevel === "late" || o.riskLevel === "at_risk") && (
                        <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: o.riskLevel === "late" ? "var(--danger)" : "var(--warning)" }}>
                          {o.riskLabel}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
              <tr className="font-semibold" style={totalRowStyle()}>
                <Td colSpan={4} className="font-semibold">TOTAL · {t.orders} order{t.orders === 1 ? "" : "s"}</Td>
                <Td right mono className="font-semibold">{fmtNumber(t.qty)}</Td>
                <Td right mono className="font-semibold">{fmtNumber(t.shippedQty)}</Td>
                <Td right mono className="font-semibold">{fmtNumber(t.balanceQty)}</Td>
                <Td>{""}</Td>
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DETAILED
// ---------------------------------------------------------------------------

/** A heat tint under a size cell — the bigger the run, the deeper the blue. */
function heat(v: number | null, max: number): React.CSSProperties | undefined {
  if (!v || max <= 0) return undefined;
  return { background: `color-mix(in oklab, var(--primary) ${Math.round(6 + (v / max) * 24)}%, white)` };
}

function StyleMatrix({ s }: { s: SeasonStyleDetail }) {
  const max = Math.max(0, ...s.rows.flatMap((r) => r.cells.map((c) => c ?? 0)));
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-[#fafbfc] px-3.5 py-2">
        <span className="min-w-0 text-[12.5px]">
          <b className="font-mono">{s.styleRef}</b>
          {s.styleCode && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{s.styleCode}</span>}
          {(s.description || s.articleNo) && (
            <span className="ml-2 text-muted-foreground">{[s.description, s.articleNo ? `Art ${s.articleNo}` : null].filter(Boolean).join(" · ")}</span>
          )}
        </span>
        <span className="font-mono text-[12px] font-semibold tabular-nums">{fmtNumber(s.total || s.qty)} pcs</span>
      </div>
      {s.refused ? (
        <p className="px-3.5 py-3 text-[12px] text-muted-foreground">{s.refused}</p>
      ) : (
        <ReportTable bare>
          <thead>
            <tr>
              <Th>Combo / Colour</Th>
              {s.columns.map((c) => (
                <Th key={c} right>{c}</Th>
              ))}
              <Th right>Total</Th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={r.combo} style={stripeRow(i)}>
                <Td className="font-medium">{r.combo || "—"}</Td>
                {r.cells.map((c, k) => (
                  <Td key={s.columns[k]} right mono className={c == null ? "text-muted-foreground/60" : ""}>
                    <span className="-mx-2 -my-1 block px-2 py-1" style={heat(c, max)}>
                      {c == null ? "·" : fmtNumber(c)}
                    </span>
                  </Td>
                ))}
                <Td right mono className="font-semibold">{fmtNumber(r.total)}</Td>
              </tr>
            ))}
            <tr className="font-semibold" style={totalRowStyle()}>
              <Td className="font-semibold">TOTAL</Td>
              {s.columnTotals.map((c, k) => (
                <Td key={s.columns[k]} right mono className="font-semibold">{fmtNumber(c)}</Td>
              ))}
              <Td right mono className="font-semibold">{fmtNumber(s.total)}</Td>
            </tr>
          </tbody>
        </ReportTable>
      )}
    </div>
  );
}

function FabricStrip({ o }: { o: SeasonOrder }) {
  const f = o.fabric;
  const kg = (v: number | null) => (v == null ? "—" : `${fmtNumber(v)} kg`);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-[#fafbfc] px-3.5 py-2 text-[12px]">
      <span className="text-[11px] font-bold uppercase tracking-[.1em] text-[#4a5563]">Fabric</span>
      <span>Required <b className="font-mono tabular-nums">{kg(f.requiredKg)}</b></span>
      <span>Received <b className="font-mono tabular-nums">{kg(f.receivedKg)}</b></span>
      <span>
        Balance to receive{" "}
        <b className="font-mono tabular-nums" style={{ color: f.balanceKg != null && f.balanceKg > 0 ? "var(--warning)" : undefined }}>
          {kg(f.balanceKg)}
        </b>
      </span>
      {f.note && <span className="text-muted-foreground">{f.note}</span>}
    </div>
  );
}

export function TextDetailed({
  orders,
  details,
  loading,
  failures,
  loadError,
  label,
  today,
  company,
}: {
  orders: SeasonOrder[];
  details: ReadonlyMap<string, SeasonDetail>;
  loading: boolean;
  failures: ReadonlyMap<string, string>;
  loadError: string | null;
  label: string;
  today: string;
  company: Company;
}) {
  return (
    <div className="space-y-4">
      <Opening label={label} orders={orders} today={today} company={company} kind="Season Report · Detailed" />
      {loadError && (
        <p className="rounded-lg border border-border bg-white px-4 py-3 text-sm" style={{ color: "var(--danger)" }}>
          {loadError}
        </p>
      )}
      {orders.length === 0 ? (
        <Empty>No orders match the status boxes ticked above.</Empty>
      ) : (
        orders.map((o) => {
          const d = details.get(o.salesOrderId);
          const due = dueText(o, today);
          return (
            <SectionCard
              key={o.salesOrderId}
              title={
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/orders/${o.salesOrderId}`} className="font-mono hover:underline">{o.reNo ?? "—"}</Link>
                  <span className="font-sans font-medium opacity-80">{o.customer ?? "—"}</span>
                </span>
              }
              total={fmtNumber(o.qty)}
              totalLabel="Pieces"
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-border px-3.5 py-2 text-[12px]">
                <Thumb order={o} className="size-10 rounded-md" />
                <StatusChip f={o.fulfilment} />
                <span>Delivery <b>{o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}</b> <span style={{ color: due.bad ? "var(--danger)" : "var(--muted-foreground)" }}>· {due.text}</span></span>
                {o.poNo && <span>PO <b className="font-mono">{o.poNo}</b></span>}
                <span>Shipped <b className="font-mono tabular-nums">{fmtNumber(o.shippedQty)}</b> · Balance <b className="font-mono tabular-nums">{fmtNumber(o.balanceQty)}</b></span>
                {o.merchandiser && <span className="text-muted-foreground">{o.merchandiser}</span>}
              </div>
              {d ? (
                d.styles.length ? (
                  <>
                    {d.styles.map((s) => (
                      <StyleMatrix key={s.styleRef} s={s} />
                    ))}
                    {d.orphanQty > 0 && (
                      <p className="border-t border-border px-3.5 py-2 text-[12px]" style={{ color: "var(--warning)" }}>
                        {fmtNumber(d.orphanQty)} pcs on this order name no declared style, so they sit in no matrix above.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="px-3.5 py-3 text-[12px] text-muted-foreground">This order has no style entered yet.</p>
                )
              ) : failures.has(o.salesOrderId) ? (
                <p className="px-3.5 py-3 text-[12px]" style={{ color: "var(--danger)" }}>{failures.get(o.salesOrderId)}</p>
              ) : (
                <p className="px-3.5 py-3 text-[12px] text-muted-foreground">{loading ? "Loading the colour and size breakdown…" : "Breakdown not loaded."}</p>
              )}
              <FabricStrip o={o} />
            </SectionCard>
          );
        })
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        {(["shipped", "partial", "in_production", "pending"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: FULFILMENT_COLOR[k] }} />
            {FULFILMENT_LABEL[k]}
          </span>
        ))}
        <span>· “·” in a size column = no break-up declared for that size (not zero).</span>
      </p>
    </div>
  );
}
