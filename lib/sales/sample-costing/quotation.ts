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
};

export function buildQuotationModel(
  record: CostingRecord,
  lookups: { enquiries: readonly CostingEnquiryOption[]; styles: readonly CostingStyleOption[] },
  company: DocLetterhead,
  history: RevisionHistoryRow[] = [],
): QuotationModel {
  const d = record.draft;
  const h = d.header;
  const summary = costingSummary(costingInputOf(d));
  const enq = lookups.enquiries.find((e) => e.id === h.opportunity_id) ?? null;
  const style = lookups.styles.find((s) => s.id === h.style_id) ?? null;
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
    sampleNo: style?.sample_no ?? null,
    style: style?.name ?? null,
    description: style?.description ?? null,
    season: [enq?.season, enq?.season_year].filter(Boolean).join(" ") || null,
    thumbUrl: style?.thumb_url ?? null,
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
  };
}
