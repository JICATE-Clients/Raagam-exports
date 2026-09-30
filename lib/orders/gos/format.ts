/**
 * The Garment Order Sheet's shared wording — client-safe, so the on-screen
 * document, the PDF and the spreadsheet print every fact the same way.
 */
import { fmtDate, fmtNumber } from "@/lib/format";
import { isRefusal, type GosPanel, type GosSheet, type GosStyle } from "./types";

/** The one absent-value token on the sheet: "the system holds no value here".
 *  A digit — including 0 — means it holds that value. Never interchanged. */
export const DASH = "—";

export const txt = (v: string | null | undefined) => (v && v.trim() ? v : DASH);

/**
 * THE HEADER FACTS AS THE ORDER DOCUMENTS' FOUR BOXED COLUMNS, each read down
 * (the Cutting Chart and Budget Statement layout).
 *
 * TWO FACTS LEFT THIS GRID (client 2026-09-29): "S No" — the amendment's own
 * code (GOA-0011), redundant beside the RE Number the sheet is headed by — and
 * "Approved Sample No", which printed twice. It is a STYLE's fact
 * (`garment_styles.approved_sample_id`) and the header copy was only ever the
 * one-style case (`sheet.ts`), blank on every multi-style order, so the one
 * kept is the style block's.
 *
 * "EARLIER SHIPMENT DATE" IS THAT FIELD'S VALUE, NOT A RELABELLED DELIVERY
 * DATE (client 2026-09-29 asked for the header date to read Earlier Shipment
 * Date). Order Entry holds both — `delivery_date`, and `earlier_shipment_date`
 * per Quantities row, defaulting to a week earlier — so printing the delivery
 * date under the other's name would state a date a week late. It is the
 * EARLIEST across the destinations, Order Entry's own SHIP DATE rule.
 */
export function gosHeaderColumns(sheet: GosSheet): [string, string][][] {
  const h = sheet.header;
  return [
    [
      ["Customer", txt(h.customerName)],
      ["Country", txt(h.countryName)],
    ],
    [
      ["Season", txt(h.season)],
      ["Merchandiser", txt(h.merchandiser)],
    ],
    [
      ["Order No (Customer PO)", txt(h.poNo)],
      ["PO Date", fmtDate(h.poDate)],
    ],
    [
      ["Order Date", fmtDate(h.orderDate)],
      ["Earlier Shipment Date", fmtDate(earliestShipment(sheet))],
    ],
  ];
}

/**
 * THE SAME FACTS FOR THE SHEET FORMAT (user 2026-09-29, the approved "Raagam
 * Requirement Sheet" design) — label / value / grey sub-line, read across a
 * grid beside the style picture. The delivery date rides UNDER the Earlier
 * Shipment Date as its sub-line (the approved design's own pairing), so it is
 * stated without taking the other's name. `gosHeaderColumns` stays for the
 * spreadsheet, which has no grid.
 */
export function gosHeaderFacts(sheet: GosSheet): { label: string; value: string; sub?: string | null }[] {
  const h = sheet.header;
  return [
    { label: "Customer", value: txt(h.customerName) },
    { label: "Country", value: txt(h.countryName) },
    { label: "Season", value: txt(h.season) },
    { label: "Merchandiser", value: txt(h.merchandiser) },
    { label: "Order No (Customer PO)", value: txt(h.poNo) },
    { label: "PO Date", value: fmtDate(h.poDate) },
    { label: "Order Date", value: fmtDate(h.orderDate) },
    {
      label: "Earlier Shipment Date",
      value: fmtDate(earliestShipment(sheet)),
      sub: h.deliveryDate ? `Delivery ${fmtDate(h.deliveryDate)}` : null,
    },
  ];
}

/** The figures the sheet is picked up for — the summary tiles, screen and PDF. */
export function gosSummary(sheet: GosSheet): { label: string; value: string; unit?: string; note?: string }[] {
  const colourways = [...new Set(sheet.styles.flatMap((s) => (isRefusal(s.matrix) ? s.colourways : s.matrix.rows.map((r) => r.combo))))];
  const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max}` : xs.join(", "));
  const tiles: { label: string; value: string; unit?: string; note?: string }[] = [
    { label: "Order total", value: fmtNumber(sheet.grandTotal), unit: "pcs" },
    {
      label: "Styles",
      value: String(sheet.styles.length),
      note: list(sheet.styles.map((s) => txt(s.styleRef)), 3),
    },
    { label: "Colourways", value: String(colourways.length), note: list(colourways) },
  ];
  if (sheet.destinations.length > 0) {
    tiles.push({
      label: "Destinations",
      value: String(sheet.destinations.length),
      note: list(sheet.destinations.map((d) => d.label), 3),
    });
  }
  return tiles;
}

/** The earliest Earlier Shipment Date across the order's destinations (ISO
 *  dates compare as text); null when no destination has one — never the
 *  delivery date standing in for it. */
export function earliestShipment(sheet: GosSheet): string | null {
  const dates = sheet.destinations.map((d) => (d.earlierShipmentDate ?? "").trim()).filter(Boolean);
  return dates.length ? dates.sort()[0] : null;
}

/** "Set · 2 coordinates" — piece vs set with the count beside it. */
export function gosUnitText(style: GosStyle): string {
  const n = `${style.coordinateCount} coordinate${style.coordinateCount === 1 ? "" : "s"}`;
  return style.unitKindLabel ? `${style.unitKindLabel} · ${n}` : n;
}

/** A style block's facts, in reading order. */
export function gosStyleFacts(style: GosStyle): [string, string][] {
  return [
    // "Style", never "Style Ref" (user 2026-09-29) — it is Order Entry's Style.
    ["Style", txt(style.styleRef)],
    ["Article No", txt(style.articleNo)],
    ["Approved Sample No", txt(style.approvedSampleNo)],
    /* NO "CAD" FACT (client 2026-09-29) — the CAD status left the sheet. The
       CAD PENDING stamp on the Fabric BOM reports is a different thing and
       stays. */
    ["Unit", gosUnitText(style)],
    ["Description", txt(style.description)],
  ];
}

/** The style block's title — its STL code, then its name. */
export function gosStyleTitle(style: GosStyle): string {
  return `${txt(style.styleCode ?? style.styleRef)}${style.styleName ? ` · ${style.styleName}` : ""}`;
}

/** GSM with its tolerance — one specification, so they print together. */
export function gosGsmText(p: GosPanel): string {
  if (p.gsm == null) return DASH;
  return `${fmtNumber(p.gsm)}${p.gsmTolerance == null ? "" : ` ±${fmtNumber(p.gsmTolerance)}`}`;
}

/** A panel's colour in one colourway, with its print under it. */
export function gosColourText(v: GosPanel["colours"][number]): string {
  if (v === null) return DASH;
  return v.print ? `${txt(v.colour)}\n${v.print}` : txt(v.colour);
}

export const CONSTRUCTION_ONLY =
  "Construction only. Buttons, sewing threads, labels and all other trims and accessories are on the Accessories Requirement Sheet.";
