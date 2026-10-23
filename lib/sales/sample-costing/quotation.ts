/**
 * Sample Costing — the QUOTATION's model (2026-10-09).
 *
 * The buyer's document, as ONE display-ready object that the page and the PDF
 * both draw from — the same arrangement `cost-sheet.ts` makes for the internal
 * sheet — so what is read on screen is what is sent. PURE: no React, no server
 * import, and plain data only (no resolver functions), so it crosses the
 * server→client boundary.
 *
 * PRICES ONLY. Like the PDF it feeds, this model carries the quoted price per
 * piece and size and the set price — never the fabric rates, CMT, margin or
 * wastage behind them. Those live on the cost sheet, which is internal.
 */
import { MARGIN_RED_BELOW_PCT, costingSummary, type CostingSummary } from "./calc";
import { SHIP_MODES, STATUS_LABEL, costingInputOf, revisionShort, type CostingRecord, type CostingStatus } from "./types";
import type { CostingEnquiryOption, CostingStyleOption } from "./service";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import type { RevisionHistoryRow } from "./revision-history";
import { approvalLineForBuyer, type ApprovalFacts } from "./approval-line";

/** The price the buyer is offered: the quoted one, else the calculated one
 *  rounded to the cent — a quotation with a blank price is not a quotation. */
export const offered = (quoted: number | null, calc: number | null): number | null =>
  quoted ?? (calc == null ? null : Math.round(calc * 100) / 100);

/** "USD 4.30", or a dash when there is no price. */
export const priceText = (v: number | null, ccy: string | null): string =>
  v == null ? "—" : `${ccy ?? ""} ${v.toFixed(2)}`.trim();

export type QuotationLine = { piece: string; price: number | null };

export type QuotationGroup = {
  size: string | null;
  /** "S", "M" … or "All sizes". */
  label: string;
  lines: QuotationLine[];
  /** The set's price (pieces summed) — null when any piece has no price. */
  total: number | null;
};

/**
 * ONE STYLE OF THE QUOTATION (user 2026-10-22, screenshot 3667: "ready to adapt multi
 * styles listing"). A sample's styles are costed one sheet each; the quotation lists
 * every one, this costing's style first. PRICES ONLY, as the rest of the model.
 */
export type QuotationStyle = {
  costingId: string;
  costingNo: string | null;
  revision: string;
  style: string | null;
  description: string | null;
  thumbUrl: string | null;
  /** Each style carries its own: two sheets of one sample can be priced in two. */
  currency: string | null;
  isSet: boolean;
  unitWord: string;
  groups: QuotationGroup[];
  /** The figure a list reads first: the first size's set total, or its one piece. */
  headline: number | null;
};

/** A revision as the BUYER sees it: price and date, never the margin it earned. */
export type QuotationHistoryRow = Omit<RevisionHistoryRow, "marginPct">;

/** The history as the BUYER may see it — the margin each revision earned is dropped. */
export const historyForBuyer = (history: readonly RevisionHistoryRow[]): QuotationHistoryRow[] =>
  history.map(({ marginPct: _margin, ...row }) => row);

export type QuotationModel = {
  id: string;
  costingNo: string | null;
  revision: string;
  date: string | null;
  status: CostingStatus;
  statusLabel: string;
  approved: boolean;
  company: DocLetterhead;
  customer: string | null;
  enquiryNo: string | null;
  sampleNo: string | null;
  style: string | null;
  description: string | null;
  season: string | null;
  thumbUrl: string | null;
  currency: string | null;
  shipMode: string | null;
  isSet: boolean;
  /** "set" or "piece" — the unit a price is quoted per. */
  unitWord: string;
  groups: QuotationGroup[];
  /** Why this quotation may not go out yet, or null. Same two rules the list's
   *  icon and the editor's button already apply. */
  blocked: string | null;
  /** The PDF's own input, so the page's Download makes the identical document. */
  summary: CostingSummary;
  pieceNames: Record<string, string>;
  /** Every revision of this Costing No, oldest first — `[]` when never revised. PRICES ONLY. */
  history: QuotationHistoryRow[];
  /** "Approved on 09/10/2026" — or null. Never how, by whom, or at what margin. */
  approvalNote: string | null;
  /** Every costed style of this sample, this costing's first. One entry = today's
   *  single-style quotation; more = the styles listing. */
  styles: QuotationStyle[];
};

/** One costing as a style of the quotation: its pieces' offered prices, size by size. */
function styleOf(
  record: CostingRecord,
  styles: readonly CostingStyleOption[],
): QuotationStyle & { summary: CostingSummary; pieceNames: Record<string, string> } {
  const d = record.draft;
  const summary = costingSummary(costingInputOf(d));
  const style = styles.find((s) => s.id === d.header.style_id) ?? null;
  const pieceNames: Record<string, string> = Object.fromEntries(d.pieces.map((p) => [p.key, p.piece_name || "GARMENT"]));
  const isSet = style?.unit_kind === "set" || d.pieces.length > 1;
  const groups: QuotationGroup[] = summary.groups.map((g) => {
    const lines = g.pieces.map((p) => ({ piece: pieceNames[p.pieceKey] ?? "GARMENT", price: offered(p.quoted, p.calc) }));
    return {
      size: g.size,
      label: g.size ?? "All sizes",
      lines,
      total: lines.every((l) => l.price != null) ? lines.reduce((t, l) => t + (l.price ?? 0), 0) : null,
    };
  });
  const first = groups[0];
  return {
    costingId: record.id,
    costingNo: record.code,
    revision: revisionShort(record.version),
    style: style?.name ?? null,
    description: style?.description ?? null,
    thumbUrl: style?.report_image_url ?? null, // the ticked "Print on reports" picture (0731)
    currency: d.header.currency_code,
    isSet,
    unitWord: isSet ? "set" : "piece",
    groups,
    headline: first ? (isSet ? first.total : (first.lines[0]?.price ?? null)) : null,
    summary,
    pieceNames,
  };
}

export function buildQuotationModel(
  record: CostingRecord,
  lookups: { enquiries: readonly CostingEnquiryOption[]; styles: readonly CostingStyleOption[] },
  company: DocLetterhead,
  history: RevisionHistoryRow[] = [],
  approvalFacts: ApprovalFacts | null = null,
  /** The sample's OTHER styles, each as its latest costing (`getSiblingCostingRecords`). */
  siblings: readonly CostingRecord[] = [],
): QuotationModel {
  const d = record.draft;
  const h = d.header;
  const enq = lookups.enquiries.find((e) => e.id === h.opportunity_id) ?? null;
  const own = styleOf(record, lookups.styles);
  const { summary, pieceNames, isSet, groups } = own;
  const style = lookups.styles.find((s) => s.id === h.style_id) ?? null;

  const approved = record.status === "approved";
  const blocked = !h.currency_code
    ? "This costing has no currency yet, so there is no quotation to send."
    : summary.lowestMarginPct != null && summary.lowestMarginPct < MARGIN_RED_BELOW_PCT && !approved
      ? `Margin under ${MARGIN_RED_BELOW_PCT}% — the quotation waits until the costing is approved.`
      : null;

  return {
    id: record.id,
    costingNo: record.code,
    revision: revisionShort(record.version),
    date: h.costing_date || null,
    status: record.status,
    statusLabel: record.is_draft ? "Draft" : STATUS_LABEL[record.status],
    approved,
    company,
    customer: enq?.customer_name ?? null,
    enquiryNo: enq?.code ?? null,
    // The SMP Number, never the style line's PRD (client 2026-10-14).
    sampleNo: enq?.code ?? null,
    style: style?.name ?? null,
    description: style?.description ?? null,
    season: [enq?.season, enq?.season_year].filter(Boolean).join(" ") || null,
    thumbUrl: style?.report_image_url ?? null, // the ticked "Print on reports" picture (0731)
    currency: h.currency_code,
    shipMode: SHIP_MODES.find((x) => x.value === h.ship_mode)?.label ?? null,
    isSet,
    unitWord: isSet ? "set" : "piece",
    groups,
    blocked,
    summary,
    pieceNames,
    /* The margin is dropped HERE, at the model, so no drawing of this document
       — page or PDF — can print what the buyer must not see. */
    history: historyForBuyer(history),
    approvalNote: approved
      ? approvalLineForBuyer(
          approvalFacts ?? { status: record.status, isDraft: record.is_draft, submittedAt: null, approvedAt: null, decidedByName: null, decidedAt: null, remark: null, lowestMarginPct: null },
        )
      : null,
    // This costing's style first, then the sample's other styles in their own order.
    styles: [
      own,
      ...[...siblings]
        .sort((a, b) => lookups.styles.findIndex((s) => s.id === a.draft.header.style_id) - lookups.styles.findIndex((s) => s.id === b.draft.header.style_id))
        .map((r) => styleOf(r, lookups.styles)),
    ].map(({ summary: _s, pieceNames: _p, ...st }) => st),
  };
}
