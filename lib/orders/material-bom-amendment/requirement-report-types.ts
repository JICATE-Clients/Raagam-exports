/**
 * The Material BOM Requirement report's shape — client-safe, so the sheet, the
 * generic report route and the PDF/Excel exporter share one type with the
 * server builder (`requirement-report.ts`) without importing `server-only`.
 */

/** One row — the Material BOM editor's Requirement tab, column for column. */
export type MbaRequirementRow = {
  key: string;
  /** "Item Name": material / specification / size, slash-joined. */
  material: string;
  colour: string;
  /** Before process loss. Null on a refused row. */
  calculated: number | null;
  /** After process loss — what the PO is capped against. Null when refused. */
  required: number | null;
  /** The engine's sentence, printed in place of Required Qty. */
  refusal: string | null;
  uom: string;
  /** `decimal_places_allowed` of the consumption unit — both figures are in it. */
  decimals: number | null;
  /**
   * WHAT IS ORDERED, in `purchaseUom` — the stored `purchase_qty`, null on a
   * line bought in the unit it is consumed in.
   *
   * IT TRAVELS WITH ITS UNIT AND IS NEVER PRINTED WITHOUT IT. The report
   * carried `purchaseUom` alone until 2026-09-20, so a button line showed
   * 5,225 (pieces) on the same row as GROSS and read as 5,225 gross.
   */
  purchaseQty: number | null;
  purchaseUom: string;
  /** `decimal_places_allowed` of the PURCHASE unit — `purchaseQty` is in it,
   *  and it is a different unit from `decimals` above, so it is a different
   *  precision (36.28 GROSS beside 5,225 NOS). */
  purchaseDecimals: number | null;
  stage: string;
};

export type MbaRequirementReport = {
  header: {
    bomCode: string | null;
    bomDate: string | null;
    computedAt: string | null;
    scNo: string | null;
    customer: string | null;
    orderNo: string | null;
    company: {
      name: string | null;
      address: string | null;
      gstin: string | null;
      logo: string | null;
    };
  };
  rows: MbaRequirementRow[];
};
