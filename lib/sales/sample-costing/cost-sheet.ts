/**
 * Sample Costing — the COST SHEET REPORT's model (2026-10-08).
 *
 * One display-ready object that the page, the PDF and the Excel file all draw
 * from, so the three cannot disagree. PURE: no React, no server import. Every
 * rupee comes from `costingSummary` (calc.ts) — nothing here is a second
 * calculation; this file only arranges figures and resolves names.
 *
 * INTERNAL. This sheet prints rates, margin and wastage. The buyer's document
 * is the Quotation (quotation-export.ts), which prints prices only.
 */
import {
  MARGIN_FLOOR_PCT,
  costingSummary,
  dimensionalGrams,
  extraChargeAmount,
  fabricPricePerKg,
  gramsOf,
  num,
  pieceCmt,
  pieceEmbellishment,
  processTotal,
  trimCostPerPiece,
  yarnRateOf,
  type GroupFigures,
} from "./calc";
import { SHIP_MODES, STATUS_LABEL, costingInputOf, isBlankPieceLine, liveRows, revisionShort, type CostingRecord, type CostingStatus } from "./types";
import type { CostingEnquiryOption, CostingStyleOption } from "./service";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import type { RevisionHistoryRow } from "./revision-history";
import { approvalLineOf, type ApprovalFacts, type ApprovalLine } from "./approval-line";

/** A figure to the rupee-and-paise the sheet prints. */
export const fx = (v: number | null | undefined, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(dp));

/** One size's figures — the shown group's TOTAL (a set's pieces summed). */
export type SizeFigures = {
  size: string | null;
  label: string;
  fabric: number;
  cmt: number;
  /** Embellishment (the garment processes). */
  process: number;
  trims: number;
  testing: number;
  bank: number;
  net: number;
  wastage: number;
  overhead: number;
  extraOverhead: number;
  grossCost: number;
  margin: number;
  discount: number;
  priceAdj: number;
  /** The INR selling price: gross cost + margin − discount ± price charges. */
  price: number;
  calc: number | null;
  quoted: number | null;
  delta: number | null;
  deltaPct: number | null;
  effectiveMarginPct: number | null;
  /** Grams of fabric a piece takes, and the same with each component's loss. */
  grams: number;
  gramsWithLoss: number;
};

export type CostSheetModel = {
  id: string;
  costingNo: string | null;
  revision: string;
  date: string | null;
  status: CostingStatus;
  statusLabel: string;
  isDraft: boolean;
  decisionRemark: string | null;
  company: DocLetterhead;
  customer: string | null;
  enquiryNo: string | null;
  sampleNo: string | null;
  style: string | null;
  season: string | null;
  thumbUrl: string | null;
  currency: string | null;
  exchangeRate: number | null;
  shipMode: string | null;
  isSet: boolean;
  unitWord: string;
  pieceCount: number;
  sizes: SizeFigures[];
  lowestMarginPct: number | null;
  belowFloor: boolean;
  /** Which size carries the lowest margin — what the MD banner names. */
  lowestSize: string | null;
  fabrics: {
    /** The draft row this line is — what an inline edit patches. */
    key: string;
    name: string;
    yarn: number;
    knitting: number;
    dyeing: number;
    finishing: number;
    special: number;
    lossPct: number;
    price: number | null;
    direct: boolean;
    /** "249.00 = 60% × 295 + 40% × 180", when the yarn is a mix. */
    mixNote: string | null;
  }[];
  weights: {
    sizeLabels: string[];
    rows: {
      piece: string;
      component: string;
      fabric: string;
      grams: (number | null)[];
      lossPct: string;
      /** The draft weight behind each size cell (null = none), and whether it is length × width × gsm — so a cell edited on the report writes back. */
      cells: ({ key: string; dim: boolean } | null)[];
      /** Every draft weight on this line: where the Loss % is written. */
      wkeys: string[];
    }[];
  };
  ops: {
    piece: string;
    name: string;
    kind: "CMT" | "Embellishment" | "Testing";
    rate: number;
    /** Which draft figure this rate is, so a cell edited on the report writes it back. */
    pieceKey: string;
    lineKey: string | null;
    field: "cmt" | "line" | "testing";
  }[];
  trims: { key: string; piece: string; name: string; pricing: string; qty: string; cost: number }[];
  /** Overheads ▸ one row per line, ₹ per size (a set's pieces summed). */
  overheads: { name: string; type: string; value: string; perSize: number[]; side: "cost" | "price"; edit: { kind: "bank" | "waste" | "overhead" | "extra"; key?: string } }[];
  terms: { margin: number; wastage: number; overhead: number; discount: number; freight: number; insurance: number };
  /** Every revision of this Costing No, oldest first — `[]` when it was never revised. INTERNAL: carries margin. */
  history: RevisionHistoryRow[];
  /** How this costing was approved, and by whom. INTERNAL — the buyer's copy says only "Approved". */
  approval: ApprovalLine;
};

const sizeLabel = (s: string | null) => s ?? "All sizes";

export function buildCostSheetModel(
  record: CostingRecord,
  lookups: {
    enquiries: readonly CostingEnquiryOption[];
    styles: readonly CostingStyleOption[];
    components: readonly { id: string; name: string }[];
    trims: readonly { id: string; name: string }[];
  },
  company: DocLetterhead,
  history: RevisionHistoryRow[] = [],
  approvalFacts: ApprovalFacts | null = null,
): CostSheetModel {
  const d = record.draft;
  const h = d.header;
  const live = liveRows(d);
  const input = costingInputOf(d);
  const summary = costingSummary(input);
  const enq = lookups.enquiries.find((e) => e.id === h.opportunity_id) ?? null;
  const style = lookups.styles.find((s) => s.id === h.style_id) ?? null;
  const pieceName = (k: string) => d.pieces.find((p) => p.key === k)?.piece_name || "GARMENT";
  const n = d.pieces.length;

  const sizes: SizeFigures[] = summary.groups.map((g: GroupFigures) => {
    const t = g.total;
    const rows = live.weights.filter((w) => w.size_name == null || w.size_name === g.size);
    const grams = rows.reduce((s, w) => s + (gramsOf(w) ?? 0), 0);
    const gramsWithLoss = rows.reduce((s, w) => s + (gramsOf(w) ?? 0) * (1 + (num(w.wastage_pct) ?? 0) / 100), 0);
    return {
      size: g.size,
      label: sizeLabel(g.size),
      fabric: t.fabric,
      cmt: t.cmt,
      process: t.process,
      trims: t.trims,
      testing: d.pieces.reduce((s, p) => s + (num(p.testing_cost) ?? 0), 0),
      bank: d.pieces.reduce((s, p) => s + (num(p.bank_cost) ?? 0), 0),
      net: t.net,
      wastage: t.wastage,
      overhead: t.overhead,
      extraOverhead: t.extraOverhead,
      grossCost: t.grossCost,
      margin: t.margin,
      discount: t.discount,
      priceAdj: t.priceAdj,
      price: t.gross,
      calc: t.calc,
      quoted: t.quoted,
      delta: t.delta,
      deltaPct: t.deltaPct,
      effectiveMarginPct: t.effectiveMarginPct,
      grams: Math.round(grams * 100) / 100,
      gramsWithLoss: Math.round(gramsWithLoss * 100) / 100,
    };
  });

  let lowestSize: string | null = null;
  for (const s of sizes) {
    if (s.effectiveMarginPct != null && s.effectiveMarginPct === summary.lowestMarginPct) lowestSize = s.label;
  }

  const fabrics = live.fabrics.map((f, i) => {
    const mix = f.yarns.filter((y) => num(y.mix_pct) != null);
    return {
      key: f.key,
      name: f.quality.trim() || `Fabric ${i + 1}`,
      yarn: f.is_direct ? 0 : yarnRateOf(f),
      knitting: num(f.knitting_rate) ?? 0,
      dyeing: num(f.dyeing_rate) ?? 0,
      finishing: num(f.finishing_rate) ?? 0,
      special: f.is_direct ? 0 : processTotal(f),
      lossPct: num(f.process_loss_pct) ?? 0,
      price: fabricPricePerKg(f),
      direct: f.is_direct,
      mixNote:
        !f.is_direct && mix.length
          ? `Yarn ${fx(yarnRateOf(f))} = ${mix.map((y) => `${num(y.mix_pct)}% × ${num(y.rate) ?? 0}`).join(" + ")}`
          : null,
    };
  });

  // One line per (piece, component, fabric): grams in each size column.
  const sizeCols = sizes.map((s) => s.size);
  const lineKey = (w: { piece_key: string; component_ids: string[]; fabric_key: string | null }) =>
    [w.piece_key, w.component_ids.join(","), w.fabric_key ?? ""].join("|");
  const lines = new Map<string, { piece: string; component: string; fabric: string; grams: (number | null)[]; loss: Set<string>; cells: ({ key: string; dim: boolean } | null)[]; wkeys: string[] }>();
  for (const w of live.weights) {
    const k = lineKey(w);
    let line = lines.get(k);
    if (!line) {
      const fi = live.fabrics.findIndex((f) => f.key === w.fabric_key);
      line = {
        piece: pieceName(w.piece_key),
        component: w.component_ids
          .map((id) => lookups.components.find((c) => c.id === id)?.name ?? "")
          .filter(Boolean)
          .join(" + "),
        fabric: fi >= 0 ? fabrics[fi].name : "",
        grams: sizeCols.map(() => null),
        loss: new Set(),
        cells: sizeCols.map(() => null),
        wkeys: [],
      };
      lines.set(k, line);
    }
    const g = dimensionalGrams(w) ?? num(w.weight_g);
    sizeCols.forEach((col, i) => {
      if ((w.size_name == null || w.size_name === col) && g != null) line!.grams[i] = g;
      if (w.size_name === col) line!.cells[i] = { key: w.key, dim: dimensionalGrams(w) != null };
    });
    line.wkeys.push(w.key);
    if (num(w.wastage_pct) != null) line.loss.add(String(num(w.wastage_pct)));
  }

  const ops: CostSheetModel["ops"] = [];
  for (const p of d.pieces) {
    const tag = d.pieces.length > 1 ? p.piece_name : "";
    if (p.cmt_direct) {
      if ((num(p.cmt) ?? 0) > 0) ops.push({ piece: tag, name: "CMT (direct rate)", kind: "CMT", rate: num(p.cmt) ?? 0, pieceKey: p.key, lineKey: null, field: "cmt" });
    }
    for (const l of p.lines.filter((x) => !isBlankPieceLine(x))) {
      if (l.kind === "cmt" && p.cmt_direct) continue;
      ops.push({ piece: tag, name: l.process_name || "—", kind: l.kind === "cmt" ? "CMT" : "Embellishment", rate: num(l.rate) ?? 0, pieceKey: p.key, lineKey: l.key, field: "line" });
    }
    if ((num(p.testing_cost) ?? 0) > 0) ops.push({ piece: tag, name: "Testing & FOB", kind: "Testing", rate: num(p.testing_cost) ?? 0, pieceKey: p.key, lineKey: null, field: "testing" });
  }

  const trims = live.trims.map((t) => {
    const direct = t.is_direct !== false;
    const price = num(t.pack_price);
    const size = num(t.pack_size);
    return {
      key: t.key,
      piece: pieceName(t.piece_key),
      name: t.description || lookups.trims.find((x) => x.id === t.item_id)?.name || "",
      pricing: direct ? `Direct ₹${fx(num(t.rate))}` : `₹${fx(price)} ÷ ${size ?? 1}`,
      qty: t.qty || (direct ? "1" : ""),
      cost: trimCostPerPiece(t).cost,
    };
  });

  // Overheads: every line, ₹ per size. A flat row applies to each piece, a percent row to each piece's net.
  const overheads: CostSheetModel["overheads"] = [
    { name: "Bank charges", type: "Flat ₹", value: "", perSize: sizes.map((s) => s.bank), side: "cost", edit: { kind: "bank" } },
  ];
  if ((num(h.garment_waste_pct) ?? 0) > 0) {
    overheads.push({ name: "Garment Rejection", type: "Percent", value: `${fx(num(h.garment_waste_pct))} %`, perSize: sizes.map((s) => s.wastage), side: "cost", edit: { kind: "waste" } });
  }
  if ((num(h.overhead_pct) ?? 0) > 0) {
    overheads.push({ name: "Overhead", type: "Percent", value: `${fx(num(h.overhead_pct))} %`, perSize: sizes.map((s) => s.overhead), side: "cost", edit: { kind: "overhead" } });
  }
  for (const e of live.extras) {
    const perSize = sizes.map((s) => {
      const a = extraChargeAmount(e, s.net);
      return e.kind === "flat" ? a * n : a;
    });
    overheads.push({
      name: e.name.trim() || "Charge",
      type: e.kind === "pct" ? "Percent" : "Flat ₹",
      value: `${e.section === "price" && e.sign === "deduct" ? "−" : e.section === "price" ? "+" : ""}${fx(num(e.value))}${e.kind === "pct" ? " %" : ""}`,
      perSize,
      side: e.section === "price" ? "price" : "cost",
      edit: { kind: "extra", key: e.key },
    });
  }

  return {
    id: record.id,
    costingNo: record.code,
    revision: revisionShort(record.version),
    date: h.costing_date || null,
    status: record.status,
    statusLabel: record.is_draft ? "Draft" : STATUS_LABEL[record.status],
    isDraft: record.is_draft,
    decisionRemark: record.decision_remark,
    company,
    customer: enq?.customer_name ?? null,
    enquiryNo: enq?.code ?? null,
    sampleNo: style?.sample_no ?? null,
    style: style?.name ?? null,
    season: [enq?.season, enq?.season_year].filter(Boolean).join(" ") || null,
    thumbUrl: style?.thumb_url ?? null,
    currency: h.currency_code,
    exchangeRate: num(h.exchange_rate),
    shipMode: SHIP_MODES.find((x) => x.value === h.ship_mode)?.label ?? null,
    isSet: style?.unit_kind === "set" || n > 1,
    unitWord: style?.unit_kind === "set" || n > 1 ? "set" : "piece",
    pieceCount: n,
    sizes,
    lowestMarginPct: summary.lowestMarginPct,
    belowFloor: summary.belowFloor,
    lowestSize,
    fabrics,
    weights: {
      sizeLabels: sizes.map((s) => s.label),
      rows: [...lines.values()].map((l) => ({
        piece: n > 1 ? l.piece : "",
        component: l.component,
        fabric: l.fabric,
        grams: l.grams,
        lossPct: [...l.loss].join(" / "),
        cells: l.cells,
        wkeys: l.wkeys,
      })),
    },
    ops,
    trims,
    overheads,
    terms: {
      margin: num(h.margin_pct) ?? 0,
      wastage: num(h.garment_waste_pct) ?? 0,
      overhead: num(h.overhead_pct) ?? 0,
      discount: num(h.discount_pct) ?? 0,
      freight: num(h.freight_per_pc) ?? 0,
      insurance: num(h.insurance_per_pc) ?? 0,
    },
    history,
    approval: approvalLineOf(
      approvalFacts ?? {
        status: record.status,
        isDraft: record.is_draft,
        submittedAt: null,
        approvedAt: null,
        decidedByName: null,
        decidedAt: null,
        remark: record.decision_remark,
        lowestMarginPct: summary.lowestMarginPct,
      },
    ),
  };
}

/** The margin band a figure falls in — the same cut points `marginHealth` uses. */
export const FLOOR_PCT = MARGIN_FLOOR_PCT;

/** The cost groups a price is made of, for the waterfall, the donut and the PDF. */
export function priceParts(s: SizeFigures): { label: string; value: number; tone: "fabric" | "cmt" | "emb" | "trims" | "over" | "margin" }[] {
  return [
    { label: "Fabric", value: s.fabric, tone: "fabric" },
    { label: "CMT", value: s.cmt, tone: "cmt" },
    { label: "Embellishment & testing", value: s.process + s.testing, tone: "emb" },
    { label: "Trims", value: s.trims, tone: "trims" },
    { label: "Overheads", value: s.bank + s.wastage + s.overhead + s.extraOverhead, tone: "over" },
    { label: "Margin", value: Math.max(s.margin + s.priceAdj - s.discount, 0), tone: "margin" },
  ];
}
