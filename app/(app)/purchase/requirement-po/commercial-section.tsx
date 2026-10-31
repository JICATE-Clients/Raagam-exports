"use client";

import type { ReactNode } from "react";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fmtFixed } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * THE PO'S COMMERCIAL TERMS, ON RAISE PO (user 2026-10-26: the PO page's
 * Commercial tab was filled AFTER the PO had gone to the MD — "need to move it
 * before sending MD approval … in Raise PO after giving rate"). The MD now
 * approves a PO whose terms are already on it, and the PO page shows them read
 * only.
 *
 * GST and Payment Terms lead it (moved off the title row, user 2026-10-26); PO
 * Type, currency and exchange rate stay on the title and filter rows. The same
 * `purchase_orders` columns the old tab wrote, and the same
 * `po_additional_charges` rows, so the PO page and its print read them unchanged.
 *
 * Charges are in the PO's own currency, like the rates; an Add raises the total,
 * a Less lowers it. A blank end row instead of "+ Add" (AGENTS "Tab lands on
 * fields"); the save drops it (`chargesToSave`).
 */

export type ChargeRow = { key: string; kind: "add" | "less"; label: string; amount: string };

export type CommercialValue = {
  pay_mode: string;
  ship_mode: string;
  ship_type: string;
  place_of_delivery: string;
  invoice_send_to: string;
  vat_against: string;
  duty_against: string;
  freight_type: "" | "itemwise" | "consolidated";
  charges: ChargeRow[];
};

let seq = 0;
const blankCharge = (): ChargeRow => ({ key: `c${++seq}`, kind: "add", label: "", amount: "" });
/** Blank = nothing TYPED: Add is the factory's default, so `kind` is not evidence. */
const chargeBlank = (c: ChargeRow) => !c.label.trim() && !(Number(c.amount) > 0);

export const blankCommercial = (): CommercialValue => ({
  pay_mode: "",
  ship_mode: "",
  ship_type: "",
  place_of_delivery: "",
  invoice_send_to: "",
  vat_against: "",
  duty_against: "",
  freight_type: "",
  charges: [blankCharge()],
});

/** Add − Less, in the PO's currency. */
export const chargesNet = (v: CommercialValue) =>
  v.charges.reduce((a, c) => a + (c.kind === "less" ? -1 : 1) * (Number(c.amount) || 0), 0);

/** The rows worth saving — a charge needs a description and an amount. */
export const chargesToSave = (v: CommercialValue) =>
  v.charges
    .filter((c) => c.label.trim() && Number(c.amount) > 0)
    .map((c) => ({ kind: c.kind, label: c.label.trim().toUpperCase(), amount: Number(c.amount) }));

/** The free-text terms — every field of `CommercialValue` but the select and the charges. */
type TextKey = Exclude<keyof CommercialValue, "freight_type" | "charges">;


const CELL = "h-7 rounded-none text-[13px] border-0 bg-transparent shadow-none focus-visible:ring-2 focus-visible:ring-inset";

export function CommercialSection({
  value,
  onChange,
  currency,
  gst,
  gstOptions,
  gstHint,
  onGst,
  terms,
  onTerms,
}: {
  value: CommercialValue;
  onChange: (next: CommercialValue) => void;
  /** "₹" or the import currency — what the charge amounts are in. */
  currency: string;
  /* GST and Payment Terms lead the section (user 2026-10-26: moved off the title
     row "inside of the commercial screen"). Their state stays the form's — the
     totals and the budget check read GST. */
  gst: string;
  gstOptions: { value: string; label: string }[];
  /** Why the slab is CGST + SGST or IGST (the vendor's state vs the unit's), under the box. */
  gstHint?: string | null;
  onGst: (v: string) => void;
  terms: string;
  onTerms: (v: string) => void;
}) {
  const set = (patch: Partial<CommercialValue>) => onChange({ ...value, ...patch });
  const setCharge = (key: string, patch: Partial<ChargeRow>) =>
    set({ charges: value.charges.map((c) => (c.key === key ? { ...c, ...patch } : c)) });

  const chargeColumns: ChildGridColumn<ChargeRow>[] = [
    {
      /* "Add" / "Less" in full — the 72px `num` step clipped it to "A…" (screenshot 3718). */
      header: "Type",
      width: "5rem",
      cell: (c) => (
        <Select
          aria-label="Add or less"
          className={cn(CELL, "font-semibold", c.kind === "less" ? "text-danger" : "text-[#3f7d17]")}
          value={c.kind}
          onChange={(e) => setCharge(c.key, { kind: e.target.value === "less" ? "less" : "add" })}
        >
          <option value="add">Add</option>
          <option value="less">Less</option>
        </Select>
      ),
    },
    {
      header: "Charge",
      cell: (c) => (
        <Input
          aria-label="Charge description"
          placeholder="CHARGE"
          className={CELL}
          value={c.label}
          onChange={(e) => setCharge(c.key, { label: e.target.value })}
        />
      ),
    },
    {
      header: `Amount ${currency}`,
      align: "right",
      width: "6rem",
      cell: (c) => (
        <Input
          type="number"
          placeholder="0.00"
          min={0}
          inputMode="decimal"
          aria-label="Charge amount"
          className={cn(CELL, "text-right tabular-nums")}
          value={c.amount}
          onChange={(e) => setCharge(c.key, { amount: e.target.value })}
        />
      ),
    },
  ];

  const net = chargesNet(value);
  /** A cell you type in, not a box in a cell — the same cell the Items grid uses. */
  const TCELL =
    "h-9 w-full min-w-0 rounded-none border-0 bg-transparent px-2 text-[13px] shadow-none hover:bg-[#f2f7fb] focus:bg-white focus-visible:ring-2 focus-visible:ring-inset";
  const text = (key: TextKey, label: string) => (
    <Input id={`rpo-com-${key}`} aria-label={label} className={cn(TCELL, "text-ellipsis")} value={value[key]} onChange={(e) => set({ [key]: e.target.value })} />
  );
  /** The ten terms, in the order the operator reads them. GST is the one required. */
  const terms_: { key: string; label: string; required?: boolean; cell: ReactNode }[] = [
    {
      key: "gst",
      label: "GST",
      required: true,
      cell: (
        <div>
          <Select
            id="rpo-gst"
            aria-label="GST"
            aria-describedby={gstHint ? "rpo-gst-hint" : undefined}
            required
            className={TCELL}
            value={gst}
            onChange={(e) => onGst(e.target.value)}
          >
            {gstOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {gstHint ? (
            <p id="rpo-gst-hint" className="px-2 pb-1 text-[11px] leading-tight text-muted-foreground">
              {gstHint}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "terms",
      label: "Payment Terms",
      cell: <Input id="rpo-terms" aria-label="Payment Terms" className={cn(TCELL, "text-ellipsis")} value={terms} onChange={(e) => onTerms(e.target.value)} />,
    },
    { key: "pay_mode", label: "Pay Mode", cell: text("pay_mode", "Pay Mode") },
    { key: "vat_against", label: "VAT/GST Against", cell: text("vat_against", "VAT/GST Against") },
    { key: "duty_against", label: "Duty Against", cell: text("duty_against", "Duty Against") },
    { key: "ship_mode", label: "Ship Mode", cell: text("ship_mode", "Ship Mode") },
    { key: "ship_type", label: "Ship Type", cell: text("ship_type", "Ship Type") },
    {
      key: "freight",
      label: "Freight Type",
      cell: (
        <Select
          id="rpo-com-freight"
          aria-label="Freight Type"
          className={TCELL}
          value={value.freight_type}
          onChange={(e) => set({ freight_type: e.target.value as CommercialValue["freight_type"] })}
        >
          <option value=""></option>
          <option value="itemwise">Itemwise</option>
          <option value="consolidated">Consolidated</option>
        </Select>
      ),
    },
    { key: "place_of_delivery", label: "Place of Delivery", cell: text("place_of_delivery", "Place of Delivery") },
    { key: "invoice_send_to", label: "Invoice Send To", cell: text("invoice_send_to", "Invoice Send To") },
  ];

  /*
   * THE TERMS ARE ONE TABLE, ONE TERM PER ROW (user 2026-10-27: "single table …
   * vertical", after ten headings across was tried in mockup 3y7eAYAH4wFUdFwXEYPiz5).
   * It replaces the wrapping row of labelled boxes, which broke into two uneven lines.
   * The name on the left, the cell you type in on the right; 30rem wide, so the
   * charges sit beside it on a desktop and under it on a phone.
   *
   * THE CHARGES PANE IS 27rem BECAUSE THE GRID IS 420px. ChildGrid's table carries
   * `min-w-[420px]`; at 19rem (304px) it scrolled sideways and the Type cell read
   * "A…" (screenshot 2026-10-26 104334). 432px clears it with nothing to scroll.
   */
  return (
    <div className="flex flex-col gap-4 px-4 py-3 lg:flex-row lg:items-start">
      <section aria-label="Commercial terms" className="w-full min-w-0 lg:w-[30rem] lg:shrink-0">
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Commercial</h3>
        <div className="overflow-hidden rounded-lg border border-[#dde4eb]">
          <table className="w-full table-fixed border-collapse text-[13px]">
            <tbody>
              {terms_.map((t) => (
                <tr key={t.key} className="border-b border-[#dde4eb] last:border-b-0">
                  <th
                    scope="row"
                    className="w-[11rem] border-r border-[#dde4eb] bg-[var(--table-head-bg)] px-3 text-left align-middle text-[11px] font-semibold tracking-wide uppercase"
                  >
                    {t.label}
                    {t.required ? (
                      <span aria-hidden className="text-danger">
                        *
                      </span>
                    ) : null}
                  </th>
                  <td className="p-0">{t.cell}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-label="Additional charges" className="w-full lg:w-[27rem]">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Add / Less charges</h3>
          {net !== 0 ? (
            <span className={cn("text-xs font-semibold tabular-nums", net < 0 ? "text-danger" : "text-[#3f7d17]")}>
              {net > 0 ? "+" : "−"} {currency} {fmtFixed(Math.abs(net), 2)}
            </span>
          ) : null}
        </div>
        <ChildGrid<ChargeRow>
          columns={chargeColumns}
          rows={value.charges}
          tableAlways
          hideIndex
          /* COMPACT (user 2026-10-26: "Add / Less charges — compact it"): no header
             band — the placeholders name the cells — and 28px rows. */
          hideHeader
          onAdd={() => set({ charges: [...value.charges, blankCharge()] })}
          tailRow={chargeBlank}
          onRemove={(c) => set({ charges: value.charges.filter((x) => x.key !== c.key) })}
        />
      </section>
    </div>
  );
}
