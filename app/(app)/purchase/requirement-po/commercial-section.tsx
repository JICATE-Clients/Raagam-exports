"use client";

import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Field } from "@/components/ui/field";
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
  /** One small box per term — 32px, 13px type, as wide as its value and no wider. */
  const BOX = "h-8 text-[13px]";
  const text = (key: TextKey, label: string, w: string) => (
    <Field key={key} label={label} htmlFor={`rpo-com-${key}`} className={w}>
      <Input id={`rpo-com-${key}`} className={BOX} value={value[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </Field>
  );

  /*
   * EVERY TERM IN VIEW, EACH ONLY AS WIDE AS ITS VALUE (user 2026-10-26: "reduce
   * the field widths … all the fields should be visible inside the desktop, fit —
   * compact the width"; a fold was tried and was not the ask). The 5-column grid
   * stretched every box to a fifth of the pane (~240px for a "CASH"); now each
   * takes a width sized to what goes in it, so the ten wrap into two short lines.
   *
   * THE CHARGES PANE IS 27rem BECAUSE THE GRID IS 420px. ChildGrid's table carries
   * `min-w-[420px]`; at 19rem (304px) it scrolled sideways and the Type cell read
   * "A…" (screenshot 2026-10-26 104334). 432px clears it with nothing to scroll.
   */
  return (
    <div className="flex flex-col gap-4 border-t border-[#dde4eb] px-4 py-3 lg:flex-row lg:items-start">
      <section aria-label="Commercial terms" className="min-w-0 flex-1">
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Commercial</h3>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <Field label="GST" required htmlFor="rpo-gst" className="w-[10rem]">
            <Select id="rpo-gst" required className={BOX} value={gst} onChange={(e) => onGst(e.target.value)}>
              {gstOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment Terms" htmlFor="rpo-terms" className="w-[11rem]">
            <Input id="rpo-terms" className={BOX} value={terms} onChange={(e) => onTerms(e.target.value)} />
          </Field>
          {text("pay_mode", "Pay Mode", "w-[6.5rem]")}
          {text("vat_against", "VAT/GST Against", "w-[7.5rem]")}
          {text("duty_against", "Duty Against", "w-[6.5rem]")}
          {text("ship_mode", "Ship Mode", "w-[6.5rem]")}
          {text("ship_type", "Ship Type", "w-[6.5rem]")}
          <Field label="Freight Type" htmlFor="rpo-com-freight" className="w-[8.5rem]">
            <Select
              id="rpo-com-freight"
              className={BOX}
              value={value.freight_type}
              onChange={(e) => set({ freight_type: e.target.value as CommercialValue["freight_type"] })}
            >
              <option value=""></option>
              <option value="itemwise">Itemwise</option>
              <option value="consolidated">Consolidated</option>
            </Select>
          </Field>
          {text("place_of_delivery", "Place of Delivery", "w-[9rem]")}
          {text("invoice_send_to", "Invoice Send To", "w-[9rem]")}
        </div>
      </section>
      <section aria-label="Additional charges" className="w-full lg:w-[27rem] lg:shrink-0">
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
