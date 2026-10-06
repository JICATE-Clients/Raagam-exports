/**
 * Sample ▸ Samples & Development ▸ Sample Entry — vocabulary, editable shapes,
 * the save rules and the wire schema (doc/sample/sample-module-specification.md).
 *
 * One document, two halves (spec §1): SAMPLE INFO (the legacy "Create
 * Opportunities" — enquiry header + style lines) and PRODUCT INFO (the legacy
 * "Define Styles" — per style line: merchandising, fabric, delivery, billing,
 * Combos and, when Billable, Quantities). Stored on `opportunities` + `styles`
 * and their child tables (0683).
 *
 * PURE ON PURPOSE: no server-only import, so the screen, the Save button and the
 * server action read the SAME `sampleEntryProblems` — the "one declaration,
 * several enforcers" shape `missingRequiredMaterialFields` set (AGENTS.md
 * "Mandatory fields").
 */
import { z } from "zod";
import type { AttachmentKind, AttachmentRow } from "@/components/ui/file-attachments";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
import { COORDINATE_LIMITS, coordinateCountMessage, isUnitKind, type UnitKind } from "@/lib/orders/styles/rules";
import {
  assortBalanceMessage,
  assortTotal as balanceTotal,
  crossTabPoQtyMessage,
  lineQty,
  ratioTotal,
  type AssortMode,
} from "@/lib/orders/amendments/qty-balance";

// ---------------------------------------------------------------------------
// Vocabularies. `value` is what is STORED (the CHECK constraints in 0368 / 0683);
// `label` is the spec's word. Where the spec's word differs from the stored one
// (By Mail ↔ EMAIL) the stored vocabulary wins, because Cost Sheets, Quotes and
// the Opportunities screen read the same columns.
// ---------------------------------------------------------------------------
type Opt<T extends string> = { value: T; label: string };

export const ENQUIRY_AGAINST = [
  { value: "customer_request", label: "Customer Request" },
  { value: "sales_meeting", label: "Sales Meeting" },
  { value: "new_development", label: "New Development" },
] as const satisfies readonly Opt<string>[];

export const ENQUIRY_ACTIONS = [
  { value: "quote", label: "Quote" },
  { value: "development", label: "Development" },
  { value: "quote_development", label: "Quote and Development" },
] as const satisfies readonly Opt<string>[];

/* SEASON IS NOT A VOCABULARY HERE ANY MORE (client 2026-10-06): it is a row of
   the Season master (`seasons`, Master Data ▸ System ▸ Season), the quarterly
   buying cycles Q1–Q4 — `header.season_id`. 0686 copies the master's name into
   the old `season` text for the screens that still read it. */

/** Received / Receipt Mode — the spec's words over 0368's stored codes. */
export const RECEIPT_MODES = [
  { value: "EMAIL", label: "By Mail" },
  { value: "COURIER", label: "By Courier" },
  { value: "DIRECT", label: "Hand Delivery" },
] as const satisfies readonly Opt<string>[];

/** Delivery To — free text on both tables, so the stored value is the word.
 *  OFF THE SCREEN since 2026-10-06 (client); kept so a value an older entry
 *  holds still validates as it passes through a save. */
export const DELIVERY_TO = [
  { value: "AGENT", label: "Agent" },
  { value: "CUSTOMER DIRECT", label: "Customer Direct" },
  { value: "BUYING HOUSE", label: "Buying House" },
] as const satisfies readonly Opt<string>[];

/** Delivery Mode — the spec's words over 0368's stored codes. */
export const DELIVERY_MODES = [
  { value: "COURIER", label: "By Courier" },
  { value: "AIR", label: "Air Freight" },
  { value: "SEA", label: "Sea Freight" },
] as const satisfies readonly Opt<string>[];

export const TECH_PACK = [
  { value: "not_required", label: "Not Required" },
  { value: "received", label: "Received" },
  { value: "to_be_received", label: "To be Received" },
] as const satisfies readonly Opt<string>[];

/** Ship Mode on a billable sample (spec §4.3). COURIER joined the CHECK in 0683. */
export const SHIP_MODES = [
  { value: "AIR", label: "Air" },
  { value: "SEA", label: "Sea" },
  { value: "COURIER", label: "Courier" },
] as const satisfies readonly Opt<string>[];

/**
 * The Sample's attachment kinds (0686) — the `kinds` FileAttachments offers.
 * The component's value set is Order Entry's, so the Tech Pack rides in the
 * `order_sheet` slot ON SCREEN and is stored as `tech_pack` (`sample_style_files`
 * CHECK): mapped once at load (service.ts) and once at save (below).
 */
export const SAMPLE_FILE_KINDS: { value: AttachmentKind; label: string }[] = [
  { value: "sketch", label: "Garment Image" },
  { value: "order_sheet", label: "Tech Pack" },
];

export function labelOf(xs: readonly Opt<string>[], v: string | null | undefined): string {
  return xs.find((x) => x.value === v)?.label ?? (v ?? "");
}

// ---------------------------------------------------------------------------
// Editable shapes (the screen's state). Every value a field holds is a string,
// "" meaning blank — the shape an <input> gives back.
// ---------------------------------------------------------------------------
export type SampleHeaderDraft = {
  received_date: string;
  enquiry_against: string;
  enquiry_action: string;
  customer_id: string | null;
  /** DERIVED from the customer master (spec §3.1 "Country: Text (Auto)"). */
  country_id: string | null;
  /** A Season master row (0686) — Q1 … Q4. */
  season_id: string | null;
  season_year: string;
  /** NOT ON SCREEN since 2026-10-06 (client: Cust Ref removed) — carried so an
   *  older entry's value survives a save unchanged. */
  customer_reference: string;
  /** A VENDOR (0686): Service Provider ▸ Buying Agent / Service Agent. */
  agent_id: string | null;
  receipt_mode: string;
  /** Receipt Dt — moved onto the header beside Received Mode (client
   *  2026-10-06); every line inherits it. */
  receipt_date: string;
  /** Not on screen since 2026-10-06 — carried like `customer_reference`. */
  delivery_to: string;
  delivery_mode: string;
  /** Order Entry's "Multi Order" switch (0685): each destination names its own
   *  buyer PO in a PO No column. */
  multi_order: boolean;
};

export type CoordinateDraft = { key: string; coordinate_id: string | null };

/** A combo (colourway) and its size-wise piece counts, keyed by size name.
 *  NO EXTRA QTY (client 2026-10-06): the total pieces wanted are typed straight
 *  into the size matrix, so the matrix total IS the combo's quantity. */
export type ComboDraft = { key: string; combo: string; sizes: Record<string, string> };

/**
 * One line of a destination's Assortment — Order Entry's `AssortLineRow`
 * (0685). `style_ref` is the line's style BY NAME and is read only on a
 * Multiple Style pack ("" = the destination's own style). `no_of_cartons` and
 * `inners_per_carton` are the ratio-pack counts: on an assorted-size type the
 * size cells are a RATIO and pieces = cartons x (inners) x the ratio's sum.
 */
export type AssortLineDraft = {
  key: string;
  style_ref: string;
  combo: string;
  no_of_cartons: string;
  inners_per_carton: string;
  sizes: Record<string, string>;
};

export type QuantityDraft = {
  key: string;
  country_id: string | null;
  ref_no: string;
  consignee_id: string | null;
  assortment_type_id: string | null;
  po_qty: string;
  delivery_date: string;
  earlier_shipment_date: string;
  discharge_port_id: string | null;
  final_destination_id: string | null;
  pack: string;
  no_of_cartons: string;
  master_carton_name: string;
  /** The buyer PO this destination belongs to — shown while Multi Order is on. */
  po_no: string;
  /** What one size ratio fills on an assorted-size pack ("" = not said yet). */
  ratio_for: "" | "master" | "inner";
  /** Order Entry's Single Style / Multiple Style switch on the Assortment. */
  is_single_style_pack: boolean;
  lines: AssortLineDraft[];
};

/**
 * A style line AND its Product Info — one row of `styles`.
 *
 * THE INHERITED FIELDS (`customer_reference`, `receipt_mode`, `receipt_date`,
 * `delivery_to`, `agent_id`, `delivery_mode`) hold "" / null to mean "as the
 * header says" (spec §2.3, Data Inheritance). `effectiveStyle` resolves them, and
 * the RESOLVED value is what is saved — so a header changed after a style was
 * added still reaches every style that never overrode it.
 */
export type StyleDraft = {
  key: string;
  id: string | null;
  sample_no: string | null;
  name: string;
  article_no: string;
  description: string;
  /** BLANK until answered, and required (Order Entry's Order Unit, 7924): a
   *  default PCS reads as an answer nobody gave. */
  unit_kind: UnitKind | "";
  sample_qty: string;
  delivery_date: string;
  merchandiser_id: string | null;
  order_date: string;
  fabric_structure_id: string | null;
  fabric_id: string | null;
  gsm: string;
  tech_pack: string;
  customer_reference: string;
  receipt_mode: string;
  receipt_date: string;
  delivery_to: string;
  agent_id: string | null;
  delivery_mode: string;
  delivery_through: string;
  accessories_reqd: boolean;
  billable: boolean;
  ship_type_id: string | null;
  ship_mode: string;
  currency_code: string | null;
  price: string;
  /** Billable only (0686). Local Value = Price × Exchange Rate, derived. */
  exchange_rate: string;
  /** Garment images + the buyer's tech pack (0686, `sample_style_files`). */
  files: AttachmentRow[];
  coordinates: CoordinateDraft[];
  sizes: string[];
  combos: ComboDraft[];
  quantities: QuantityDraft[];
};

/** The six Product Info fields that fall back to the header. */
export const INHERITED = [
  "customer_reference",
  "receipt_mode",
  "receipt_date",
  "delivery_to",
  "agent_id",
  "delivery_mode",
] as const;
export type InheritedField = (typeof INHERITED)[number];

/** The header value an un-overridden style line shows and saves. */
export function headerValueFor(h: SampleHeaderDraft, f: InheritedField): string {
  switch (f) {
    case "receipt_date":
      return h.receipt_date;
    case "agent_id":
      return h.agent_id ?? "";
    default:
      return h[f] ?? "";
  }
}

export function effectiveValue(s: StyleDraft, h: SampleHeaderDraft, f: InheritedField): string {
  const own = s[f] ?? "";
  return own !== "" ? own : headerValueFor(h, f);
}

// ---------------------------------------------------------------------------
// Blank rows. A grid opens with one seeded row (AGENTS.md "Editable sub-tables
// open with a row"), so the save side owes a filter testing ONLY what the
// operator types — never a defaulted field (unit_kind, billable), which would be
// "the constant true wearing the shape of evidence".
// ---------------------------------------------------------------------------
const hasQty = (r: Record<string, string>) => Object.values(r).some((v) => v.trim() !== "");

export const isBlankStyle = (s: StyleDraft) =>
  !s.name.trim() && !s.article_no.trim() && !s.description.trim() && !s.sample_qty.trim() && !s.delivery_date;
export const isBlankCombo = (c: ComboDraft) => !c.combo.trim() && !hasQty(c.sizes);
export const isBlankAssortLine = (l: AssortLineDraft) =>
  !l.combo.trim() && !hasQty(l.sizes) && !l.no_of_cartons.trim() && !l.inners_per_carton.trim();
export const isBlankQuantity = (q: QuantityDraft) =>
  !q.country_id &&
  !q.ref_no.trim() &&
  !q.consignee_id &&
  !q.po_qty.trim() &&
  !q.delivery_date &&
  !q.discharge_port_id &&
  !q.final_destination_id &&
  q.lines.every(isBlankAssortLine);

const num = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : 0;
};

/** Spec §5.2 — Sample Order Qty is the sum of the combo's size quantities. */
export const comboOrderQty = (c: ComboDraft, sizes: string[]) => sizes.reduce((t, z) => t + num(c.sizes[z] ?? ""), 0);

/**
 * BILLABLE: Local Value = Sample Unit Price × Exchange Rate (client
 * 2026-10-06). DERIVED, NEVER STORED — Order Entry's INR Value rule: a column
 * holding the product of two stored columns is a third number that can
 * disagree. Null until both halves are there, so a half-typed line shows
 * nothing rather than a zero that reads as a price.
 */
export function sampleLocalValue(s: Pick<StyleDraft, "price" | "exchange_rate">): number | null {
  const p = num(s.price);
  const r = num(s.exchange_rate);
  return p > 0 && r > 0 ? Math.round(p * r * 1e4) / 1e4 : null;
}
/**
 * ORDER ENTRY'S ASSORTMENT ARITHMETIC, NOT A COPY OF IT — `qty-balance.ts` is a
 * pure module (no imports), so the screen and the server read the one rule:
 *   Solid Colour / Solid Size     Qty = sum of the size cells
 *   any assorted-size type        Qty = cartons x (inners if Ratio For = Inner)
 *                                       x sum of the size cells (a RATIO)
 * These adapters only reshape a Sample line (sizes keyed by name) into
 * Order Entry's `BalanceRow`.
 */
const toBalanceLine = (l: AssortLineDraft) => ({
  no_of_cartons: l.no_of_cartons,
  inners_per_carton: l.inners_per_carton,
  sizes: Object.values(l.sizes).map((qty) => ({ qty })),
});
const toBalanceRow = (q: QuantityDraft) => ({
  po_qty: q.po_qty,
  ratio_for: q.ratio_for,
  assort_lines: q.lines.map(toBalanceLine),
});
/** Order Entry's `assortModeOf`: code `solid_solid` is solid, any other code an
 *  assorted pack; without a code, a name reading "assort... size" is assorted. */
export function sampleAssortMode(t: { code?: string | null; name: string } | null | undefined): AssortMode | null {
  if (!t) return null;
  if (t.code) return t.code === "solid_solid" ? "solid" : "assort";
  return /assort\s*size/i.test(t.name) ? "assort" : "solid";
}
export const assortRatioTotal = (l: AssortLineDraft) => ratioTotal(toBalanceLine(l));
export const assortLineQty = (q: QuantityDraft, l: AssortLineDraft, mode: AssortMode) =>
  lineQty(toBalanceRow(q), toBalanceLine(l), mode);
export const assortTotal = (q: QuantityDraft, mode: AssortMode) => balanceTotal(toBalanceRow(q), mode);
export const sampleAssortBalanceMessage = (q: QuantityDraft, mode: AssortMode, who: string) =>
  assortBalanceMessage(toBalanceRow(q), mode, who);
/** STARTED = a piece count typed, never merely a combo NAMED. Opening the
 *  Assortment seeds one line per combo with its name filled in, so a test on
 *  `isBlankAssortLine` read an untouched sheet as a started one — Done refused
 *  and the entry's Save was blocked by "holds 0 pcs" on a sheet nobody typed
 *  in (found 2026-10-06 in the browser). */
export const assortStarted = (q: QuantityDraft) => q.lines.some((l) => hasQty(l.sizes) || !!l.no_of_cartons.trim());

// ---------------------------------------------------------------------------
// What stops a Save, and where (the `sectionValidity` `extra` list).
// ---------------------------------------------------------------------------
export type SampleSection = "info" | "styles" | "product" | "combos" | "quantities";
export type SampleProblem = {
  section: SampleSection;
  /** The style line the problem sits on — the screen switches to it first. */
  styleKey?: string;
  /** A DOM id to land on once the section and the style are showing. */
  fieldId?: string;
  label: string;
  message: string;
  /** TRUE = waived by Save as Draft. A draft still needs what makes it a
   *  record at all — a Date, a Customer, named styles and named combos. */
  strict: boolean;
};

const styleName = (s: StyleDraft, i: number) => s.name.trim() || `style ${i + 1}`;

/**
 * THE SAVE RULES — read by the screen (problems, Save gate, blocked-Save jump)
 * and by `saveSampleEntry` on the server. Rules that one `required` prop
 * already states (a blank Customer, Style Name, Merchandiser…) are here too:
 * the rail shows ONE section at a time, so a blank field on a section that is
 * not mounted has no DOM node to hold the cursor, and only this list can name
 * it (raagam-screen-layout, "Sections").
 */
export function sampleEntryProblems(
  h: SampleHeaderDraft,
  all: StyleDraft[],
  opts: {
    draft?: boolean;
    /** The Assortment Type's mode (`sampleAssortMode` over the lookups). The
     *  server has no lookups, so it passes nothing and skips the mode rules. */
    modeOf?: (assortmentTypeId: string | null) => AssortMode | null;
  } = {},
): SampleProblem[] {
  const out: SampleProblem[] = [];
  const add = (p: SampleProblem) => out.push(p);
  if (!h.received_date) add({ section: "info", fieldId: "se-date", label: "Date", message: "Enter the Date.", strict: false });
  if (!h.customer_id)
    add({ section: "info", fieldId: "se-customer", label: "Customer", message: "Choose the Customer.", strict: false });

  const styles = all.filter((s) => !isBlankStyle(s));
  if (styles.length === 0)
    add({ section: "styles", label: "Styles", message: "Add at least one style to the sample entry.", strict: false });

  styles.forEach((s, i) => {
    const who = styleName(s, i);
    const at = { styleKey: s.key };
    if (!s.name.trim())
      add({ section: "styles", ...at, fieldId: `se-st-name-${s.key}`, label: "Style Name", message: `Line ${i + 1}: enter the Style Name.`, strict: false });
    if (!(num(s.sample_qty) > 0))
      add({ section: "styles", ...at, fieldId: `se-st-qty-${s.key}`, label: "Sample Qty", message: `${who}: enter the Sample Qty.`, strict: true });
    /* ORDER ENTRY'S UNIT RULES, IN ORDER ENTRY'S WORDS (user 2026-10-06: "the
       logic from order entry order module") — `styleLineProblems` in
       lib/orders/styles/rules.ts, and the count sentence is ITS function, so
       the two screens cannot word one limit two ways. */
    if (!s.unit_kind)
      add({ section: "styles", ...at, fieldId: `se-st-unit-${s.key}`, label: "Unit", message: `${who}: Order Unit is required — Pcs or Set.`, strict: true });
    if (!s.coordinates.some((c) => !!c.coordinate_id))
      add({ section: "styles", ...at, label: "Coordinates", message: `${who}: Name at least one coordinate.`, strict: true });
    else {
      const count = coordinateCountMessage(s.unit_kind, s.coordinates);
      if (count) add({ section: "styles", ...at, label: "Coordinates", message: `${who}: ${count}`, strict: true });
    }
    const ids = s.coordinates.map((c) => c.coordinate_id).filter(Boolean);
    if (new Set(ids).size !== ids.length)
      add({ section: "styles", ...at, label: "Coordinates", message: `${who}: a coordinate is listed twice.`, strict: true });
    if (s.sizes.length === 0)
      add({ section: "styles", ...at, fieldId: `se-st-sizes-${s.key}`, label: "Sizes", message: `${who}: Tick at least one size.`, strict: true });

    if (!s.merchandiser_id)
      add({ section: "product", ...at, fieldId: "se-pi-merch", label: "Merchandiser", message: `${who}: choose the Merchandiser.`, strict: true });
    if (s.billable) {
      if (!s.currency_code)
        add({ section: "product", ...at, fieldId: "se-pi-currency", label: "Currency", message: `${who} is billable: choose the Currency.`, strict: true });
      if (!(num(s.price) > 0))
        add({ section: "product", ...at, fieldId: "se-pi-price", label: "Price", message: `${who} is billable: enter the Price.`, strict: true });
      // Order Entry's Ex-Rate rule: blank or 0 is missing (INR fills 1).
      if (!(num(s.exchange_rate) > 0))
        add({ section: "product", ...at, fieldId: "se-pi-exrate", label: "Exchange Rate", message: `${who} is billable: enter the Exchange Rate.`, strict: true });
    }

    const combos = s.combos.filter((c) => !isBlankCombo(c));
    combos.forEach((c, ci) => {
      if (!c.combo.trim())
        add({ section: "combos", ...at, fieldId: `se-cb-name-${c.key}`, label: "Combo", message: `${who}, combo line ${ci + 1}: name the colour.`, strict: false });
    });
    const names = combos.map((c) => c.combo.trim().toUpperCase()).filter(Boolean);
    if (new Set(names).size !== names.length)
      add({ section: "combos", ...at, label: "Combo", message: `${who}: a combo colour is listed twice.`, strict: true });

    /* ORDER ENTRY'S QUANTITIES RULES, IN ITS WORDS (`quantityProblems`,
       garment-order-screen.tsx) — `who` is the destination's style, which is
       what Order Entry's Ref No names. */
    if (s.billable) {
      const started = s.quantities.filter((q) => !isBlankQuantity(q));
      for (const q of started) {
        const req = (ok: unknown, label: string) => {
          if (!ok) add({ section: "quantities", ...at, label, message: `${who}: ${label} is required.`, strict: true });
        };
        req(q.country_id, "Country");
        req(q.consignee_id, "Consignee");
        req(q.assortment_type_id, "Assortment Type");
        req(num(q.po_qty) > 0, "PO Qty");
        req(q.delivery_date, "Delivery Dt");
        req(q.earlier_shipment_date, "Earlier Shipment Dt");
        const mode = opts.modeOf?.(q.assortment_type_id) ?? null;
        if (!q.is_single_style_pack) {
          const n = q.lines.filter((l) => hasQty(l.sizes) && !l.style_ref.trim()).length;
          if (n)
            add({
              section: "quantities", ...at, label: "Assortment", strict: true,
              message: `${who}: ${n === 1 ? "one assortment line has" : `${n} assortment lines have`} quantities but name no style. Open Details and pick a Style, or switch back to Single Style.`,
            });
        }
        if (mode === "assort" && assortStarted(q)) {
          if (!q.ratio_for)
            add({
              section: "quantities", ...at, label: "Ratio For", strict: true,
              message: `${who}: say whether the size ratio fills an INNER bundle or the MASTER carton — the two give piece counts a factor of the inner count apart.`,
            });
          if (q.lines.some((l) => hasQty(l.sizes) && !(num(l.no_of_cartons) > 0)))
            add({
              section: "quantities", ...at, label: "Ctns", strict: true,
              message: `${who}: one assortment line has a ratio but no carton count, so it multiplies out to nothing. Open Details and enter Ctns.`,
            });
        }
        if (mode) {
          const bal = sampleAssortBalanceMessage(q, mode, who);
          if (bal) add({ section: "quantities", ...at, label: "Assortment", message: bal, strict: true });
        }
      }
      // Order Entry's cross-tab check, per style: the line's Sample Qty against
      // its destinations' PO Qty (silent until a destination has a quantity).
      const cross = crossTabPoQtyMessage(num(s.sample_qty), started.reduce((t, q) => t + num(q.po_qty), 0));
      if (cross) add({ section: "quantities", ...at, label: "PO Qty", message: `${who}: ${cross}`, strict: true });
    }
  });
  return opts.draft ? out.filter((p) => !p.strict) : out;
}

// ---------------------------------------------------------------------------
// The wire schema. Text a person types is stored in CAPITALS — the transform
// lives here, in the schema, never only in the action (AGENTS.md "CAPITALS").
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const optUuid = uuid.nullable().optional();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").nullable().optional();
const optNum = z.coerce.number().min(0, "Quantities cannot be negative").nullable().optional();
const caps = capsTextNullable;
/** A value from one of the vocabularies above, or blank. A refined string
 *  rather than `z.enum` so the draft mapper can hand it a plain string; the
 *  refusal is the same, and the CHECK constraints are the backstop. */
const enumOf = (xs: readonly Opt<string>[]) =>
  z
    .string()
    .nullable()
    .optional()
    .refine((v) => v == null || xs.some((x) => x.value === v), { message: "Pick a value from the list" });

const sizeQty = z.object({ sno: z.number().int(), garment_size: z.string().min(1), qty: optNum });

export const sampleEntryInput = z
  .object({
  header: z.object({
    received_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the Date"),
    enquiry_against: enumOf(ENQUIRY_AGAINST),
    enquiry_action: enumOf(ENQUIRY_ACTIONS),
    customer_id: uuid,
    country_id: optUuid,
    season_id: optUuid,
    season_year: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
    customer_reference: caps(),
    agent_id: optUuid,
    receipt_mode: enumOf(RECEIPT_MODES),
    receipt_date: optDate,
    delivery_to: enumOf(DELIVERY_TO),
    delivery_mode: enumOf(DELIVERY_MODES),
    is_draft: z.boolean(),
    multi_order: z.boolean().optional(),
  }),
  styles: z
    .array(
      z
        .object({
          id: optUuid,
          sno: z.number().int(),
          name: capsName("Enter the Style Name"),
          article_no: caps(),
          description: caps(),
          // NULL = not answered (a draft). Order Entry never guesses PCS.
          unit_kind: z.enum(["piece", "set"]).nullable(),
          sample_qty: optNum,
          delivery_date: optDate,
          merchandiser_id: optUuid,
          order_date: optDate,
          fabric_structure_id: optUuid,
          fabric_id: optUuid,
          gsm: optNum,
          tech_pack: enumOf(TECH_PACK),
          customer_reference: caps(),
          receipt_mode: enumOf(RECEIPT_MODES),
          receipt_date: optDate,
          delivery_to: enumOf(DELIVERY_TO),
          agent_id: optUuid,
          delivery_mode: enumOf(DELIVERY_MODES),
          delivery_through: caps(),
          accessories_reqd: z.boolean(),
          billable: z.boolean(),
          ship_type_id: optUuid,
          ship_mode: enumOf(SHIP_MODES),
          currency_code: z.string().min(1).nullable().optional(),
          price: optNum,
          exchange_rate: optNum,
          files: z.array(
            z.object({
              sno: z.number().int(),
              doc_kind: z.enum(["sketch", "tech_pack"]).nullable(),
              // caps-input: exempt -- a file name is the operator's file, kept as uploaded.
              file_name: z.string().trim().min(1).max(255),
              storage_path: z.string().min(1).max(512),
              mime_type: z.string().max(120).nullable(),
              size_bytes: z.number().int().min(0).nullable(),
            }),
          ),
          coordinates: z.array(z.object({ sno: z.number().int(), coordinate_id: uuid })),
          sizes: z.array(z.object({ sno: z.number().int(), garment_size: z.string().min(1) })),
          combos: z.array(
            z.object({
              sno: z.number().int(),
              combo: capsName("Name the combo colour"),
              order_qty: optNum,
              sizes: z.array(z.object({ sno: z.number().int(), garment_size: z.string().min(1), order_qty: optNum })),
            }),
          ),
          quantities: z.array(
            z.object({
              sno: z.number().int(),
              country_id: optUuid,
              ref_no: caps(),
              consignee_id: optUuid,
              assortment_type_id: optUuid,
              po_qty: optNum,
              delivery_date: optDate,
              earlier_shipment_date: optDate,
              discharge_port_id: optUuid,
              final_destination_id: optUuid,
              pack: caps(),
              no_of_cartons: z.coerce.number().int().min(0).nullable().optional(),
              master_carton_name: caps(),
              // caps-input: exempt -- the buyer's PO number is kept as typed (AGENTS.md CAPITALS, 2026-09-30).
              po_no: z.string().trim().max(60).nullable().optional(),
              ratio_for: z.enum(["master", "inner"]).nullable().optional(),
              is_single_style_pack: z.boolean().optional(),
              lines: z.array(
                z.object({
                  sno: z.number().int(),
                  combo: caps(),
                  style_ref: caps(),
                  no_of_cartons: optNum,
                  inners_per_carton: optNum,
                  sizes: z.array(sizeQty),
                }),
              ),
            }),
          ),
        })
        .superRefine((s, ctx) => {
          // Never a draft question: a non-billable line carries no quantities
          // (spec §4.3), and the payload builder already drops them.
          if (!s.billable && s.quantities.length)
            ctx.addIssue({ code: "custom", message: `${s.name}: quantities are kept only for a billable sample.` });
        }),
    )
    .min(1, "Add at least one style to the sample entry"),
})
  .superRefine((p, ctx) => {
    /* THE SERVER HALF OF THE STRICT RULES — `sampleEntryProblems` is the
       screen's courtesy, this is the guard. Save as Draft waives them; a full
       Save does not. */
    if (p.header.is_draft) return;
    const { min, max } = COORDINATE_LIMITS.set;
    for (const s of p.styles) {
      const fail = (message: string) => ctx.addIssue({ code: "custom", message });
      if (!(Number(s.sample_qty) > 0)) fail(`${s.name}: enter the Sample Qty.`);
      if (!s.merchandiser_id) fail(`${s.name}: choose the Merchandiser.`);
      if (s.billable && !s.currency_code) fail(`${s.name}: choose the Currency.`);
      if (s.billable && !(Number(s.price) > 0)) fail(`${s.name}: enter the Price.`);
      if (s.billable && !(Number(s.exchange_rate) > 0)) fail(`${s.name}: enter the Exchange Rate.`);
      if (!s.unit_kind) fail(`${s.name}: Order Unit is required — Pcs or Set.`);
      if (s.coordinates.length === 0) fail(`${s.name}: Name at least one coordinate.`);
      if (s.sizes.length === 0) fail(`${s.name}: Tick at least one size.`);
      if (s.unit_kind === "set" && (s.coordinates.length < min || s.coordinates.length > max))
        fail(`${s.name} is a SET: name ${min} to ${max} coordinates.`);
      for (const q of s.quantities) {
        if (!q.country_id) fail(`${s.name}: every quantity line needs a Country.`);
        if (!(Number(q.po_qty) > 0)) fail(`${s.name}: every quantity line needs a PO Qty.`);
      }
    }
  });
export type SampleEntryInput = z.input<typeof sampleEntryInput>;

// ---------------------------------------------------------------------------
// Draft → wire. Drops seeded blank rows, resolves inherited fields, and sends
// "" as null. The server parses the result with `sampleEntryInput`.
// ---------------------------------------------------------------------------
const orNull = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

export function toSampleEntryPayload(h: SampleHeaderDraft, all: StyleDraft[], isDraft: boolean): SampleEntryInput {
  const styles = all.filter((s) => !isBlankStyle(s));
  return {
    header: {
      received_date: h.received_date,
      enquiry_against: orNull(h.enquiry_against),
      enquiry_action: orNull(h.enquiry_action),
      customer_id: h.customer_id ?? "",
      country_id: h.country_id,
      season_id: h.season_id,
      season_year: orNull(h.season_year),
      customer_reference: orNull(h.customer_reference),
      agent_id: h.agent_id,
      receipt_mode: orNull(h.receipt_mode),
      receipt_date: orNull(h.receipt_date),
      delivery_to: orNull(h.delivery_to),
      delivery_mode: orNull(h.delivery_mode),
      is_draft: isDraft,
      multi_order: h.multi_order,
    },
    styles: styles.map((s, i) => {
      const eff = (f: InheritedField) => orNull(effectiveValue(s, h, f));
      return {
        id: s.id,
        sno: i + 1,
        name: s.name,
        article_no: orNull(s.article_no),
        description: orNull(s.description),
        unit_kind: isUnitKind(s.unit_kind) ? s.unit_kind : null,
        sample_qty: orNull(s.sample_qty),
        delivery_date: orNull(s.delivery_date),
        merchandiser_id: s.merchandiser_id,
        order_date: orNull(s.order_date),
        fabric_structure_id: s.fabric_structure_id,
        fabric_id: s.fabric_id,
        gsm: orNull(s.gsm),
        tech_pack: orNull(s.tech_pack),
        customer_reference: eff("customer_reference"),
        receipt_mode: orNull(eff("receipt_mode")),
        receipt_date: eff("receipt_date"),
        delivery_to: orNull(eff("delivery_to")),
        agent_id: eff("agent_id"),
        delivery_mode: orNull(eff("delivery_mode")),
        delivery_through: orNull(s.delivery_through),
        accessories_reqd: s.accessories_reqd,
        billable: s.billable,
        // Hidden when not billable (spec §4.3) — and a hidden field is never
        // saved, so turning Billable off cannot leave a price behind.
        ship_type_id: s.billable ? s.ship_type_id : null,
        ship_mode: s.billable ? (orNull(s.ship_mode)) : null,
        currency_code: s.billable ? s.currency_code : null,
        price: s.billable ? orNull(s.price) : null,
        exchange_rate: s.billable ? orNull(s.exchange_rate) : null,
        files: s.files
          .filter((f) => !!f.storage_path)
          .map((f, fi) => ({
            sno: fi + 1,
            doc_kind: f.doc_kind === "sketch" ? "sketch" : f.doc_kind === "order_sheet" ? "tech_pack" : null,
            file_name: f.file_name,
            storage_path: f.storage_path,
            mime_type: f.mime_type || null,
            size_bytes: Number.isFinite(f.size_bytes) ? f.size_bytes : null,
          })),
        // A PCS line keeps its one coordinate (PIECES, prefilled — Order Entry's
        // rule, client 2026-08-29), a SET its two to six.
        coordinates: s.coordinates
          .filter((c) => !!c.coordinate_id)
          .slice(0, s.unit_kind === "set" ? COORDINATE_LIMITS.set.max : COORDINATE_LIMITS.piece.max)
          .map((c, ci) => ({ sno: ci + 1, coordinate_id: c.coordinate_id as string })),
        sizes: s.sizes.map((z, zi) => ({ sno: zi + 1, garment_size: z })),
        combos: s.combos
          .filter((c) => !isBlankCombo(c))
          .map((c, ci) => ({
            sno: ci + 1,
            combo: c.combo,
            order_qty: comboOrderQty(c, s.sizes),
            sizes: s.sizes
              .filter((z) => orNull(c.sizes[z] ?? "") != null)
              .map((z, zi) => ({ sno: zi + 1, garment_size: z, order_qty: orNull(c.sizes[z] ?? "") })),
          })),
        quantities: s.billable
          ? s.quantities
              .filter((q) => !isBlankQuantity(q))
              .map((q, qi) => ({
                sno: qi + 1,
                country_id: q.country_id,
                ref_no: orNull(q.ref_no),
                consignee_id: q.consignee_id,
                assortment_type_id: q.assortment_type_id,
                po_qty: orNull(q.po_qty),
                delivery_date: orNull(q.delivery_date),
                earlier_shipment_date: orNull(q.earlier_shipment_date),
                discharge_port_id: q.discharge_port_id,
                final_destination_id: q.final_destination_id,
                pack: orNull(q.pack),
                no_of_cartons: orNull(q.no_of_cartons),
                master_carton_name: orNull(q.master_carton_name),
                po_no: orNull(q.po_no),
                ratio_for: q.ratio_for || null,
                is_single_style_pack: q.is_single_style_pack,
                lines: q.lines
                  .filter((l) => !isBlankAssortLine(l))
                  .map((l, li) => ({
                    sno: li + 1,
                    combo: orNull(l.combo),
                    // A line's own style is kept only on a Multiple Style pack.
                    style_ref: q.is_single_style_pack ? null : orNull(l.style_ref),
                    no_of_cartons: orNull(l.no_of_cartons),
                    inners_per_carton: orNull(l.inners_per_carton),
                    // Its OWN cells — on a Multiple Style pack those can be
                    // another style's sizes.
                    sizes: Object.keys(l.sizes)
                      .filter((z) => z && orNull(l.sizes[z] ?? "") != null)
                      .map((z, zi) => ({ sno: zi + 1, garment_size: z, qty: orNull(l.sizes[z] ?? "") })),
                  })),
              }))
          : [],
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Rows the list and the loader hand to the screen.
// ---------------------------------------------------------------------------
export type SampleEntryListRow = {
  id: string;
  code: string | null;
  received_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  enquiry_against: string | null;
  enquiry_action: string | null;
  season: string | null;
  season_year: number | null;
  style_count: number;
  sample_qty: number;
  billable_count: number;
  is_draft: boolean;
  created_at: string;
  created_by: string | null;
};

export type SampleEntryRecord = { id: string; code: string | null; header: SampleHeaderDraft; styles: StyleDraft[] };
