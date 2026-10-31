"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePo, declinePo, rejectPo, submitPo } from "@/lib/purchase/po-actions";
import type { PoWithDetails } from "@/lib/purchase/po-service";
import type { PoVariance } from "@/lib/purchase/po-escalation";
import { poBudgetImpact } from "@/lib/purchase/re-po/types";
import { PO_STATUS_LABELS, type PoLineItem } from "@/lib/purchase/types";
import type { Uom } from "@/lib/masters/types";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A PO RAISED ON RAISE PO, ON ONE SCREEN (user 2026-10-26: "after PO screen
 * showing PO items, below approve or reject or revise option, in single screen —
 * not like this 4 tab"). Read top to bottom the way the MD decides:
 *
 *   the PO's facts (vendor, dates, GST, terms) → its commercial terms → the
 *   items it orders → the money → the decision.
 *
 * Nothing is edited here. Rates, quantities and the Commercial terms are typed on
 * Raise PO BEFORE the PO is sent, so what the MD approves is what was sent.
 *
 * THE THREE WORDS:
 * - **Approve** → approved; printing opens.
 * - **Revise** → back to draft with the MD's note (`rejectPo`, its old name kept).
 * - **Reject** → closed for good (`declinePo`), reason required; the requirement
 *   goes back on Raise PO's Pending list.
 *
 * POs made on Purchase Orders keep the tabbed `PoDetail` — they have item groups,
 * deliveries and lines added on the page, which this screen does not.
 */

type ReviewLine = PoLineItem & {
  garment_order_id?: string | null;
  iwo_id?: string | null;
};

const COMMERCIAL: { key: keyof PoWithDetails; label: string }[] = [
  { key: "pay_mode", label: "Pay Mode" },
  { key: "ship_mode", label: "Ship Mode" },
  { key: "ship_type", label: "Ship Type" },
  { key: "place_of_delivery", label: "Place of Delivery" },
  { key: "invoice_send_to", label: "Invoice Send To" },
  { key: "vat_against", label: "VAT/GST Against" },
  { key: "duty_against", label: "Duty Against" },
  { key: "freight_type", label: "Freight Type" },
];

/** One fact on the facts LINE — a muted label and its value, inline (user 2026-10-28,
 *  screenshot 3818: label-over-value pairs took two tall rows for five facts). */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function PoReview({
  po,
  uoms,
  sourceNos,
  canEdit,
  canApprove,
  variance = null,
  statusPill,
}: {
  po: PoWithDetails;
  uoms: Uom[];
  /** order / work-order id → its RE / SWO / IWO number. */
  sourceNos: Record<string, string>;
  canEdit: boolean;
  canApprove: boolean;
  /** Line id → budget rate in RUPEES (null: no approved budget). Null: not an approver. */
  variance?: PoVariance | null;
  /** The status, drawn by the page (its tone table) and placed on the card's title line. */
  statusPill?: React.ReactNode;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  useUnsavedGuard(!!note.trim() || isPending);

  const raw = po as unknown as Record<string, unknown>;
  const gstPct = Number(raw.gst_pct ?? 0);
  const gstKind = raw.gst_kind === "igst" ? "IGST" : "CGST + SGST";
  const isImport = po.po_type === "import";
  /* An import PO's lines are in its own currency; the INR total is the header's. */
  const cur = isImport ? (po.foreign_currency_code ?? "") : "₹";
  const fgn = (c: { inr_amount: number; fgn_amount: number }) => (isImport ? c.fgn_amount : c.inr_amount);

  const lines = po.lines as ReviewLine[];
  const uomCode = Object.fromEntries(uoms.map((u) => [u.id, u.code]));
  const lineNo = new Map(lines.map((l, i) => [l.id, i + 1]));
  const taxable = lines.reduce((a, l) => a + Number(l.amount || 0), 0);
  const gst = Math.round(taxable * gstPct) / 100;
  const charges = po.additional_charges;
  const chargesNet = charges.reduce((a, c) => a + (c.charge_type === "less" ? -1 : 1) * fgn(c), 0);
  const total = taxable + gst + chargesNet;

  const pendingMd = po.status === "pending_approval";
  const isDraft = po.status === "draft";
  const received = lines.some((l) => Number(l.received_qty) > 0);
  const commercial = COMMERCIAL.filter((c) => raw[c.key as string]);

  /* BUDGET vs QUOTED (above-budget escalation, user 2026-10-27). The budget is in rupees;
     an import line's rate is in its own currency, so the budget is shown in the PO's
     currency and the money it costs is counted in rupees. Every rupee a line pays above
     its budget rate comes straight off the order's profit, so that sum IS the impact. */
  const fx = isImport ? Number(po.exchange_rate ?? 0) || 1 : 1;
  /* THE BUDGET RATE INCLUDES GST (user 2026-10-31, re-po/types.ts): it is compared with the
     line's rate plus its GST, shown under the Rate, so the same lines read "above" here as on
     Raise PO. */
  // One calculation with the My Approvals card (`poBudgetImpact`, 0764).
  const impact = poBudgetImpact(lines, variance ?? {}, { fx, defaultGstPct: gstPct });
  const budgetOf = (l: ReviewLine) => (variance ? impact.budgetOf(l) : null);
  const overLines = variance ? impact.over : [];
  const unbudgetedLines = variance ? impact.unbudgeted : [];
  const { profitHit, overPct } = impact;
  const reason = typeof raw.budget_reason === "string" && raw.budget_reason.trim() ? raw.budget_reason : null;

  const columns: Column<ReviewLine>[] = [
    { header: "#", align: "right", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{lineNo.get(r.id)}</span> },
    {
      header: "RE / SWO / IWO",
      cell: (r) => {
        const src = r.garment_order_id ?? r.iwo_id;
        return <span className="font-mono text-xs">{(src && sourceNos[src]) || "—"}</span>;
      },
    },
    {
      // The class rides under the item (user 2026-10-28): a column of PACKING ACCESSORIES on
      // every line was a column of one word.
      header: "Item",
      cell: (r) => (
        <div className="min-w-0">
          <Truncated className="block text-sm">{r.description}</Truncated>
          {r.item_class ? <span className="block text-xs text-muted-foreground">{r.item_class}</span> : null}
        </div>
      ),
    },
    { header: "Delivery", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.delivery_date)}</span> },
    {
      // The unit beside its number, not a column of its own.
      header: "Qty",
      align: "right",
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums text-sm">
          {fmtNumber(r.quantity)} <span className="text-xs text-muted-foreground">{(r.uom_id && uomCode[r.uom_id]) || ""}</span>
        </span>
      ),
    },
    {
      header: `Rate (${cur})`,
      align: "right",
      // The basic rate, and under it the rate with GST — the figure the budget is held to.
      cell: (r) => (
        <span className="block whitespace-nowrap tabular-nums text-sm">
          {fmtFixed(r.unit_price, 2)}
          {variance ? <span className="block text-xs text-muted-foreground">incl. GST {fmtFixed(impact.netRateOf(r), 2)}</span> : null}
        </span>
      ),
    },
    ...(variance
      ? [
          {
            // GST-inclusive, as the "incl. GST" figure under the Rate.
            header: `Budget incl. GST (${cur})`,
            align: "right" as const,
            cell: (r: ReviewLine) => {
              const b = budgetOf(r);
              return b == null ? (
                <span className="text-xs font-semibold text-[#b54708]">No budget</span>
              ) : (
                <span className="tabular-nums text-sm text-muted-foreground">{fmtFixed(b / fx, 2)}</span>
              );
            },
          },
          {
            header: "Over by",
            align: "right" as const,
            cell: (r: ReviewLine) => {
              const b = budgetOf(r);
              if (b == null) return <span className="text-xs text-muted-foreground">—</span>;
              const diff = impact.netRateOf(r) - b / fx;
              return diff > 1e-9 ? (
                <span className="block whitespace-nowrap tabular-nums text-sm font-semibold text-danger">
                  +{fmtFixed(diff, 2)}
                  <span className="block text-xs font-normal">{fmtFixed((diff / (b / fx)) * 100, 1)}%</span>
                </span>
              ) : (
                <span className="text-xs text-success">Within</span>
              );
            },
          },
        ]
      : []),
    { header: `Amount (${cur})`, align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtFixed(r.amount, 2)}</span> },
    ...(received
      ? [{ header: "Received", align: "right" as const, cell: (r: ReviewLine) => <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span> }]
      : []),
  ];

  function run(act: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    startTransition(async () => {
      const res = await act();
      if (!res.ok) return toastError(res.error);
      setNote("");
      success(done);
      router.refresh();
    });
  }

  const money = (
    <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-sm tabular-nums">
      <dt className="text-muted-foreground">Taxable</dt>
      <dd className="text-right">{cur} {fmtFixed(taxable, 2)}</dd>
      <dt className="text-muted-foreground">{gstKind} {gstPct}%</dt>
      <dd className="text-right">{cur} {fmtFixed(gst, 2)}</dd>
      {charges.map((c) => (
        <div key={c.id} className="contents">
          <dt className="text-muted-foreground">
            {c.charge_type === "less" ? "Less" : "Add"} · {c.label}
          </dt>
          <dd className={cn("text-right", c.charge_type === "less" && "text-danger")}>
            {c.charge_type === "less" ? "−" : ""}{cur} {fmtFixed(fgn(c), 2)}
          </dd>
        </div>
      ))}
      <dt className="border-t border-[#dde4eb] pt-1 font-bold">Total</dt>
      <dd className="border-t border-[#dde4eb] pt-1 text-right text-base font-bold">{cur} {fmtFixed(total, 2)}</dd>
      {isImport ? (
        <>
          <dt className="text-xs text-muted-foreground">In rupees</dt>
          <dd className="text-right text-xs text-muted-foreground">₹ {fmtFixed(po.total_amount, 2)}</dd>
        </>
      ) : null}
    </dl>
  );

  /* COMPACT, ONE CARD (user 2026-10-28, screenshot 3818, plan agreed): title line → facts
     line → one budget line → the items → remarks beside the money, buttons under it. As
     wide as its content (~70rem), not the pane. */
  return (
    <div className="max-w-[70rem] rounded-xl border border-[#dde4eb] bg-white">
      {/* TITLE — the PO number, its status and the vendor on one line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
        <h2 className="font-mono text-base font-bold">{po.code ?? "Purchase Order"}</h2>
        {statusPill}
        <span className="ml-auto truncate text-sm font-semibold">{po.vendor_name ?? "—"}</span>
      </div>
      {/* FACTS — one line, wrapping only when the commercial terms are many. */}
      <dl className="flex flex-wrap gap-x-5 gap-y-1 px-4 pt-1.5 pb-3">
        <Fact label="PO date">{fmtDate(po.order_date)}</Fact>
        <Fact label="Deliver by">{fmtDate(po.expected_date)}</Fact>
        <Fact label="Type">
          {isImport ? `Import · ${po.foreign_currency_code ?? ""} @ ₹${fmtFixed(po.exchange_rate ?? 0, 2)}` : "Local"}
        </Fact>
        <Fact label="GST">{gstPct ? `${gstPct}% · ${gstKind}` : "—"}</Fact>
        <Fact label="Payment">{po.payment_terms ?? "—"}</Fact>
        {commercial.map((c) => (
          <Fact key={c.key as string} label={c.label}>
            <span className="uppercase">{String(raw[c.key as string])}</span>
          </Fact>
        ))}
      </dl>

      {/* WHY THIS PO IS WITH THE MD (escalation spec §2) — ONE line: how many lines, what
          they take off the order's profit, and the Purchase Manager's reason. The lines
          themselves are the red ones in the table, so they are not listed again. */}
      {variance && (overLines.length > 0 || unbudgetedLines.length > 0) ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[#f5d9a8] bg-[#fffaf0] px-4 py-2 text-sm">
          {overLines.length > 0 ? (
            <span>
              <span className="font-semibold text-[#b54708]">
                ▲ {overLines.length} line{overLines.length === 1 ? "" : "s"} above budget
              </span>
              {" · "}
              <span className="font-semibold text-danger tabular-nums">profit −₹ {fmtFixed(profitHit, 2)}</span>
              <span className="text-muted-foreground tabular-nums"> ({fmtFixed(overPct, 1)}%)</span>
            </span>
          ) : null}
          {unbudgetedLines.length > 0 ? (
            <span className="font-semibold text-[#b54708]">
              {unbudgetedLines.length} line{unbudgetedLines.length === 1 ? "" : "s"} with no approved budget
            </span>
          ) : null}
          <span>
            <span className="text-muted-foreground">Reason: </span>
            {reason ?? <span className="text-muted-foreground">none given</span>}
          </span>
        </div>
      ) : null}

      {/* THE ITEMS — the PO is a document, so every line shows (no pager). */}
      <div className="border-t border-[#dde4eb]">
        <DataTable paginate={false} bare columns={columns} rows={lines} getKey={(r) => r.id} empty="This PO has no lines." />
      </div>

      {po.notes ? (
        <div className="border-t border-[#dde4eb] px-4 py-2 text-sm">
          <span className="text-xs text-muted-foreground">History </span>
          <span className="whitespace-pre-wrap">{po.notes}</span>
        </div>
      ) : null}

      {/* THE DECISION — remarks on the left, the money on the right with the buttons under it. */}
      <div
        data-focus-region="footer"
        className="sticky bottom-0 z-10 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-b-xl border-t border-[#dde4eb] bg-white px-4 py-3 md:-bottom-6"
      >
        <div className="min-w-64 flex-1">
          {pendingMd && canApprove ? (
            <Field label="Remarks — needed to Revise or Reject" htmlFor="po-md-note">
              <Textarea id="po-md-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">
              {pendingMd
                ? "Waiting for MD approval."
                : isDraft
                  ? "Draft — not sent yet."
                  : `${PO_STATUS_LABELS[po.status]}${po.approved_at ? ` on ${fmtDate(po.approved_at)}` : ""}.`}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2.5">
          {money}
          {pendingMd && canApprove ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isPending || !note.trim()}
                title={note.trim() ? undefined : "Write what to change in the remarks"}
                onClick={() => run(() => rejectPo(po.id, note.trim()), "Sent back for revision")}
              >
                Revise
              </Button>
              <Button
                type="button"
                variant="outline"
                className="text-danger"
                disabled={isPending || !note.trim()}
                title={note.trim() ? undefined : "Write the reason in the remarks"}
                onClick={() => run(() => declinePo(po.id, note), "Purchase order rejected")}
              >
                Reject
              </Button>
              <Button type="button" disabled={isPending} onClick={() => run(() => approvePo(po.id), "Purchase order approved")}>
                Approve
              </Button>
            </div>
          ) : isDraft && canEdit ? (
            <Button type="button" disabled={isPending} onClick={() => run(() => submitPo(po.id), "Sent for approval")}>
              Submit for approval
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
