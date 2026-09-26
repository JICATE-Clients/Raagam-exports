/**
 * The Accessories Requirement Sheet — turning stored requirement rows into the
 * document the floor and the supplier read.
 *
 * The legacy sheet (Format.pdf, printed 22-08-2026) is the contract: item
 * category as a grouping band, the item and its spec, Type / UOM / Size / Qty,
 * and a Consumption column reading `1 NOS / 1 PCS`. A size-split item becomes
 * one row per size followed by a Total. This module produces exactly that,
 * as a flat list the table renders straight down.
 *
 * ## IT NEVER RECOMPUTES. IT READS WHAT WAS STORED.
 *
 * Nothing here calls `requirementFor()`. `material_bom_amendment_requirements`
 * already holds `required_qty` for every slice, written by the server action
 * from the same functions the screen showed the operator. A document is a record
 * of what was APPROVED and signed; recomputing at print time means the paper and
 * the purchase order can disagree the moment the order moves. Staleness is
 * already reported where it belongs — the BOM screen flags `Recalculate` off
 * `basisFingerprint` — and this sheet prints the stored figure and the date it
 * was stored.
 *
 * ## THE TOTAL IS A SUM OF STORED ROWS, NEVER A RE-DERIVATION
 *
 * This is the rule most likely to be "fixed" into a bug. On the legacy sheet the
 * size rows of one label read 136 + 191 + 233 + 186 + 136 = **882**, while the
 * same item un-split reads **881**. That gap is not an error: `apportion()`
 * hands each size a floored share and the leftover piece to the largest
 * remainder, so a split total can exceed the un-split figure by up to one unit
 * per size. Re-deriving the total here — or "correcting" it to 881 — would make
 * the sheet disagree with the requirement the purchase order is written from.
 *
 * ## PURE, SO IT CAN BE PROVED
 *
 * No `server-only`, no Supabase, no dates of its own. Names arrive as plain
 * `Record` maps rather than resolver functions for the reason
 * `OrderProductionInput.sizeNames` records: this data crosses a server action
 * boundary and a function cannot.
 */

import { fmtQty } from "@/lib/uom/convert";

/** One stored requirement row, as much of it as the sheet needs. */
export type StoredRequirement = {
  item_id: string | null;
  /** The Material BOM line the row was exploded from — its supply type is the
   *  printout's Specification. Optional: absent on a sheet frozen before it. */
  item_line_id?: string | null;
  sno: number;
  slice_label: string | null;
  size_id: string | null;
  item_color_id: string | null;
  no_of_items: number | null;
  per_pieces: number | null;
  required_qty: number | null;
  refusal_reason: string | null;
  consumption_uom_id: string | null;
};

/** What the ids resolve to. Maps, never functions — see the header. */
export type SheetNames = {
  items: Record<string, { name: string; category: string | null }>;
  uoms: Record<string, { code: string; decimals: number | null }>;
  sizes: Record<string, string>;
  colours: Record<string, string>;
  /** Material BOM line id → what the printout's Specification column reads. */
  lines?: Record<string, { supplyType: string | null; specification: string | null }>;
};

export type SheetRow =
  | { kind: "category"; key: string; label: string }
  | {
      kind: "item";
      key: string;
      /** The item's name with its category prefix removed. */
      head: string;
      /** What is left of the slashed name after the head. */
      spec: string | null;
      colour: string | null;
      uom: string;
      size: string | null;
      qty: number | null;
      refusal: string | null;
      consumption: string;
      decimals: number | null;
      /** True when size rows follow and this row carries no figure of its own. */
      split: boolean;
    }
  | {
      kind: "size";
      key: string;
      size: string;
      qty: number | null;
      refusal: string | null;
      consumption: string;
      decimals: number | null;
    }
  | { kind: "total"; key: string; label: string; qty: number; decimals: number | null };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Split `LABEL / MAIN & SIZE / PRINTED / SATIN` into its head and its spec,
 * with the category prefix dropped.
 *
 * The item master stores the category as the first segment of the name, so
 * printing the name whole under a band that already says LABEL repeats the word
 * on every row — which is what the legacy sheet's widest column was mostly full
 * of. The head is then the first REMAINING segment and the spec is the rest,
 * because that is the pair a buyer reads: what it is, then how it is made.
 *
 * A name that does NOT start with its category is left alone. Data is not
 * guaranteed to follow the convention, and silently eating a first segment that
 * happened to look similar would rename the item on the page.
 */
export function itemLabel(
  name: string,
  category: string | null,
): { head: string; spec: string | null } {
  const parts = name
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { head: name.trim() || "(unnamed item)", spec: null };

  const cat = (category ?? "").trim().toUpperCase();
  if (cat && parts[0].toUpperCase() === cat) parts.shift();
  if (parts.length === 0) return { head: name.trim(), spec: null };

  const head = parts.shift() as string;
  return { head, spec: parts.length ? parts.join(" / ") : null };
}

/**
 * The Consumption column: `1 NOS / 1 PCS`, `1 CONE / 10 PCS`.
 *
 * Read as "one cone covers ten pieces" — the ratio the requirement was computed
 * from, printed so a supplier can check the figure rather than trust it. The
 * right-hand unit is always PCS because `per_pieces` counts garments; only the
 * left-hand unit varies.
 *
 * AN INCOMPLETE RATIO PRINTS A DASH, not `1 / 0` and not a silent blank. The
 * engine refuses such a line and its refusal is already on the row; the
 * consumption cell must not imply a ratio the requirement does not have.
 */
export function consumptionLabel(
  noOfItems: number | null,
  perPieces: number | null,
  uomCode: string | null,
): string {
  const items = num(noOfItems);
  const pieces = num(perPieces);
  if (items == null || pieces == null || pieces <= 0) return "—";
  const unit = (uomCode ?? "").trim() || "NOS";
  const n = (v: number) => (Number.isInteger(v) ? String(v) : String(v));
  return `${n(items)} ${unit} / ${n(pieces)} PCS`;
}

/**
 * Stored rows → the document's rows, grouped and totalled.
 *
 * ## ORDER IS THE STORED ORDER, WITHIN A SORTED GROUPING
 *
 * Categories come out alphabetically, which is how the legacy sheet reads and
 * how a storeman walks a rack. WITHIN a category the items keep their `sno` —
 * the order the operator built the BOM in — because that is a decision they
 * made and re-sorting it would lose it.
 *
 * ## AN ITEM IS "SPLIT" WHEN ITS ROWS CARRY SIZES
 *
 * Not when there is more than one row: a colour-wise or country-wise BOM also
 * produces several rows per item, and those are not sizes. The test is
 * `size_id`, and a split item's parent row carries no figure of its own —
 * printing one would invite the reader to add it to the total below.
 */
export function requirementRows(
  stored: readonly StoredRequirement[],
  names: SheetNames,
): SheetRow[] {
  type Bucket = { sno: number; itemId: string; rows: StoredRequirement[] };
  const byCategory = new Map<string, Map<string, Bucket>>();

  for (const r of stored) {
    const id = r.item_id ?? "";
    const item = names.items[id];
    // AN UNRESOLVED ITEM IS STILL PRINTED. A requirement row whose master row is
    // gone is a real quantity somebody must buy; dropping it would shorten the
    // sheet silently, which is the partial-explosion failure the engine refuses
    // one level up.
    const category = (item?.category ?? "").trim() || "UNCATEGORISED";
    let items = byCategory.get(category);
    if (!items) byCategory.set(category, (items = new Map()));
    const at = items.get(id);
    if (at) at.rows.push(r);
    else items.set(id, { sno: r.sno, itemId: id, rows: [r] });
  }

  const out: SheetRow[] = [];
  for (const category of [...byCategory.keys()].sort()) {
    out.push({ kind: "category", key: `c:${category}`, label: category });

    const items = [...(byCategory.get(category) as Map<string, Bucket>).values()].sort(
      (a, b) => a.sno - b.sno,
    );

    for (const bucket of items) {
      const master = names.items[bucket.itemId];
      const { head, spec } = itemLabel(master?.name ?? "(unknown item)", master?.category ?? null);
      const first = bucket.rows[0];
      const uom = names.uoms[first.consumption_uom_id ?? ""];
      const uomCode = uom?.code ?? "";
      const decimals = uom?.decimals ?? null;
      const colour = first.item_color_id ? (names.colours[first.item_color_id] ?? null) : null;
      const sized = bucket.rows.filter((r) => r.size_id);
      const split = sized.length > 0;

      out.push({
        kind: "item",
        key: `i:${bucket.itemId}`,
        head,
        spec,
        colour,
        uom: uomCode,
        size: null,
        qty: split ? null : num(first.required_qty),
        refusal: split ? null : (first.refusal_reason ?? null),
        consumption: consumptionLabel(first.no_of_items, first.per_pieces, uomCode),
        decimals,
        split,
      });

      if (!split) continue;

      let total = 0;
      for (const r of sized) {
        const qty = num(r.required_qty);
        if (qty != null) total += qty;
        out.push({
          kind: "size",
          key: `s:${bucket.itemId}:${r.size_id}`,
          size: r.size_id ? (names.sizes[r.size_id] ?? r.slice_label ?? "—") : "—",
          qty,
          refusal: r.refusal_reason ?? null,
          consumption: consumptionLabel(r.no_of_items, r.per_pieces, uomCode),
          decimals,
        });
      }
      out.push({
        kind: "total",
        key: `t:${bucket.itemId}`,
        label: `${head} — total`,
        // SUMMED FROM THE STORED ROWS, never re-derived. See the header: the
        // split total legitimately exceeds the un-split figure by up to one unit
        // per size, and "correcting" that would disagree with the purchase order.
        qty: Number(total.toFixed(6)),
        decimals,
      });
    }
  }
  return out;
}

/** What the sheet prints in a quantity cell, at the unit's own precision. */
export function sheetQty(qty: number | null, decimals: number | null): string {
  return qty == null ? "—" : fmtQty(qty, decimals);
}

/**
 * The counts the section band shows: how many items, and how many of them split.
 *
 * Derived here rather than in the component so the band cannot drift from the
 * table beneath it — the same reason `templateSummary` exists next door.
 */
export function requirementSummary(rows: readonly SheetRow[]): {
  categories: number;
  items: number;
  split: number;
} {
  let categories = 0;
  let items = 0;
  let split = 0;
  for (const r of rows) {
    if (r.kind === "category") categories++;
    if (r.kind === "item") {
      items++;
      if (r.split) split++;
    }
  }
  return { categories, items, split };
}

// ---------------------------------------------------------------------------
// The RP printout's grid (client 2026-09-24, "Accessories Requirement.pdf")
// ---------------------------------------------------------------------------

/**
 * ONE ROW OF THE TRIMS PURCHASE GRID, in the RP printout's columns:
 * Category · Item · Color · Specification · UOM · Item Size · Qty · Consumption.
 *
 * `category` is set on the FIRST row of its group only, with `span` counting
 * the rows it covers — the printout names LABEL once over its two labels and
 * leaves the cell below it empty, and both renderers draw that as one merged
 * cell (a `rowSpan` on screen, an autoTable `rowSpan` in the PDF).
 */
/** The printout's eight columns, in its order — read by the page, the PDF and the CSV. */
export const ACCESSORY_COLUMNS = [
  "Category",
  "Item",
  "Color",
  "Specification",
  "UOM",
  "Item Size",
  "Qty",
  "Consumption",
] as const;

export type AccessoryRow = {
  key: string;
  category: string | null;
  span: number;
  /** The item's FULL name, as the printout prints it — "LABEL / MAIN & SIZE /
   *  PRINTED / SATIN / CUT & SEAL", category word included. */
  item: string;
  colour: string | null;
  /** "Type:Local", then the line's own specification text when it has one. */
  spec: string | null;
  uom: string;
  size: string | null;
  qty: number | null;
  refusal: string | null;
  consumption: string;
  decimals: number | null;
};

/**
 * The stored requirement as the printout's grid.
 *
 * ONE ROW PER (item, colour, size). The older `requirementRows` grouped by
 * item alone and printed the FIRST row's colour and quantity — so a
 * colour-wise trim (a label bought in two colours) printed one colour's
 * quantity and dropped the other's. Here each colour is its own row, and two
 * lines asking for the same item in the same colour and size (one per style)
 * are summed, as a supplier buys them.
 *
 * A REFUSED SLICE REFUSES THE ROW. A sum of the slices that could be worked
 * out is not the quantity to buy; the row carries the refusal sentence instead.
 *
 * ORDER IS THE BOM'S OWN, not the alphabet: categories in the order their
 * first line was entered (sewing trims before packing, as the merchandiser
 * built it and as the printout lists them), items by `sno` within each.
 */
export function accessoryRows(stored: readonly StoredRequirement[], names: SheetNames): AccessoryRow[] {
  type Group = { sno: number; rows: StoredRequirement[] };
  const byCategory = new Map<string, { sno: number; groups: Map<string, Group> }>();

  for (const r of stored) {
    const itemId = r.item_id ?? "";
    const category = (names.items[itemId]?.category ?? "").trim() || "UNCATEGORISED";
    let cat = byCategory.get(category);
    if (!cat) byCategory.set(category, (cat = { sno: r.sno, groups: new Map() }));
    cat.sno = Math.min(cat.sno, r.sno);
    const key = `${itemId}|${r.item_color_id ?? ""}|${r.size_id ?? ""}`;
    const g = cat.groups.get(key);
    if (g) {
      g.rows.push(r);
      g.sno = Math.min(g.sno, r.sno);
    } else {
      cat.groups.set(key, { sno: r.sno, rows: [r] });
    }
  }

  const title = (v: string) => v.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const out: AccessoryRow[] = [];
  const categories = [...byCategory.entries()].sort((a, b) => a[1].sno - b[1].sno);
  for (const [category, cat] of categories) {
    const groups = [...cat.groups.entries()].sort((a, b) => a[1].sno - b[1].sno);
    groups.forEach(([key, g], i) => {
      const first = g.rows[0];
      const uom = names.uoms[first.consumption_uom_id ?? ""];
      const uomCode = uom?.code ?? "";
      const refused = g.rows.find((r) => num(r.required_qty) == null);
      const qty = refused ? null : Number(g.rows.reduce((s, r) => s + (num(r.required_qty) ?? 0), 0).toFixed(6));
      const line = first.item_line_id ? names.lines?.[first.item_line_id] : undefined;
      const spec = [line?.supplyType ? `Type:${title(line.supplyType)}` : null, line?.specification?.trim() || null]
        .filter(Boolean)
        .join(" ");
      out.push({
        key: `a:${category}:${key}`,
        category: i === 0 ? category : null,
        span: i === 0 ? groups.length : 0,
        item: names.items[first.item_id ?? ""]?.name ?? "(unknown item)",
        colour: first.item_color_id ? (names.colours[first.item_color_id] ?? null) : null,
        spec: spec || null,
        uom: uomCode,
        size: first.size_id ? (names.sizes[first.size_id] ?? first.slice_label ?? null) : null,
        qty,
        refusal: refused ? (refused.refusal_reason ?? "Could not be worked out") : null,
        consumption: consumptionLabel(first.no_of_items, first.per_pieces, uomCode),
        decimals: uom?.decimals ?? null,
      });
    });
  }
  return out;
}

/** The printout's quantity: three decimals always ("3141.000", "22.000"), in
 *  the app's Indian grouping. A refused row prints its sentence instead. */
export function accessoryQty(qty: number | null): string {
  return qty == null ? "—" : qty.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
