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
  purchaseUom: string;
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
