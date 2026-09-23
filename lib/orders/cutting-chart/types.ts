/**
 * The Cutting Chart's shape — client-safe (no `server-only`), so the document
 * view and the PDF/Excel exporter import the same type the loader returns.
 * Plain data throughout: V_final (0619) freezes it into jsonb verbatim.
 */

/** One figure per size, index-aligned with `CuttingChart.sizes`. */
export type CuttingFigures = {
  order: number[];
  excess: number[];
  approval: number[];
  rejection: number[];
  total: number[];
};

export type CuttingColour = { combo: string; figures: CuttingFigures };

export type CuttingStyle = {
  styleRefNo: string | null;
  styleName: string | null;
  colours: CuttingColour[];
};

export type CuttingChart = {
  header: {
    scNo: string | null;
    date: string | null;
    customer: string | null;
    deliveryFrom: string | null;
    deliveryTo: string | null;
    orderNo: string | null;
    excessPct: number;
    orderQty: number;
    excessQty: number;
    approvalQty: number;
    netQty: number;
    rejectionQty: number;
    cutQty: number;
    company: {
      name: string | null;
      address: string | null;
      unit: string | null;
      gstin: string | null;
      logo: string | null;
    };
  };
  sizes: { key: string; label: string }[];
  styles: CuttingStyle[];
  /** The RE total — every style and colour summed, size by size. */
  total: CuttingFigures;
};

/** The rows of one block, in the legacy order. Excess only when the order has
 *  an excess % — a row of blanks on every order without one is noise. */
export function cuttingRows(c: CuttingChart): { key: keyof CuttingFigures; label: string }[] {
  return [
    { key: "order", label: "Order" },
    ...(c.header.excessPct > 0 ? [{ key: "excess" as const, label: "Excess" }] : []),
    { key: "approval", label: "Approval" },
    { key: "rejection", label: "Rej.Allow" },
    { key: "total", label: "Total" },
  ];
}

/** Legacy prints a zero as a blank cell. */
export function cuttingCell(n: number): string {
  return n ? n.toLocaleString("en-IN") : "";
}

export function sumOf(xs: readonly number[]): number {
  return xs.reduce((a, x) => a + x, 0);
}
