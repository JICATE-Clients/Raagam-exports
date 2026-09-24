/**
 * The Garment Order Sheet's shared wording — client-safe, so the on-screen
 * document, the PDF and the spreadsheet print every fact the same way.
 */
import { fmtDate, fmtNumber } from "@/lib/format";
import type { GosPanel, GosSheet, GosStyle } from "./types";

/** The one absent-value token on the sheet: "the system holds no value here".
 *  A digit — including 0 — means it holds that value. Never interchanged. */
export const DASH = "—";

export const txt = (v: string | null | undefined) => (v && v.trim() ? v : DASH);

/**
 * THE HEADER FACTS AS THE ORDER DOCUMENTS' FOUR BOXED COLUMNS, each read down
 * (the Cutting Chart and Budget Statement layout). S No is the amendment's own
 * code (GOA-0011), not a count of anything.
 */
export function gosHeaderColumns(sheet: GosSheet): [string, string][][] {
  const h = sheet.header;
  return [
    [
      ["S No", txt(h.sNo)],
      ["Approved Sample No", txt(h.approvedSampleNo)],
      ["Season", txt(h.season)],
    ],
    [
      ["Customer", txt(h.customerName)],
      ["Country", txt(h.countryName)],
      ["Merchandiser", txt(h.merchandiser)],
    ],
    [
      ["Order No (Customer PO)", txt(h.poNo)],
      ["PO Date", fmtDate(h.poDate)],
    ],
    [
      ["Order Date", fmtDate(h.orderDate)],
      ["Delivery Date", fmtDate(h.deliveryDate)],
    ],
  ];
}

/** "Set · 2 coordinates" — piece vs set with the count beside it. */
export function gosUnitText(style: GosStyle): string {
  const n = `${style.coordinateCount} coordinate${style.coordinateCount === 1 ? "" : "s"}`;
  return style.unitKindLabel ? `${style.unitKindLabel} · ${n}` : n;
}

/** A style block's facts, in reading order. */
export function gosStyleFacts(style: GosStyle): [string, string][] {
  return [
    ["Style Ref", txt(style.styleRef)],
    ["Article No", txt(style.articleNo)],
    ["Approved Sample No", txt(style.approvedSampleNo)],
    // "Approved (V2)" / "Pending" (0628, §6.2) — red when pending, on screen and in the PDF.
    ["CAD", style.cad ? style.cad.text : DASH],
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
