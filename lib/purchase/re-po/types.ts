import { z } from "zod";

/**
 * PURCHASE ORDER FROM AN RE'S REQUIREMENT (doc/purchase/puchase.md, 0737).
 *
 * The Purchase Manager picks one or more RE numbers; every requirement line
 * those REs still have to buy lists itself in its PURCHASE unit with the
 * balance; the manager types the rate. Pure — no `server-only` — so the screen
 * and the save action read one set of rules.
 */

/** Where a requirement comes from (0740): a garment order's Material BOM, an IWO's
 *  accessories plan, or a sample work order's (SWO, bought through its SIW). */
export type SourceKind = "re" | "iwo" | "swo";
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = { re: "RE", iwo: "IWO", swo: "SWO" };

/** One requirement still to buy (`po_requirement_lines`, 0737 · 0740). */
export type RequirementLine = {
  source_kind: SourceKind;
  /** The garment order (RE) or the IWO — what the screen picks and groups by. */
  source_id: string;
  /** What the operator reads: "HO/RE/26-27/0013", "HO/IWO/2627/0003", "SWO/26-27/0001 · SIW/26-27/0002". */
  source_no: string;
  garment_order_id: string | null;
  iwo_id: string | null;
  sales_order_id: string | null;
  re_no: string | null;
  customer: string | null;
  delivery_date: string | null;
  item_id: string;
  item_name: string;
  item_class_id: string | null;
  item_class: string | null;
  /** The item master's category (0748) — the PO header's Category narrows to it. */
  category_id: string | null;
  category: string | null;
  slice_label: string;
  colour: string | null;
  /** item | slice | colour, upper-cased — what a PO line remembers it by. */
  req_key: string;
  uom_id: string | null;
  uom_code: string | null;
  required_qty: number;
  ordered_qty: number;
  balance_qty: number;
  /** The requirement's own size (0757) — NULL on an IWO / SWO line, whose plan has no size. */
  size_id: string | null;
  size_name: string | null;
  /** The order's size sequence, else the size-group master's; NULL sorts last. */
  size_sort: number | null;
  /** The slice without its size ("WHITE · L" → "WHITE") — Raise PO groups sizes on it. */
  slice_base: string;
};

/** A bought-item vendor of one item class (`po_vendors_for_class`, 0737). */
export type ClassVendor = {
  id: string;
  code: string | null;
  name: string;
  lead_days: number | null;
  /** On or before the promised date, over every received line. NULL = no history yet. */
  on_time_pct: number | null;
  received_lines: number;
};

/** One requirement line's identity across the screen and the action. */
export const lineKeyOf = (l: Pick<RequirementLine, "source_id" | "req_key">) =>
  `${l.source_id}::${l.req_key}`;

/** What a requirement line is called on the PO: item · slice · colour. */
export function lineDescription(l: Pick<RequirementLine, "item_name" | "slice_label" | "colour">): string {
  const slice = l.slice_label.trim();
  const colour = l.colour?.trim() ?? "";
  const parts = [l.item_name, slice];
  // The colour only where the slice does not already say it — a tape's slice IS its
  // colour, and a colour-and-size slice reads "WHITE · L" (screenshot 3692 showed
  // "WHITE · L · WHITE").
  const sliceParts = slice.toUpperCase().split("·").map((x) => x.trim());
  if (colour && !sliceParts.includes(colour.toUpperCase())) parts.push(colour);
  return parts.filter(Boolean).join(" · ");
}

/**
 * A LINE'S NOTE RIDES ON ITS DESCRIPTION (user 2026-10-26: "Main Label (Process: Cut &
 * Seal)"). `po_line_items.description` is what the PO print, the GRN, QC and the store
 * logs already read, so the note is appended there once, at save, and reaches all of
 * them; the note alone is also kept in `po_line_items.note` (0755).
 */
export function withNote(description: string, note: string | null | undefined): string {
  const n = note?.trim();
  return n ? `${description} (${n})` : description;
}

/**
 * GST slabs (spec point 4: "selects applicable GST tax structures"). CGST + SGST
 * for a vendor in the same state, IGST for one outside it. Labels kept SHORT — the
 * header is one row (2026-10-23) and the GST box is 176px; the split (6 + 6) is
 * the slab halved, so it need not be spelt out.
 */
export const GST_SLABS = [
  { id: "c5", pct: 5, kind: "cgst_sgst", label: "5% · CGST+SGST" },
  { id: "c12", pct: 12, kind: "cgst_sgst", label: "12% · CGST+SGST" },
  { id: "c18", pct: 18, kind: "cgst_sgst", label: "18% · CGST+SGST" },
  { id: "i5", pct: 5, kind: "igst", label: "5% · IGST" },
  { id: "i12", pct: 12, kind: "igst", label: "12% · IGST" },
  { id: "i18", pct: 18, kind: "igst", label: "18% · IGST" },
] as const;
export type GstSlabId = (typeof GST_SLABS)[number]["id"];
export const gstSlab = (id: string) => GST_SLABS.find((g) => g.id === id) ?? GST_SLABS[1];

/**
 * A LINE'S OWN GST % (user 2026-10-26, 0756). One PO carries thread at 5 %, labels at
 * 12 %, polybags at 18 % — so the slab is chosen per line. CGST+SGST vs IGST is NOT: it
 * is the vendor's state, the same for every line, and stays on the header slab above,
 * whose % is the default a line follows until it is changed.
 */
export const LINE_GST_PCTS = [0, 5, 12, 18] as const;

/**
 * WHAT A LINE IS BOUGHT IN (user 2026-10-26, Task 2). Yarn comes in whole bags, fabric
 * by weight with its rolls and dia; anything else is counted. Read off the item class's
 * NAME — the same test the screen's "Wt (Kg)" wording uses.
 */
export type LineKind = "yarn" | "fabric" | "general";
export function lineKindOf(itemClass: string | null | undefined): LineKind {
  if (/\byarn\b/i.test(itemClass ?? "")) return "yarn";
  if (/\bfabric\b/i.test(itemClass ?? "")) return "fabric";
  return "general";
}

/**
 * WHOLE BAGS ROUND UP — BY LESS THAN ONE BAG (user decision 2026-10-26; 0758 enforces
 * the same in `po_line_requirement_cap`). To Order 115 kg in 50 kg bags → at most 3.
 */
export function maxBags(balance: number, bagWeight: number): number {
  return bagWeight > 0 ? Math.max(0, Math.ceil(balance / bagWeight - 1e-9)) : 0;
}

/** May this quantity be ordered against `balance`? Over only by whole bags, and by less than one. */
export function qtyAllowed(qty: number, balance: number, bags: number | null, bagWeight: number | null): boolean {
  if (qty <= balance + 1e-4) return true;
  return (
    bagWeight != null && bagWeight > 0 && bags != null && Math.abs(qty - bags * bagWeight) < 1e-3 && qty - balance < bagWeight - 1e-4
  );
}

/** Spec point 6: never above the balance, never below nothing. */
export function capQty(typed: number, balance: number): number {
  if (!Number.isFinite(typed) || typed < 0) return 0;
  return Math.min(typed, balance);
}

const money = (n: number) => Math.round(n * 100) / 100;

/** GST on one line — its own slab, else the PO's default (0756). */
export function lineGst(l: { qty: number; rate: number; gstPct?: number | null }, defaultPct: number): number {
  return l.qty > 0 && l.rate > 0 ? money((l.qty * l.rate * (l.gstPct ?? defaultPct)) / 100) : 0;
}

/** Taxable, GST and total for the PO, in the PO's own currency — GST summed line by line. */
export function poTotals(
  lines: readonly { qty: number; rate: number; gstPct?: number | null }[],
  defaultPct: number,
): { taxable: number; gst: number; total: number } {
  const taxable = money(lines.reduce((a, l) => a + (l.qty > 0 && l.rate > 0 ? l.qty * l.rate : 0), 0));
  const gst = money(lines.reduce((a, l) => a + lineGst(l, defaultPct), 0));
  return { taxable, gst, total: money(taxable + gst) };
}

export const rePoLineInput = z.object({
  source_id: z.string().uuid(),
  req_key: z.string().min(1),
  qty: z.number().min(0),
  rate: z.number().min(0).nullable(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Delivery date is required"),
  /** Yarn (0758): whole bags and the kg in one; qty is their product. Both or neither. */
  bags: z.number().int().min(0).nullish().transform((v) => v ?? null),
  bag_weight: z.number().positive().nullish().transform((v) => v ?? null),
  /** Fabric (0758): rolls and dia. */
  rolls: z.number().int().min(0).nullish().transform((v) => v ?? null),
  dia: z
    .string()
    .trim()
    .max(20, "Dia is at most 20 characters")
    .toUpperCase()
    .nullish()
    .transform((v) => v || null),
  /** This line's GST % (0756); null / absent = the PO's default slab. */
  gst_pct: z
    .number()
    .refine((n) => (LINE_GST_PCTS as readonly number[]).includes(n), "GST must be 0, 5, 12 or 18 %")
    .nullish()
    .transform((v) => v ?? null),
  /** The item-level instruction to the vendor (0755) — capitals, blank → null. Optional, so
      a caller that predates it still saves. */
  note: z
    .string()
    .trim()
    .max(200, "A note is at most 200 characters")
    .toUpperCase()
    .nullish()
    .transform((v) => v || null),
});

/** A free-text commercial term: trimmed, capitals, blank → null. */
const rePoText = z
  .string()
  .trim()
  .max(200)
  .toUpperCase()
  .nullable()
  .transform((v) => v || null);

export const rePoInput = z
  .object({
    source_ids: z.array(z.string().uuid()).min(1, "Choose at least one RE / SWO / IWO"),
    vendor_id: z.string().uuid({ message: "Choose the vendor" }),
    po_type: z.enum(["local", "import"]),
    currency_code: z.string().nullable(),
    exchange_rate: z.number().positive().nullable(),
    gst: z.string(),
    payment_terms: z.string().trim().max(200).nullable(),
    /* The Commercial section (user 2026-10-26: before the MD, not after). Optional so
       a caller that predates it still saves; text is stored in capitals (AGENTS CAPITALS). */
    commercial: z
      .object({
        pay_mode: rePoText,
        ship_mode: rePoText,
        ship_type: rePoText,
        place_of_delivery: rePoText,
        invoice_send_to: rePoText,
        vat_against: rePoText,
        duty_against: rePoText,
        freight_type: z.enum(["itemwise", "consolidated"]).nullable(),
      })
      .optional(),
    charges: z
      .array(z.object({ kind: z.enum(["add", "less"]), label: z.string().trim().min(1).max(120).toUpperCase(), amount: z.number().positive() }))
      .default([]),
    lines: z.array(rePoLineInput).min(1, "There is nothing to order"),
  })
  .superRefine((v, ctx) => {
    if (v.po_type === "import" && (!v.currency_code || !v.exchange_rate)) {
      ctx.addIssue({ code: "custom", message: "An import PO needs its currency and exchange rate", path: ["currency_code"] });
    }
  });
export type RePoInput = z.infer<typeof rePoInput>;
export type RePoLineInput = z.infer<typeof rePoLineInput>;

/**
 * ONE EARLIER PURCHASE OF AN ITEM — Show Last PO (user 2026-10-26, Task 3). What the
 * Purchase Manager negotiates against: the rate agreed, with whom, when, and how much.
 * Never the budget figure — that stays hidden (spec point 7).
 */
export type LastPurchase = {
  poId: string;
  code: string | null;
  orderDate: string | null;
  status: string;
  vendor: string | null;
  /** The PO's currency — INR, or the import PO's foreign currency the rate is in. */
  currency: string;
  /** The rate on that PO; when its lines (sizes) were priced apart, the lowest and highest. */
  rateMin: number;
  rateMax: number;
  qty: number;
  uom: string | null;
};

/**
 * THE LAST RATE AN ITEM WAS BOUGHT AT — pre-fills the Rate box (user 2026-10-27: "while
 * putting PO for second time for same item fetch and show the last entered rate"). The
 * chosen vendor's own last rate when it has one (`sameVendor`), else the latest from any
 * vendor. Only in the PO's currency — an INR rate is no starting point for a USD PO.
 */
export type LastRate = {
  rate: number;
  currency: string;
  sameVendor: boolean;
  vendor: string | null;
  code: string | null;
  orderDate: string | null;
};

/** What the hidden budget check tells the screen — never the budget figure. */
export type BudgetFlag = { key: string; hasBudget: boolean; above: boolean };

/** A PO raised on Raise PO — a row of its Updated / Draft lists (`listRaisedPos`). */
export type RaisedPo = {
  id: string;
  code: string | null;
  status: string;
  order_date: string | null;
  total_amount: number;
  master_vendor_id: string | null;
  vendor: string | null;
  /** RE / SWO / IWO numbers its lines were ordered against. */
  source_nos: string[];
  customers: string[];
  created_at: string | null;
  created_by: string | null;
};
