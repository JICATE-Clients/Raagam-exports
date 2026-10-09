/**
 * Sample Costing — the REVISION HISTORY a report prints (client 2026-10-09: "the
 * sample rev will happen in the report").
 *
 * A costing is revised when a buyer pushes the price: the merchandiser revises
 * the sheet, saving it steps the counter Rev 0 → Rev 1 → Rev 2 (`revise` in the
 * editor, version + 1), and the old one is superseded. The editor already lists
 * them and compares two; this is the same list on the REPORT, so the document
 * a reader holds says where in the negotiation it stands.
 *
 * PURE, plain data. It is built once and drawn three ways — the Cost Sheet
 * (internal, with margin), the Quotation (buyer-facing, PRICES ONLY) and both
 * PDFs — so they cannot disagree about which revision is current or what the
 * price moved by.
 */
import { STATUS_LABEL, revisionLabel, type CostingStatus } from "./types";

/** One stored revision, as the reports page reads it. */
export type RevisionSource = {
  id: string;
  version: number;
  status: CostingStatus;
  is_draft: boolean | null;
  costing_date: string | null;
  computed_fob: number | null;
  target_fob: number | null;
  profit_loss_pct: number | null;
  currency_code: string | null;
};

export type RevisionHistoryRow = {
  id: string;
  version: number;
  /** "Original (Rev 0)", "Rev 1" … */
  label: string;
  date: string | null;
  statusLabel: string;
  /** The price that revision carried: the quoted one, else the calculated one. */
  price: number | null;
  /** Price change against the revision before it, as a percentage; null for the first. */
  changePct: number | null;
  /** Effective margin — INTERNAL. The buyer-facing Quotation drops it. */
  marginPct: number | null;
  /** The revision this report is of. */
  current: boolean;
};

const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * Oldest first. A history of ONE revision is `[]`: a table with one row says
 * nothing a header does not, and its absence is how an un-negotiated costing
 * reads as exactly that.
 */
export function buildRevisionHistory(sources: readonly RevisionSource[], currentId: string): RevisionHistoryRow[] {
  const sorted = [...sources].sort((a, b) => a.version - b.version);
  if (sorted.length < 2) return [];
  let prev: number | null = null;
  return sorted.map((r) => {
    const price = r.target_fob != null ? Number(r.target_fob) : r.computed_fob != null ? cents(Number(r.computed_fob)) : null;
    const changePct = prev != null && price != null && prev !== 0 ? Math.round(((price - prev) / prev) * 1000) / 10 : null;
    if (price != null) prev = price;
    return {
      id: r.id,
      version: r.version,
      label: revisionLabel(r.version),
      date: r.costing_date,
      statusLabel: r.is_draft ? "Draft" : STATUS_LABEL[r.status],
      price,
      changePct,
      marginPct: r.profit_loss_pct == null ? null : Number(r.profit_loss_pct),
      current: r.id === currentId,
    };
  });
}

/** "−7.9%", "+2.0%", or a dash for the first revision / an unpriced one. */
export function changeText(pct: number | null): string {
  if (pct == null) return "—";
  if (pct === 0) return "no change";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}
