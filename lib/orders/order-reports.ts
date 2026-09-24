/**
 * THE ORDER'S REPORTS — one declaration per per-order document.
 *
 * Every report printed for ONE order (an RE Number) is declared here and
 * nowhere else. Three readers map over this array, so a report added here is
 * linked everywhere at once:
 *
 * - `OrderDocumentTabs` — the strip on every order document page, which is
 *   where Order Entry's row-menu "Reports" lands;
 * - the Fabric BOM editor's own Reports sheet (`FabricBomReportsSheet`), whose
 *   tabs are the `fabric-bom` entries below with no `page`;
 * - `/orders/<id>/reports/<key>`, the generic route that gives each of those
 *   sheet reports a URL keyed on the order.
 *
 * ## WHY IT EXISTS (client 2026-09-19)
 *
 * "Order Entry ▸ Reports is not linked with the actual report." It was not: the
 * strip was a hand-typed list of three (Order sheet, Material BOM, Fabric BOM),
 * and the three reports built after it — Fabric BOM Entry Register, Yarn &
 * Fabric Requirement, Printing Requirement — lived only behind a button inside
 * the Fabric BOM editor. Each new report was built correctly and linked to
 * nothing the operator opens from the order. Two hand-kept lists drifting is
 * the same failure `lib/reports/catalog.ts` and `lib/nav/module-groups.ts`
 * record; the answer is the same too — one list, many readers.
 *
 * ## PLAIN DATA, ON PURPOSE
 *
 * No lucide imports: `scripts/check-order-reports.mts` loads this file with
 * Node's type stripping, which cannot resolve `@/` or JSX. Icons are named here
 * and resolved to components by the one reader that draws them.
 *
 * ## ADDING A REPORT
 *
 * 1. Add an entry below.
 * 2. Either give it its own page (`page: "<folder>"` under
 *    `app/(app)/orders/[orderId]/`, rendering `<OrderDocumentTabs current=…>`),
 *    or leave `page` off and let `/orders/<id>/reports/<key>` serve it — for a
 *    `fabric-bom` report that means one view in `FABRIC_BOM_REPORT_VIEWS`,
 *    which TypeScript will demand the moment the key exists.
 * 3. `npm run check:order-reports` (inside `build:check`) fails until the two
 *    halves agree.
 */

/** Which document the report is computed FROM — also the strip's group heading. */
export type OrderReportSource = "order" | "material-bom" | "fabric-bom" | "budget";

export type OrderReportIcon =
  | "file-text"
  | "clipboard-list"
  | "layers"
  | "table"
  | "spool"
  | "printer"
  | "scissors"
  | "wallet";

/**
 * WHICH LOADER'S OUTPUT IS FROZEN AS V_FINAL (doc/order/amenment update.md
 * §4B, 0619). While an order is amending, every report serves the approved
 * version — the report exactly as its own loader rendered it when the entry
 * was raised (`lib/orders/amendments/v-final.ts`). Several reports read one
 * loader (Printing Requirement reads the Yarn & Fabric Requirement object), so
 * this names the LOADER, and the capture runs each one once.
 *
 * REQUIRED on every entry, deliberately: a report registered without one would
 * print the in-flight amendment on the shop floor.
 */
export type VFinalSource =
  | "gos"
  | "requirement-sheet"
  | "fabric-requirement-sheet"
  | "fabric-bom-reports"
  | "material-bom-requirement"
  | "cutting-chart"
  | "order-budget";

export const V_FINAL_SOURCES: readonly VFinalSource[] = [
  "gos",
  "requirement-sheet",
  "fabric-requirement-sheet",
  "fabric-bom-reports",
  "material-bom-requirement",
  "cutting-chart",
  "order-budget",
];

export interface OrderReportDef {
  /** Stable id; also the URL segment for a report without its own `page`. */
  readonly key: string;
  readonly label: string;
  readonly source: OrderReportSource;
  readonly icon: OrderReportIcon;
  /**
   * The report's own folder under `app/(app)/orders/[orderId]/`. Omitted →
   * served by the generic `/orders/<id>/reports/<key>` route.
   */
  readonly page?: string;
  /** The loader whose frozen output is this report's V_final — see `VFinalSource`. */
  readonly vFinal: VFinalSource;
  /**
   * `false` → NOT on Order Entry's Reports strip (client 2026-09-23: "need
   * these five reports only"). The report stays registered — its editor's own
   * Reports sheet, its URL and its V_final capture are untouched — so this
   * narrows one reader, never deletes a report. See `onOrderStrip`.
   */
  readonly orderStrip?: false;
}

export const ORDER_REPORT_SOURCES: readonly { source: OrderReportSource; label: string }[] = [
  { source: "order", label: "Order" },
  { source: "material-bom", label: "Material BOM" },
  { source: "fabric-bom", label: "Fabric BOM" },
  { source: "budget", label: "Budget" },
];

export const ORDER_REPORTS = [
  { key: "gos", label: "Garment Order Sheet", source: "order", icon: "file-text", page: "gos", vFinal: "gos" },
  /* THE LEGACY RP "CUTTING CHART" (client 2026-09-23, Cutting Qty Chart.pdf) —
     per colour × size: Order, Approval, Rej.Allow and their Total, the pieces
     the cutting table is asked for. Same arithmetic as Approval Qty's breakup. */
  { key: "cutting-chart", label: "Cutting Chart", source: "order", icon: "scissors", page: "cutting-chart", vFinal: "cutting-chart" },
  /* ON ORDER ENTRY'S STRIP SINCE 2026-09-24 (client: "instead of the Fabric
     BOM Entry Register … Accessories Requirement", in the RP printout's format —
     "Accessories Requirement.pdf"). It took the register's place there. */
  {
    key: "material",
    label: "Accessories Requirement",
    source: "material-bom",
    icon: "clipboard-list",
    page: "requirement",
    vFinal: "requirement-sheet",
  },
  /* THE EDITOR'S REQUIREMENT TAB, ON PAPER (client 2026-09-20) — Item Name,
     Item Color, Calculated Qty, Required Qty, Uom, Purchase Uom, Stage. Not a
     second copy of "Accessories Requirement" above: that one groups by category
     and splits by size for a supplier; this one is the tab the merchandiser
     approved, row for row. */
  {
    key: "material-bom-requirement",
    label: "Material BOM Requirement",
    source: "material-bom",
    icon: "table",
    vFinal: "material-bom-requirement",
    orderStrip: false,
  },
  {
    key: "fabric",
    label: "Fabric Requirement",
    source: "fabric-bom",
    icon: "layers",
    page: "fabric-requirement",
    vFinal: "fabric-requirement-sheet",
    orderStrip: false,
  },
  /* OFF ORDER ENTRY'S STRIP SINCE 2026-09-24 — Accessories Requirement took
     its place there (client). Still registered: the Fabric BOM editor's own
     Reports sheet, its URL and its V_final capture are unchanged. */
  {
    key: "fabric-bom-register",
    label: "Fabric BOM Entry Register",
    source: "fabric-bom",
    icon: "table",
    vFinal: "fabric-bom-reports",
    orderStrip: false,
  },
  { key: "yarn-fabric-requirement", label: "Yarn & Fabric Requirement", source: "fabric-bom", icon: "spool", vFinal: "fabric-bom-reports" },
  /* The weight sent to the printer (client 2026-09-19) — read off the SAME
     report object as Yarn & Fabric Requirement, so the two never disagree. */
  {
    key: "printing-requirement",
    label: "Printing Requirement",
    source: "fabric-bom",
    icon: "printer",
    vFinal: "fabric-bom-reports",
    orderStrip: false,
  },
  /* THE ORDER BUDGET & PROFIT MARGIN report (client 2026-09-23) — the budget
     the MD authorises, on paper: income, itemised expenses, net profit and
     margin; while amending, the approved margin beside the proposed one. */
  { key: "budget", label: "Order Budget", source: "budget", icon: "wallet", page: "budget", vFinal: "order-budget" },
] as const satisfies readonly OrderReportDef[];

type Entry = (typeof ORDER_REPORTS)[number];

export type OrderReportKey = Entry["key"];

/** The Fabric BOM reports served by the generic route and the editor's sheet. */
export type FabricBomReportKey = Exclude<Extract<Entry, { source: "fabric-bom" }>, { page: string }>["key"];

/* Generic so `ORDER_REPORTS.filter(isFabricBomSheetReport)` narrows the
   registry's own literal entries: a predicate over the wide `OrderReportDef` is
   not a subtype of them, and `filter` silently falls back to its un-narrowed
   overload. */
export function isFabricBomSheetReport<R extends OrderReportDef>(r: R): r is R & { key: FabricBomReportKey } {
  return r.source === "fabric-bom" && r.page == null;
}

/** The Material BOM reports served by the generic route and the editor's sheet. */
export type MaterialBomReportKey = Exclude<Extract<Entry, { source: "material-bom" }>, { page: string }>["key"];

export function isMaterialBomSheetReport<R extends OrderReportDef>(r: R): r is R & { key: MaterialBomReportKey } {
  return r.source === "material-bom" && r.page == null;
}

/**
 * ORDER ENTRY'S REPORTS STRIP (client 2026-09-23). The client's list is five
 * outputs: the Garment Order Sheet, the Accessories Requirement (in the Fabric
 * BOM Entry Register's place since 2026-09-24), Yarn & Fabric Requirement, and
 * the Order Budget & Profit Margin report — plus the Cutting Chart. Everything
 * else is marked `orderStrip: false`. The page being shown always stays on the strip, so a
 * report reached from its editor still reads as "you are here".
 */
export function onOrderStrip(r: OrderReportDef, current?: string): boolean {
  return r.orderStrip !== false || r.key === current;
}

export function findOrderReport(key: string): OrderReportDef | undefined {
  return (ORDER_REPORTS as readonly OrderReportDef[]).find((r) => r.key === key);
}

export function orderReportHref(orderId: string, r: OrderReportDef): string {
  return `/orders/${orderId}/${r.page ?? `reports/${r.key}`}`;
}
