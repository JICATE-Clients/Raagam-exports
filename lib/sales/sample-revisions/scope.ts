/**
 * WHAT A SAMPLE REVISION LETS ITS COSTING CHANGE (0716) — pure, client-safe.
 *
 * A costing module opens the next costing revision of the approved sheet; the
 * database lets that draft be saved, and this decides which FIELDS of it may
 * differ from the approved parent. Read by the costing save (the guard) and by
 * the editor (the sentence it shows).
 *
 *   fabric_spec — fabrics (which, quality, yarn mix %, processes, process
 *                 loss %, direct or built-up) and the garment weights
 *   trims       — trims (item, description, consumption, pack size, direct
 *                 or pack-priced)
 *   costing     — every rate: fabric / yarn / knit / dye / finish / direct,
 *                 process rates, trim rates and pack prices, CMT and the
 *                 piece lines, testing / bank, overheads, extras, terms,
 *                 quotes
 *
 * RATES ARE COMPARED ONLY ON ROWS THAT WERE ALREADY THERE. A fabric or trim
 * added under its spec module needs its rates typed — refusing those would
 * make the module unusable — so a new row's rates are free, and a removed row
 * is a spec change of its own module.
 */
import type { CostingDraft } from "@/lib/sales/sample-costing/types";
import { REVISION_KIND_LABEL, type RevisionKind } from "./types";

const t = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
const n = (v: string | null | undefined) => {
  const s = (v ?? "").trim().replace(/,/g, "");
  if (!s) return "";
  const x = Number(s);
  return Number.isFinite(x) ? String(x) : s;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const fabricId = (f: CostingDraft["fabrics"][number]) => `${f.fabric_id ?? ""}|${t(f.quality)}`;
const trimId = (x: CostingDraft["trims"][number]) => `${x.item_id ?? ""}|${t(x.description)}`;
const pieceId = (p: CostingDraft["pieces"][number]) => `${t(p.piece_name)}|${p.coordinate_id ?? ""}`;

function fabricSpec(d: CostingDraft) {
  const fIndex = new Map(d.fabrics.map((f, i) => [f.key, i]));
  const pIndex = new Map(d.pieces.map((p, i) => [p.key, i]));
  return {
    fabrics: d.fabrics.map((f) => ({
      id: fabricId(f),
      direct: f.is_direct,
      loss: n(f.process_loss_pct),
      yarns: f.yarns.map((y) => ({ item: y.item_id ?? t(y.yarn_name), mix: n(y.mix_pct) })),
      processes: f.processes.map((p) => p.process_id ?? t(p.process_name)),
    })),
    weights: d.weights.map((w) => ({
      piece: pIndex.get(w.piece_key) ?? -1,
      fabric: w.fabric_key ? (fIndex.get(w.fabric_key) ?? -1) : null,
      comps: [...w.component_ids].sort(),
      size: w.size_name,
      g: n(w.weight_g),
      l: n(w.length_cm),
      w: n(w.width_cm),
      gsm: n(w.gsm),
      wastage: n(w.wastage_pct),
    })),
  };
}

function trimSpec(d: CostingDraft) {
  const pIndex = new Map(d.pieces.map((p, i) => [p.key, i]));
  return d.trims.map((x) => ({
    id: trimId(x),
    piece: pIndex.get(x.piece_key) ?? -1,
    qty: n(x.qty),
    pack: n(x.pack_size),
    direct: x.is_direct,
  }));
}

/** The rates of every row that also exists in `keep`'s keys, plus the sheet-wide ones. */
function rates(d: CostingDraft, keepFabric: Set<string>, keepTrim: Set<string>, keepPiece: Set<string>) {
  const h = d.header;
  const pieceKeyById = new Map(d.pieces.map((p) => [p.key, pieceId(p)]));
  return {
    fabrics: d.fabrics
      .filter((f) => keepFabric.has(fabricId(f)))
      .map((f) => ({
        id: fabricId(f),
        yarn: n(f.yarn_rate),
        knit: n(f.knitting_rate),
        dye: n(f.dyeing_rate),
        finish: n(f.finishing_rate),
        direct: n(f.direct_rate),
        yarns: f.yarns.map((y) => n(y.rate)),
        processes: f.processes.map((p) => n(p.rate)),
      })),
    trims: d.trims.filter((x) => keepTrim.has(trimId(x))).map((x) => ({ id: trimId(x), rate: n(x.rate), pack: n(x.pack_price) })),
    pieces: d.pieces
      .filter((p) => keepPiece.has(pieceId(p)))
      .map((p) => ({
        id: pieceId(p),
        cmt: n(p.cmt),
        direct: p.cmt_direct,
        lines: p.lines.map((l) => ({ kind: l.kind, what: l.process_id ?? t(l.process_name), rate: n(l.rate) })),
        testing: n(p.testing_cost),
        bank: n(p.bank_cost),
      })),
    terms: {
      currency: h.currency_code,
      ex: n(h.exchange_rate),
      margin: n(h.margin_pct),
      waste: n(h.garment_waste_pct),
      overhead: n(h.overhead_pct),
      discount: n(h.discount_pct),
      ship: t(h.ship_mode),
      freight: n(h.freight_per_pc),
      insurance: n(h.insurance_per_pc),
      target: n(h.buyer_target_price),
      commission: n(h.commission_pct),
    },
    quotes: Object.fromEntries(
      Object.entries(d.quotes)
        .map(([k, v]) => {
          const [pieceKey, size] = k.split("|");
          return [`${pieceKeyById.get(pieceKey) ?? pieceKey}|${size ?? ""}`, n(v)] as const;
        })
        .filter(([, v]) => v !== "")
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    extras: d.extras.map((e) => ({ name: t(e.name), value: n(e.value), kind: e.kind, sign: e.sign, section: e.section })),
  };
}

/**
 * The first change `next` makes that the revision's modules do not open, as a
 * sentence — or null when every change is inside them.
 */
export function costingRevisionProblem(
  parent: CostingDraft,
  next: CostingDraft,
  kinds: readonly RevisionKind[],
  revisionCode: string,
): string | null {
  const open = new Set(kinds);
  const closed = (k: RevisionKind, what: string) =>
    `Sample Revision ${revisionCode} does not open ${REVISION_KIND_LABEL[k]} — ${what} must stay as approved. Add that module to change it.`;

  if (parent.header.opportunity_id !== next.header.opportunity_id || parent.header.style_id !== next.header.style_id) {
    return `A costing revision keeps its sample and style — they cannot change in Sample Revision ${revisionCode}.`;
  }
  if (!open.has("fabric_spec") && !same(fabricSpec(parent), fabricSpec(next))) {
    return closed("fabric_spec", "the fabrics, yarn mix, processes and garment weights");
  }
  if (!open.has("trims") && !same(trimSpec(parent), trimSpec(next))) {
    return closed("trims", "the trims and their consumption");
  }
  if (!open.has("costing")) {
    const keepF = new Set(parent.fabrics.map(fabricId).filter((id) => next.fabrics.some((f) => fabricId(f) === id)));
    const keepT = new Set(parent.trims.map(trimId).filter((id) => next.trims.some((x) => trimId(x) === id)));
    const keepP = new Set(parent.pieces.map(pieceId).filter((id) => next.pieces.some((p) => pieceId(p) === id)));
    if (parent.pieces.length !== next.pieces.length || !same(parent.pieces.map(pieceId), next.pieces.map(pieceId))) {
      return closed("costing", "the garment pieces and their CMT");
    }
    if (!same(rates(parent, keepF, keepT, keepP), rates(next, keepF, keepT, keepP))) {
      return closed("costing", "every rate, the CMT, overheads, terms and quotes");
    }
  }
  return null;
}
