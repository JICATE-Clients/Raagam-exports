/**
 * Sample ▸ Sample Costing — editable shapes, the save rules and the wire schema
 * (doc/sample/sample-costing-specification.md; data model 0688 / 0689).
 *
 * PURE ON PURPOSE (no server-only import): the screen, the Save button and the
 * server action read the SAME `costingProblems`, and the server action builds
 * the stored payload with the SAME `toCostingPayload` the arithmetic was shown
 * from — "one declaration, several enforcers" (AGENTS.md "Mandatory fields").
 *
 * The server receives the DRAFT, not a payload. It re-checks the rules and
 * computes the summary snapshot itself, so a figure the client could tamper
 * with never decides whether a costing goes to the MD.
 */
import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";
import {
  MARGIN_FLOOR_PCT,
  costingSummary,
  fabricPricePerKg,
  gramsOf,
  hasYarnMix,
  num,
  yarnMixTotal,
  quoteKey,
  sizeGroupsOf,
  type CostingInput,
  type CostingSummary,
} from "./calc";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const SHIP_MODES = [
  { value: "sea", label: "Sea Freight" },
  { value: "air", label: "Air Freight" },
] as const;
export type ShipMode = (typeof SHIP_MODES)[number]["value"];

export type CostingStatus = "draft" | "submitted" | "approved" | "rejected" | "superseded";

/** Spec §2: version 1 is "Original (Rev 0)", version 2 "Rev 1", … */
export const revisionLabel = (version: number) => (version <= 1 ? "Original (Rev 0)" : `Rev ${version - 1}`);
export const revisionShort = (version: number) => `Rev ${Math.max(0, version - 1)}`;

/** What a status is called on screen — the Budget's words (Request Rework). */
export const STATUS_LABEL: Record<CostingStatus, string> = {
  draft: "Draft",
  submitted: "With MD",
  approved: "Approved",
  rejected: "Rework",
  superseded: "Superseded",
};

/** A sheet is the operator's to change in exactly these two states (0688). */
export const isEditableStatus = (s: CostingStatus) => s === "draft" || s === "rejected";

// ---------------------------------------------------------------------------
// The editor's state
// ---------------------------------------------------------------------------
export type CostingHeaderDraft = {
  opportunity_id: string | null;
  style_id: string | null;
  costing_date: string;
  currency_code: string | null;
  exchange_rate: string;
  margin_pct: string;
  garment_waste_pct: string;
  /** Overhead % (0690, UI/UX spec §4.5) — net × % into the gross cost. */
  overhead_pct: string;
  discount_pct: string;
  ship_mode: string;
  freight_per_pc: string;
  insurance_per_pc: string;
  notes: string;
};

export type PieceDraft = {
  key: string;
  piece_name: string;
  coordinate_id: string | null;
  cmt: string;
  print_cost: string;
  embroidery_cost: string;
  wash_cost: string;
  testing_cost: string;
  bank_cost: string;
};

export type FabricProcessDraft = { key: string; process_id: string | null; process_name: string; rate: string };

/** One line of a fabric's Yarn Mix (0690): which yarn, its share, its rate. */
export type YarnMixDraft = { key: string; item_id: string | null; yarn_name: string; mix_pct: string; rate: string };

export type FabricDraft = {
  key: string;
  fabric_id: string | null;
  quality: string;
  yarn_rate: string;
  yarns: YarnMixDraft[];
  knitting_rate: string;
  dyeing_rate: string;
  finishing_rate: string;
  process_loss_pct: string;
  is_direct: boolean;
  direct_rate: string;
  processes: FabricProcessDraft[];
};

export type WeightDraft = {
  key: string;
  piece_key: string;
  fabric_key: string | null;
  component_id: string | null;
  size_group_id: string | null;
  weight_g: string;
  length_cm: string;
  width_cm: string;
  gsm: string;
  /** Wastage Allowance % (0690). The factory stamps the spec's 3 — see `isBlankWeight`. */
  wastage_pct: string;
};

export type TrimDraft = {
  key: string;
  piece_key: string;
  item_id: string | null;
  description: string;
  qty: string;
  rate: string;
};

export type CostingDraft = {
  header: CostingHeaderDraft;
  pieces: PieceDraft[];
  fabrics: FabricDraft[];
  weights: WeightDraft[];
  trims: TrimDraft[];
  /** Quoted price per `quoteKey(piece.key, size_group_id)`. */
  quotes: Record<string, string>;
};

/** One saved sheet, as the editor opens it. */
export type CostingRecord = {
  id: string;
  code: string | null;
  version: number;
  status: CostingStatus;
  is_draft: boolean;
  parent_id: string | null;
  decision_remark: string | null;
  draft: CostingDraft;
};

/** Every revision of one Costing No, oldest first — the header's Revision list. */
export type RevisionRow = {
  id: string;
  version: number;
  status: CostingStatus;
  /** The quoted (set) price that revision carried — the ribbon's price line. */
  target_fob: number | null;
  currency_code: string | null;
};

/** A row of the list. */
export type CostingListRow = {
  id: string;
  code: string | null;
  version: number;
  status: CostingStatus;
  is_draft: boolean;
  costing_date: string | null;
  opportunity_id: string;
  enquiry_no: string | null;
  customer_name: string | null;
  style_id: string | null;
  sample_no: string | null;
  style_name: string | null;
  currency_code: string | null;
  computed_fob: number | null;
  target_fob: number | null;
  profit_loss_pct: number | null;
  created_at: string;
  created_by: string | null;
};

// ---------------------------------------------------------------------------
// Blank rows — the save side drops them (AGENTS.md "THE SEEDED ROW IS SAVED
// UNLESS THE SAVE SIDE DROPS IT"). Only what the operator TYPES is tested: the
// piece a factory stamps on a row is not evidence of anything.
// ---------------------------------------------------------------------------
const filled = (v: string | null | undefined) => (v ?? "").trim() !== "";

export const isBlankFabric = (f: FabricDraft) =>
  !f.fabric_id &&
  !filled(f.quality) &&
  !filled(f.yarn_rate) &&
  !filled(f.knitting_rate) &&
  !filled(f.dyeing_rate) &&
  !filled(f.finishing_rate) &&
  !filled(f.process_loss_pct) &&
  !filled(f.direct_rate) &&
  !f.processes.some((p) => !isBlankProcess(p)) &&
  !f.yarns.some((y) => !isBlankYarn(y));

export const isBlankProcess = (p: FabricProcessDraft) => !p.process_id && !filled(p.process_name) && !filled(p.rate);
export const isBlankYarn = (y: YarnMixDraft) => !y.item_id && !filled(y.yarn_name) && !filled(y.mix_pct) && !filled(y.rate);

/**
 * NOT `wastage_pct`: the factory stamps the spec's default 3 % (UI/UX spec
 * §4.3, "Default 3%"), so testing it would make every untouched row look
 * typed — the constant-`true` clause AGENTS.md "THE SEEDED ROW IS SAVED UNLESS
 * THE SAVE SIDE DROPS IT" warns about. A row is real once the operator types
 * something they have to type.
 */
export const isBlankWeight = (w: WeightDraft) =>
  !w.fabric_key &&
  !w.component_id &&
  !w.size_group_id &&
  !filled(w.weight_g) &&
  !filled(w.length_cm) &&
  !filled(w.width_cm) &&
  !filled(w.gsm);

export const isBlankTrim = (t: TrimDraft) => !t.item_id && !filled(t.description) && !filled(t.qty) && !filled(t.rate);

/** The drafts the arithmetic and the payload read — blanks dropped. */
export function liveRows(d: CostingDraft) {
  const fabrics = d.fabrics
    .filter((f) => !isBlankFabric(f))
    .map((f) => ({ ...f, processes: f.processes.filter((p) => !isBlankProcess(p)), yarns: f.yarns.filter((y) => !isBlankYarn(y)) }));
  return {
    fabrics,
    weights: d.weights.filter((w) => !isBlankWeight(w)),
    trims: d.trims.filter((t) => !isBlankTrim(t)),
  };
}

/** The engine's input, from the editor's state. */
export function costingInputOf(d: CostingDraft): CostingInput {
  const live = liveRows(d);
  return {
    pieces: d.pieces,
    fabrics: live.fabrics,
    weights: live.weights,
    trims: live.trims,
    terms: d.header,
    quotes: d.quotes,
  };
}

export const summaryOf = (d: CostingDraft): CostingSummary => costingSummary(costingInputOf(d));

// ---------------------------------------------------------------------------
// The save rules — one list, read by the screen (stars, holds, "N to fix",
// Save) and by the server action.
// ---------------------------------------------------------------------------
export type CostingSection = "info" | "fabrics" | "consumption" | "cmt" | "trims" | "quotation";

export type CostingProblem = {
  section: CostingSection;
  fieldId?: string;
  label: string;
  message: string;
};

/** DOM ids the problems point at, built the same way by the screen. */
export const costingFieldId = {
  sample: "sc-sample",
  style: "sc-style",
  date: "sc-date",
  currency: "sc-currency",
  rate: "sc-rate",
  margin: "sc-margin",
  fabric: (key: string) => `sc-fab-${key}`,
  fabricRate: (key: string) => `sc-fab-yarn-${key}`,
  /** Price / KG when Direct is on — the one editable box then. */
  fabricDirect: (key: string) => `sc-fab-direct-${key}`,
  yarnMix: (key: string) => `sc-fab-mix-${key}`,
  weightFabric: (key: string) => `sc-w-fab-${key}`,
  weightGrams: (key: string) => `sc-w-g-${key}`,
  trimRate: (key: string) => `sc-t-rate-${key}`,
};

/**
 * What stops a save. With `draft`, only what makes it a record at all (the
 * Sample No — `cost_sheets.opportunity_id` is NOT NULL).
 */
export function costingProblems(d: CostingDraft, opts: { draft?: boolean } = {}): CostingProblem[] {
  const out: CostingProblem[] = [];
  const h = d.header;
  if (!h.opportunity_id) {
    out.push({ section: "info", fieldId: costingFieldId.sample, label: "Sample No", message: "Choose the Sample No." });
  }
  if (opts.draft) return out;

  if (!h.style_id) {
    out.push({ section: "info", fieldId: costingFieldId.style, label: "Style", message: "Choose the style line being costed." });
  }
  if (!h.costing_date) {
    out.push({ section: "info", fieldId: costingFieldId.date, label: "Costing Date", message: "Enter the Costing Date." });
  }

  const live = liveRows(d);
  if (live.fabrics.length === 0) {
    out.push({ section: "fabrics", label: "Fabric", message: "Add at least one fabric quality with its rate." });
  }
  for (const f of live.fabrics) {
    if (!f.fabric_id && !filled(f.quality)) {
      out.push({ section: "fabrics", fieldId: costingFieldId.fabric(f.key), label: "Fabric Quality", message: "Name the fabric quality." });
    }
    if (!f.is_direct && hasYarnMix(f) && Math.abs(yarnMixTotal(f) - 100) > 0.001) {
      out.push({
        section: "fabrics",
        fieldId: costingFieldId.yarnMix(f.key),
        label: "Yarn Mix",
        message: `The yarn mix adds to ${yarnMixTotal(f)}% — make it 100%.`,
      });
    }
    if (fabricPricePerKg(f) == null) {
      out.push({
        section: "fabrics",
        fieldId: f.is_direct ? costingFieldId.fabricDirect(f.key) : costingFieldId.fabricRate(f.key),
        label: "Rate",
        message: f.is_direct
          ? "Enter the direct Price / KG, or switch Direct off and derive it."
          : "Enter the yarn, knitting or dyeing rate so the fabric has a price per KG.",
      });
    }
  }

  if (live.weights.length === 0) {
    out.push({ section: "consumption", label: "Consumption", message: "Add at least one component weight." });
  }
  for (const w of live.weights) {
    // A matrix line writes one row per size group (`line|group`); its
    // problems belong to the LINE's own controls, reported once.
    if (w.key.includes("|")) continue;
    if (!w.fabric_key || !live.fabrics.some((f) => f.key === w.fabric_key)) {
      out.push({ section: "consumption", fieldId: costingFieldId.weightFabric(w.key), label: "Fabric", message: "Pick the fabric this component is cut from." });
    }
    if (gramsOf(w) == null) {
      out.push({ section: "consumption", fieldId: costingFieldId.weightGrams(w.key), label: "Weight", message: "Enter the weight in grams, or Length, Width and GSM." });
    }
  }

  for (const t of live.trims) {
    if (!t.item_id && !filled(t.description)) {
      out.push({ section: "trims", fieldId: costingFieldId.trimRate(t.key), label: "Trim", message: "Name the trim, or remove the line." });
    }
  }

  // A negative rate, weight or % is never a cost (UI/UX spec §5.2 "negative weights").
  const negative = (v: string) => (num(v) ?? 0) < 0;
  for (const f of live.fabrics) {
    if ([f.yarn_rate, f.knitting_rate, f.dyeing_rate, f.finishing_rate, f.process_loss_pct, f.direct_rate].some(negative)) {
      out.push({ section: "fabrics", fieldId: costingFieldId.fabric(f.key), label: "Rate", message: "A fabric rate cannot be negative." });
    }
  }
  for (const w of live.weights) {
    if ([w.weight_g, w.length_cm, w.width_cm, w.gsm, w.wastage_pct].some(negative)) {
      out.push({ section: "consumption", fieldId: costingFieldId.weightGrams(w.key), label: "Weight", message: "A weight or allowance cannot be negative." });
    }
  }
  if ([h.margin_pct, h.garment_waste_pct, h.overhead_pct, h.discount_pct, h.freight_per_pc, h.insurance_per_pc].some(negative)) {
    out.push({ section: "quotation", label: "Terms", message: "Margin, wastage, overhead, discount, freight and insurance cannot be negative." });
  }

  if (!h.currency_code) {
    // No fieldId: CurrencyPicker takes no `id`, so the reveal falls back to the
    // section's first blank marker — which is this picker.
    out.push({ section: "quotation", label: "Currency", message: "Choose the buyer's currency." });
  }
  const rate = num(h.exchange_rate);
  if (rate == null || rate <= 0) {
    out.push({ section: "quotation", fieldId: costingFieldId.rate, label: "Exchange Rate", message: "Enter the exchange rate (INR per unit of currency)." });
  }
  if (!filled(h.margin_pct)) {
    out.push({ section: "quotation", fieldId: costingFieldId.margin, label: "Margin %", message: "Enter the target margin %." });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------
const s = z.string();
const sid = z.string().uuid().nullable();
const numStr = z.string().refine((v) => v.trim() === "" || Number.isFinite(Number(v)), "Enter a number.");

export const costingDraftSchema = z.object({
  header: z.object({
    opportunity_id: sid,
    style_id: sid,
    costing_date: s,
    currency_code: z.string().nullable(),
    exchange_rate: numStr,
    margin_pct: numStr,
    garment_waste_pct: numStr,
    overhead_pct: numStr,
    discount_pct: numStr,
    ship_mode: z.union([z.literal(""), z.literal("sea"), z.literal("air")]),
    freight_per_pc: numStr,
    insurance_per_pc: numStr,
    notes: s,
  }),
  pieces: z
    .array(
      z.object({
        key: s,
        piece_name: s,
        coordinate_id: sid,
        cmt: numStr,
        print_cost: numStr,
        embroidery_cost: numStr,
        wash_cost: numStr,
        testing_cost: numStr,
        bank_cost: numStr,
      }),
    )
    .min(1, "A costing needs at least one garment piece."),
  fabrics: z.array(
    z.object({
      key: s,
      fabric_id: sid,
      quality: s,
      yarn_rate: numStr,
      yarns: z.array(z.object({ key: s, item_id: sid, yarn_name: s, mix_pct: numStr, rate: numStr })),
      knitting_rate: numStr,
      dyeing_rate: numStr,
      finishing_rate: numStr,
      process_loss_pct: numStr,
      is_direct: z.boolean(),
      direct_rate: numStr,
      processes: z.array(z.object({ key: s, process_id: sid, process_name: s, rate: numStr })),
    }),
  ),
  weights: z.array(
    z.object({
      key: s,
      piece_key: s,
      fabric_key: z.string().nullable(),
      component_id: sid,
      size_group_id: sid,
      weight_g: numStr,
      length_cm: numStr,
      width_cm: numStr,
      gsm: numStr,
      wastage_pct: numStr,
    }),
  ),
  trims: z.array(z.object({ key: s, piece_key: s, item_id: sid, description: s, qty: numStr, rate: numStr })),
  quotes: z.record(z.string(), numStr),
}) satisfies z.ZodType<CostingDraft>;

/** Free text is stored in CAPITALS — through the Zod transform (AGENTS.md CAPITALS). */
const caps = (v: string) => capsTextNullable().parse(v) || null;

const n2 = (v: number | null) => (v == null ? null : String(Math.round(v * 10000) / 10000));

/**
 * The jsonb `save_sample_costing` takes (0688): rows with no blanks, children
 * pointing at their piece / fabric by POSITION, and the summary snapshot the
 * lists and quotes read. Built on the SERVER from the checked draft.
 */
export function toCostingPayload(d: CostingDraft, opts: { isDraft: boolean; parentId?: string | null }) {
  const live = liveRows(d);
  const summary = costingSummary(costingInputOf(d));
  const head = summary.groups[0]?.total;
  const pieceIndex = new Map(d.pieces.map((p, i) => [p.key, i]));
  const fabricIndex = new Map(live.fabrics.map((f, i) => [f.key, i]));
  const rate = num(d.header.exchange_rate);
  const quotes = d.pieces.flatMap((p, pi) =>
    sizeGroupsOf(live.weights).map((g) => ({
      piece_index: pi,
      size_group_id: g,
      quoted_price: (d.quotes[quoteKey(p.key, g)] ?? "").trim(),
    })),
  );

  return {
    header: {
      opportunity_id: d.header.opportunity_id,
      style_id: d.header.style_id,
      parent_id: opts.parentId ?? null,
      costing_date: d.header.costing_date,
      currency_code: d.header.currency_code,
      exchange_rate: d.header.exchange_rate.trim(),
      margin_pct: d.header.margin_pct.trim(),
      garment_waste_pct: d.header.garment_waste_pct.trim(),
      overhead_pct: d.header.overhead_pct.trim(),
      discount_pct: d.header.discount_pct.trim(),
      ship_mode: d.header.ship_mode,
      freight_per_pc: d.header.freight_per_pc.trim(),
      insurance_per_pc: d.header.insurance_per_pc.trim(),
      notes: caps(d.header.notes),
      is_draft: opts.isDraft,
      summary: head
        ? {
            fabric_cost: n2(head.fabric),
            cmt_cost: n2(head.cmt),
            garment_process_cost: n2(head.process),
            trims_cost: n2(head.trims),
            other_expenses_cost: n2(head.other),
            gross_cost: n2(head.gross),
            fob_inr: n2(head.quoted != null && rate ? head.quoted * rate : null),
            computed_fob: n2(head.calc),
            target_fob: n2(head.quoted),
            profit_loss_pct: n2(summary.lowestMarginPct),
          }
        : {},
    },
    pieces: d.pieces.map((p) => ({
      piece_name: caps(p.piece_name) ?? "GARMENT",
      coordinate_id: p.coordinate_id,
      cmt: p.cmt.trim(),
      print_cost: p.print_cost.trim(),
      embroidery_cost: p.embroidery_cost.trim(),
      wash_cost: p.wash_cost.trim(),
      testing_cost: p.testing_cost.trim(),
      bank_cost: p.bank_cost.trim(),
    })),
    fabrics: live.fabrics.map((f) => ({
      fabric_id: f.fabric_id,
      quality: caps(f.quality),
      // A mix makes the typed yarn rate moot; the derived one is stored, so a
      // reader that never opens the mix still sees the rate that was used.
      yarn_rate: hasYarnMix(f) ? String(f.yarns.reduce((t, y) => t + ((num(y.mix_pct) ?? 0) * (num(y.rate) ?? 0)) / 100, 0)) : f.yarn_rate.trim(),
      yarns: f.yarns.map((y) => ({ item_id: y.item_id, yarn_name: caps(y.yarn_name), mix_pct: y.mix_pct.trim(), rate: y.rate.trim() })),
      knitting_rate: f.knitting_rate.trim(),
      dyeing_rate: f.dyeing_rate.trim(),
      finishing_rate: f.finishing_rate.trim(),
      process_loss_pct: f.process_loss_pct.trim(),
      is_direct: f.is_direct,
      direct_rate: f.is_direct ? f.direct_rate.trim() : "",
      processes: f.processes.map((p) => ({ process_id: p.process_id, process_name: caps(p.process_name), rate: p.rate.trim() })),
    })),
    consumptions: live.weights
      .filter((w) => pieceIndex.has(w.piece_key))
      .map((w) => ({
        piece_index: pieceIndex.get(w.piece_key),
        fabric_index: w.fabric_key != null && fabricIndex.has(w.fabric_key) ? fabricIndex.get(w.fabric_key) : null,
        component_id: w.component_id,
        size_group_id: w.size_group_id,
        weight_g: w.weight_g.trim(),
        length_cm: w.length_cm.trim(),
        width_cm: w.width_cm.trim(),
        gsm: w.gsm.trim(),
        wastage_pct: w.wastage_pct.trim(),
      })),
    trims: live.trims
      .filter((t) => pieceIndex.has(t.piece_key))
      .map((t) => ({
        piece_index: pieceIndex.get(t.piece_key),
        item_id: t.item_id,
        description: caps(t.description),
        qty: t.qty.trim(),
        rate: t.rate.trim(),
      })),
    quotes: quotes.filter((q) => q.quoted_price !== ""),
  };
}

/** The rate-memory key of a fabric line (UX plan P2.3): the master fabric, else its typed quality. */
export const rateMemoryKey = (fabricId: string | null, quality: string) =>
  fabricId ? `id:${fabricId}` : quality.trim() ? `q:${quality.trim().toUpperCase()}` : "";

/** Spec §5.2 in words, for the toast and the band. */
export const floorSentence = (lowest: number | null) =>
  lowest == null
    ? null
    : lowest < MARGIN_FLOOR_PCT
      ? `Lowest margin ${lowest.toFixed(1)}% is under ${MARGIN_FLOOR_PCT}% — Submit sends it to the MD.`
      : `Lowest margin ${lowest.toFixed(1)}% — clears the ${MARGIN_FLOOR_PCT}% floor on Submit.`;
