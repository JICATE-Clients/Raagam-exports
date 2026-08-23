/**
 * BUILDING THE GARMENT ORDER SHEET — every rule, in one pure module.
 *
 * Nothing here touches the database, React or `server-only`. The service
 * resolves ids to names and hands this a plain object; this decides what the
 * sheet SAYS. That split is the whole reason `scripts/check-gos-sheet.mts` can
 * exist, and it is the lesson `lib/orders/amendments/assort-style.ts` records at
 * length: four arrow functions inside a 10,000-line screen produced the same
 * defect twice in two days because nothing could import them and so nothing
 * could assert them.
 *
 * ## THE STYLE A SIZE CELL BELONGS TO
 *
 * This is the one piece of arithmetic the sheet cannot borrow wholesale.
 * `assortSizeWeights` (lib/orders/assort-weights.ts) already owns the
 * multiplication — solid packs count the cell, assort packs multiply it by
 * cartons x inners — and this module calls `assortMode` for exactly that. But it
 * attributes every cell to `quantities.style_ref_no`, the DESTINATION's
 * reference, and that field stopped being a style reference on 2026-08-17 on the
 * client's instruction ("only free text, no more fetching from any table").
 *
 * On the live order HO/RE/26-27/0009 the destination's ref is `111`, the
 * assortment lines say `STL/26-27/0007`, and the Combos tab says
 * `STL/26-27/0007`. `assortSizeWeights` therefore labels 1,000 pieces `111`,
 * which matches no declared style and pairs with no colourway. A GOS built on
 * that would print a style with an empty size matrix beside a colourway list
 * that is fully populated — and an empty matrix is exactly what an order nobody
 * has broken up yet looks like.
 *
 * So the attribution here goes through `assortLineRef` (the line's own ref
 * first, the destination's inherited style second) and is then CHECKED against
 * the order's declared styles. Anything that still lands nowhere becomes a
 * `GosOrphan` and is printed. See the note on that type: pieces missing from a
 * shop-floor sheet are pieces nobody cuts.
 */

import { assortMode } from "@/lib/orders/assort-weights";
import { assortLineRef, declaredStyleRefs } from "@/lib/orders/amendments/assort-style";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { coordinateLimit, unitKindLabel } from "@/lib/orders/styles/rules";
import type {
  GosCoordinateBlock,
  GosDestination,
  GosMatrix,
  GosMatrixRow,
  GosOrphan,
  GosPanel,
  GosSheet,
  GosSizeColumn,
  GosStyle,
  Refusal,
} from "./types";

// ---------------------------------------------------------------------------
// What the builder reads — never more.
//
// Declared structurally rather than imported from `lib/orders/amendments/types`
// so a fixture in the vector script is a few lines rather than a full
// `GarmentOrderAmendment`, and so a change to a column this sheet does not read
// cannot break the build here.
// ---------------------------------------------------------------------------

export type SrcStyle = {
  sno: number;
  style_ref_no: string | null;
  article_no: string | null;
  style_description: string | null;
  description: string | null;
  po_qty: number;
  /** Resolved from `garment_styles` via `style_id`, or null when the order's
   *  style line names no master style. */
  style_code: string | null;
  style_name: string | null;
  unit_kind: string | null;
  approved_sample_no: string | null;
};

/** One size of one style, in DECLARED ORDER (0407 — "order IS the data"). */
export type SrcStyleSize = {
  style_ref_no: string | null;
  sno: number;
  size_id: string | null;
};

export type SrcComponent = {
  sno: number;
  coordinate_id: string | null;
  coordinate: string | null;
  component_id: string | null;
  component: string | null;
  color_name: string | null;
  print: string | null;
};

export type SrcStructure = {
  sno: number;
  structure_id: string | null;
  structure: string | null;
  gsm: number | null;
  gsm_tolerance: number | null;
  components: SrcComponent[];
};

export type SrcCombo = {
  sno: number;
  style_ref_no: string | null;
  combo: string | null;
  combo_description: string | null;
  structures: SrcStructure[];
};

export type SrcAssortLine = {
  sno: number;
  style_ref_no: string | null;
  combo: string | null;
  no_of_cartons: number | null;
  inners_per_carton: number | null;
  sizes: { size_id: string | null; qty: number | null }[];
};

export type SrcQuantity = {
  sno: number;
  style_ref_no: string | null;
  is_single_style_pack: boolean;
  assortment_type: { code: string | null; name: string | null } | null;
  po_no: string | null;
  po_qty: number;
  delivery_date: string | null;
  earlier_shipment_date: string | null;
  /** Resolved destination label — the country, falling back to the consignee. */
  destination: string | null;
  assort_lines: SrcAssortLine[];
};

export type GosSource = {
  amendment: {
    code: string | null;
    is_draft: boolean;
    po_no: string | null;
    po_date: string | null;
    season: string | null;
    delivery_date: string | null;
    customer: string | null;
    country: string | null;
    merchandiser: string | null;
  };
  order: {
    order_number: string | null;
    order_date: string | null;
  };
  styles: SrcStyle[];
  style_sizes: SrcStyleSize[];
  combos: SrcCombo[];
  quantities: SrcQuantity[];
  /** `config_lookups` kind 'size', id -> name. */
  sizeNames: Readonly<Record<string, string>>;
  printedAt: string;
};

// ---------------------------------------------------------------------------
// The size matrix
// ---------------------------------------------------------------------------

/** One resolved size cell: which style, which colourway, which size, how many. */
export type Cell = { styleRef: string | null; combo: string; sizeId: string; qty: number };

const bySno = <T extends { sno: number }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.sno - b.sno);

/**
 * Every size cell of the order, in PIECES, attributed to a declared style.
 *
 * `styleRef` is null when the cell belongs to no declared style — see the
 * module header. It is not dropped here, because deciding what to do with an
 * unplaceable quantity is the sheet's decision and not this function's.
 *
 * The mode multiplier is `assortMode`'s, not a copy of it: on a Solid / Solid
 * pack the cell IS the pieces and the carton count sits at 0, so multiplying
 * unconditionally is a multiplication by zero — the bug that made the Material
 * BOM refuse a correctly entered order on 2026-08-20.
 */
export function sizeCells(src: GosSource): Cell[] {
  const declared = new Set(declaredStyleRefs(src.styles));
  const out: Cell[] = [];

  for (const q of bySno(src.quantities)) {
    const mode = assortMode({
      style_ref_no: q.style_ref_no,
      assortment_type: q.assortment_type,
    });
    for (const l of bySno(q.assort_lines)) {
      const cartons = Number(l.no_of_cartons) || 0;
      const inners = Number(l.inners_per_carton) || 0;
      const factor = mode === "solid" ? 1 : cartons * inners;

      const raw = assortLineRef(
        src.styles,
        { style_ref_no: q.style_ref_no ?? "" },
        { style_ref_no: l.style_ref_no },
      );
      const key = styleKey(raw);
      const styleRef = key && declared.has(key) ? key : null;

      for (const z of l.sizes) {
        if (!z.size_id) continue;
        out.push({
          styleRef,
          combo: (l.combo ?? "").trim().toUpperCase(),
          sizeId: z.size_id,
          qty: factor * (Number(z.qty) || 0),
        });
      }
    }
  }
  return out;
}

/**
 * The size columns of one style: its declared sizes, then any size its
 * break-up uses that it never declared.
 *
 * DECLARED ORDER IS PRESERVED (0407). Sorting by the size master instead would
 * be stable across styles and would silently re-order a grid the floor reads
 * left to right, so the appended strays go on the end rather than being slotted
 * in where a sort would put them — appearing last is itself the signal that they
 * were not declared.
 *
 * The union is not tidiness. A size that exists in the break-up and not in the
 * style list would otherwise have its pieces counted in no column at all, and
 * the row totals would silently disagree with the PO quantity.
 */
export function sizeColumns(
  src: GosSource,
  styleRef: string,
  cells: readonly Cell[],
): GosSizeColumn[] {
  const seen = new Set<string>();
  const cols: GosSizeColumn[] = [];
  const push = (sizeId: string) => {
    if (seen.has(sizeId)) return;
    seen.add(sizeId);
    cols.push({ sizeId, label: src.sizeNames[sizeId] ?? sizeId });
  };

  for (const z of bySno(src.style_sizes.filter((s) => styleKey(s.style_ref_no) === styleRef))) {
    if (z.size_id) push(z.size_id);
  }
  for (const c of cells) if (c.styleRef === styleRef) push(c.sizeId);
  return cols;
}

/**
 * The matrix for one style — colourways down, sizes across.
 *
 * A CELL IS `null` UNTIL THE BREAK-UP MENTIONS IT. `null` prints blank and a
 * number prints, including 0: an explicit 0 is the packer saying "this carton
 * has no XL" (`AmendmentAssortLineSize`), and rendering it the same as a
 * question nobody asked would turn an unanswered size into an instruction to
 * make none of it.
 *
 * Colourways come from the Combos tab, in its order, because that is the order
 * every other screen shows them in. A colourway that appears only in the
 * break-up is appended and MARKED — printing it unmarked would suggest the
 * order declared a colourway it never did, and dropping it would hide pieces.
 */
export function styleMatrix(
  src: GosSource,
  styleRef: string,
  cells: readonly Cell[],
): GosMatrix | Refusal {
  const mine = cells.filter((c) => c.styleRef === styleRef);
  const columns = sizeColumns(src, styleRef, mine);

  const declaredCombos = bySno(
    src.combos.filter((c) => styleKey(c.style_ref_no) === styleRef),
  )
    .map((c) => (c.combo ?? "").trim().toUpperCase())
    .filter(Boolean);

  const order: string[] = [];
  const declaredSet = new Set(declaredCombos);
  for (const c of declaredCombos) if (!order.includes(c)) order.push(c);
  for (const c of mine) if (c.combo && !order.includes(c.combo)) order.push(c.combo);

  if (columns.length === 0 || order.length === 0) {
    return {
      refused:
        "No size break-up has been entered for this style — the Quantities tab has no assortment for it.",
    };
  }

  // (combo, sizeId) -> pieces. Absent means the break-up never mentioned it —
  // the distinction the whole matrix rests on, so the key is JSON.stringify
  // rather than a joined string: a colourway name may contain any character,
  // and a separator collision would merge two sizes into one cell.
  const totals = new Map<string, number>();
  for (const c of mine) {
    const k = JSON.stringify([c.combo, c.sizeId]);
    totals.set(k, (totals.get(k) ?? 0) + c.qty);
  }

  const columnTotals = columns.map(() => 0);
  const rows: GosMatrixRow[] = order.map((combo) => {
    let rowTotal = 0;
    const cellValues = columns.map((col, i) => {
      const v = totals.get(JSON.stringify([combo, col.sizeId]));
      if (v === undefined) return null;
      rowTotal += v;
      columnTotals[i] += v;
      return v;
    });
    return {
      combo,
      cells: cellValues,
      total: rowTotal,
      undeclared: !declaredSet.has(combo),
    };
  });

  return {
    columns,
    rows,
    columnTotals,
    total: columnTotals.reduce((s, n) => s + n, 0),
  };
}

// ---------------------------------------------------------------------------
// The component list
// ---------------------------------------------------------------------------

/**
 * A panel's identity ACROSS colourways.
 *
 * The same physical panel in NAVY and in YELLOW must land on one row, so the
 * key is everything about the panel EXCEPT its colour: which garment of the set
 * it belongs to, which part it is, and the fabric it is cut from — structure and
 * GSM included, because a colourway knitted at a different GSM is a different
 * fabric and the floor must see two rows rather than one row with a colour in
 * it.
 *
 * `occurrence` is what keeps a colour-blocked garment honest. A colourway that
 * lists SLEEVE twice in one structure has two sleeve panels; without the
 * counter the second would collide with the first and one of them would be
 * silently discarded. With it, the Nth sleeve of NAVY aligns with the Nth
 * sleeve of YELLOW, which is the only alignment that can be right.
 */
function panelKey(
  st: SrcStructure,
  c: SrcComponent,
  occurrence: number,
): string {
  // JSON.stringify, not a joined string: any separator character is a
  // character an id could in principle contain, and a key collision here
  // silently merges two different panels into one printed row.
  return JSON.stringify([
    c.coordinate_id ?? "",
    c.component_id ?? "",
    st.structure_id ?? "",
    st.gsm ?? "",
    st.gsm_tolerance ?? "",
    occurrence,
  ]);
}

/**
 * The panels of one style, grouped by coordinate.
 *
 * GROUPED, because that is what makes a Set readable on paper. A Set is two to
 * six garments sold together (`COORDINATE_LIMITS`), and a flat list of panels
 * does not say which garment a SLEEVE belongs to. A Piece has exactly one
 * coordinate and the grouping costs it one heading.
 *
 * ORDER IS FIRST APPEARANCE, walking colourway 1's structures in their declared
 * order — so the sheet reads in the order the merchandiser built the garment,
 * not in an alphabetical order nobody entered.
 */
export function stylePanels(
  src: GosSource,
  styleRef: string,
  colourways: readonly string[],
): GosCoordinateBlock[] {
  const index = new Map<string, number>(colourways.map((c, i) => [c, i]));
  const panels = new Map<string, GosPanel>();
  const order: string[] = [];

  for (const combo of bySno(src.combos.filter((c) => styleKey(c.style_ref_no) === styleRef))) {
    const name = (combo.combo ?? "").trim().toUpperCase();
    const col = index.get(name);
    if (col === undefined) continue;

    // Per COLOURWAY, so the occurrence counter restarts for each — the Nth
    // sleeve of NAVY is the Nth sleeve of YELLOW, not the (N + however many
    // NAVY had)th.
    const seen = new Map<string, number>();

    for (const st of bySno(combo.structures)) {
      for (const c of bySno(st.components)) {
        const base = panelKey(st, c, 0);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = panelKey(st, c, n);

        let panel = panels.get(key);
        if (!panel) {
          panel = {
            coordinate: c.coordinate,
            component: c.component,
            structure: st.structure,
            gsm: st.gsm,
            gsmTolerance: st.gsm_tolerance,
            colours: colourways.map(() => null),
          };
          panels.set(key, panel);
          order.push(key);
        }
        panel.colours[col] = { colour: c.color_name, print: c.print };
      }
    }
  }

  const blocks: GosCoordinateBlock[] = [];
  for (const key of order) {
    const panel = panels.get(key);
    if (!panel) continue;
    const label = panel.coordinate ?? "—";
    let block = blocks.find((b) => b.coordinate === label);
    if (!block) {
      block = { coordinate: label, panels: [] };
      blocks.push(block);
    }
    block.panels.push(panel);
  }
  return blocks;
}

/**
 * PIECE VS SET, checked against what the order actually declares.
 *
 * Returns a sentence, or null when there is nothing to say. NOT a refusal: the
 * sheet prints either way, because the floor needs today's directive and fixing
 * a coordinate count is a merchandising job. But it is not silent either — a
 * Piece cut as two garments is a costing error, and a Set declared with one
 * coordinate means half the garment has no panels listed.
 *
 * A style with no `unit_kind` says nothing at all. Every style created before
 * 0392 has none, and declaring those invalid on a printed sheet would put a
 * warning on historical records nobody can act on (`coordinateLimit` records
 * the same reasoning for the screen).
 */
export function coordinateWarning(
  unitKind: string | null,
  count: number,
): string | null {
  const limit = coordinateLimit(unitKind);
  if (!limit) return null;
  if (count === 0) {
    return "No coordinates are declared on this order — the component list below is empty.";
  }
  if (count < limit.min) {
    return `Declared as ${unitKindLabel(unitKind)}, which needs at least ${limit.min} coordinates; this order names ${count}.`;
  }
  if (count > limit.max) {
    return `Declared as ${unitKindLabel(unitKind)}, which allows at most ${limit.max} coordinate${limit.max === 1 ? "" : "s"}; this order names ${count}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/**
 * Pieces that belong to no declared style, summed per (ref, colourway).
 *
 * Kept as a list rather than a count so the printed line can NAME what did not
 * land — "STL/26-27/0004 · WHITE · 250 pcs" is something a merchandiser can act
 * on, "250 pieces are unattributed" is not.
 */
function orphansOf(cells: readonly Cell[], src: GosSource): GosOrphan[] {
  const byKey = new Map<string, GosOrphan>();
  for (const c of cells) {
    if (c.styleRef !== null || c.qty === 0) continue;
    const k = `${c.combo}`;
    const row = byKey.get(k);
    if (row) row.qty += c.qty;
    else byKey.set(k, { ref: refOfCombo(src, c.combo), combo: c.combo, qty: c.qty });
  }
  return [...byKey.values()];
}

/** The style reference an orphan cell CLAIMED, for the printed line. */
function refOfCombo(src: GosSource, combo: string): string {
  for (const q of src.quantities) {
    for (const l of q.assort_lines) {
      if ((l.combo ?? "").trim().toUpperCase() === combo) {
        return (l.style_ref_no ?? q.style_ref_no ?? "").trim() || "—";
      }
    }
  }
  return "—";
}

/**
 * Destination rows — one per Quantities line.
 *
 * `qty` is the destination's OWN pieces, summed from its assortment through the
 * same mode multiplier the matrix uses, rather than read off `po_qty`. The two
 * are meant to agree (the order screen refuses to save while they do not,
 * `assortBalanceOf`), and printing the computed one is what makes a
 * disagreement visible on the sheet instead of hidden behind a stored total.
 */
function destinationsOf(src: GosSource): GosDestination[] {
  return bySno(src.quantities).map((q) => {
    const mode = assortMode({
      style_ref_no: q.style_ref_no,
      assortment_type: q.assortment_type,
    });
    let qty = 0;
    for (const l of q.assort_lines) {
      const factor =
        mode === "solid" ? 1 : (Number(l.no_of_cartons) || 0) * (Number(l.inners_per_carton) || 0);
      for (const z of l.sizes) qty += factor * (Number(z.qty) || 0);
    }
    return {
      label: q.destination ?? q.style_ref_no ?? "—",
      poNo: q.po_no,
      deliveryDate: q.delivery_date,
      earlierShipmentDate: q.earlier_shipment_date,
      qty,
    };
  });
}

/** Build the whole sheet. Pure — the service does every lookup first. */
export function buildGosSheet(src: GosSource): GosSheet {
  const cells = sizeCells(src);

  const styles: GosStyle[] = bySno(src.styles).map((s) => {
    const ref = styleKey(s.style_ref_no);

    const colourways = bySno(src.combos.filter((c) => styleKey(c.style_ref_no) === ref))
      .map((c) => (c.combo ?? "").trim().toUpperCase())
      .filter((c, idx, all) => c && all.indexOf(c) === idx);

    const coordinates = stylePanels(src, ref, colourways);
    const coordinateIds = new Set<string>();
    for (const combo of src.combos) {
      if (styleKey(combo.style_ref_no) !== ref) continue;
      for (const st of combo.structures) {
        for (const c of st.components) if (c.coordinate_id) coordinateIds.add(c.coordinate_id);
      }
    }

    return {
      styleRef: s.style_ref_no ?? "",
      styleCode: s.style_code,
      styleName: s.style_name,
      articleNo: s.article_no,
      // The order line's own description wins: it is what this PO says the
      // garment is, and it can legitimately differ from the master style's.
      description: s.style_description ?? s.description,
      unitKind: s.unit_kind,
      unitKindLabel: unitKindLabel(s.unit_kind),
      coordinateCount: coordinateIds.size,
      coordinateWarning: coordinateWarning(s.unit_kind, coordinateIds.size),
      approvedSampleNo: s.approved_sample_no,
      poQty: Number(s.po_qty) || 0,
      colourways,
      matrix: styleMatrix(src, ref, cells),
      coordinates,
    };
  });

  let grandTotal = 0;
  for (const s of styles) if (!("refused" in s.matrix)) grandTotal += s.matrix.total;

  return {
    header: {
      // BOTH NUMBERS ARE READ, NEVER COMPOSED — see `GosHeader`. `sNo` is the
      // amendment's own serial and `reNumber` is the order's, carried through
      // character for character so the legacy `U2/RE//2526/2047` shape (86 of
      // the 91 live orders) reaches the page with its double slash intact.
      sNo: src.amendment.code,
      reNumber: src.order.order_number,
      customerName: src.amendment.customer,
      countryName: src.amendment.country,
      // ONE STYLE OR NOTHING — see the note on the field. With several styles
      // the header cannot answer, and each style block states its own.
      approvedSampleNo: styles.length === 1 ? styles[0].approvedSampleNo : null,
      poNo: src.amendment.po_no,
      poDate: src.amendment.po_date,
      orderDate: src.order.order_date,
      season: src.amendment.season,
      deliveryDate: src.amendment.delivery_date,
      merchandiser: src.amendment.merchandiser,
      isDraft: src.amendment.is_draft,
    },
    destinations: destinationsOf(src),
    styles,
    grandTotal,
    orphans: orphansOf(cells, src),
    printedAt: src.printedAt,
  };
}
