/**
 * ORDERS ▸ SEASON REPORT — the shapes (client audio brief, 2026-10-09).
 *
 * One question: "what is committed to this season, and what is still to ship?"
 * Everything here is plain data — built on the server, drawn by the screen and
 * the PDF — so a resolver function never has to cross the boundary.
 */

import type { RiskLevel } from "@/lib/orders/progress/engine";

/**
 * Where an order stands for the SEASON's purpose — shipped or not, not the
 * fifteen stages Order Progress walks. Derived (`fulfilmentOf`); nothing here
 * is stored, so the report cannot fall behind the documents it reads.
 *
 *   shipped        every piece has left, or the RE is closed out
 *   partial        some pieces have shipped and a balance remains
 *   in_production  nothing has shipped yet, but the floor has started
 *   pending        confirmed and not started
 */
export type Fulfilment = "pending" | "in_production" | "partial" | "shipped";

export const FULFILMENT_ORDER: readonly Fulfilment[] = ["shipped", "partial", "in_production", "pending"];

export const FULFILMENT_LABEL: Record<Fulfilment, string> = {
  shipped: "Shipped",
  partial: "Part shipped",
  in_production: "In production",
  pending: "Pending",
};

/** One style line of an order — enough for the Summary's chips. */
export type SeasonStyle = {
  styleRef: string;
  /** The style's own description, else its category. */
  description: string | null;
  qty: number;
};

/**
 * Fabric for the order, from its CURRENT Fabric BOM and the purchase lines
 * raised against the RE.
 *
 * `balanceKg` is NULL — never 0 — when it cannot be answered: no Fabric BOM yet,
 * or fabric lines bought in a unit other than the kilogram. A 0 there would read
 * as "nothing left to receive", which is the believable-empty answer AGENTS.md
 * warns about; `note` says why instead.
 */
export type SeasonFabric = {
  requiredKg: number | null;
  receivedKg: number | null;
  balanceKg: number | null;
  note: string | null;
};

export type SeasonOrder = {
  salesOrderId: string;
  amendmentId: string;
  /** `sales_orders.order_number`, verbatim (HO/RE/26-27/0001 or U2/RE//2526/2047). */
  reNo: string | null;
  customer: string | null;
  poNo: string | null;
  merchandiser: string | null;
  season: string | null;
  year: number | null;
  /** Earliest line delivery, else the document header's. */
  deliveryDate: string | null;
  qty: number;
  shippedQty: number;
  /** Pieces still to ship — never negative. */
  balanceQty: number;
  fulfilment: Fulfilment;
  riskLevel: RiskLevel;
  riskLabel: string;
  /** Days past delivery (late) or the projected slip (at risk). 0 otherwise. */
  daysLate: number;
  /** The stage holding the order up, in words, when it is late or at risk. */
  cause: string | null;
  styles: SeasonStyle[];
  /** A signed picture link for the order's primary style image. */
  thumbnail: string | null;
  fabric: SeasonFabric;
};

/** What the filter bar offers — what actually exists, never a guess. */
export type SeasonOptions = {
  /** Seasons present on orders ∪ the closed list Order Info offers. */
  seasons: string[];
  /** Years present on orders ∪ a window around this one. */
  years: number[];
};

export type SeasonReport = {
  /** The season asked for ("" = every season). */
  season: string;
  /** The year asked for (null = every year). */
  year: number | null;
  options: SeasonOptions;
  orders: SeasonOrder[];
  /** Orders in the chosen season with NO year, hidden by a year filter — said
   *  on screen so a missing Year on Order Info never reads as "no orders". */
  withoutYear: number;
  /** Cancelled orders left out of the report. */
  cancelled: number;
  today: string;
};

// ---------------------------------------------------------------------------
// Detailed format — colour × size per style
// ---------------------------------------------------------------------------

export type SeasonMatrixRow = {
  combo: string;
  /** Index-aligned with `columns`; null = no break-up declared for that size. */
  cells: (number | null)[];
  total: number;
};

export type SeasonStyleDetail = {
  styleRef: string;
  styleCode: string | null;
  description: string | null;
  articleNo: string | null;
  qty: number;
  /** The sentence to print instead of a matrix when it cannot be built. */
  refused: string | null;
  columns: string[];
  rows: SeasonMatrixRow[];
  columnTotals: number[];
  total: number;
};

export type SeasonDetail = {
  salesOrderId: string;
  styles: SeasonStyleDetail[];
  /** Pieces on the order that name no declared style (GOS orphans). */
  orphanQty: number;
};
