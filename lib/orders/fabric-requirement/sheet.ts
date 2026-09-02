/**
 * The Fabric Requirement Sheet — turning stored fabric BOM rows into the
 * document knitting, dyeing and purchasing read.
 *
 * The companion to `lib/orders/requirement/sheet.ts`, and deliberately its
 * SIBLING rather than a generalisation of it. The two documents answer the same
 * question about different goods and the shapes do not coincide:
 *
 * - A trim groups by ITEM CATEGORY and splits by SIZE. Its consumption is a
 *   ratio — `1 CONE / 10 PCS`.
 * - Fabric groups by STYLE and then by the manual ENTRY that planned it, and
 *   splits by COLOURWAY × SIZE, because cloth is dyed per colourway. Its
 *   consumption is one weight per garment, and a wastage percentage rides beside
 *   it.
 *
 * Folding both into one parameterised module would have produced a function with
 * a category axis that fabric never uses and a wastage column trims never carry
 * — which is the shape that then grows a boolean per document. `sheet.ts` next
 * door says the same thing about its own totals.
 *
 * ## IT NEVER RECOMPUTES. IT READS WHAT WAS STORED.
 *
 * Nothing here calls `fabricRequirementRows()`. `order_fabric_bom_requirements`
 * already holds `required_qty` for every slice, written by the server action
 * from the same functions the operator approved on screen. Recomputing at print
 * time means the paper and the purchase order can disagree the moment the order
 * moves. This is not a preference — `actions.ts` records the failure by name:
 * when the screen's preview and the stored figures were derived separately they
 * differed, and "the figure on screen and the figure stored were different" is
 * the one thing the yarn module's header says must never happen.
 *
 * ## THE ENTRY IS THE COUNTING UNIT, NOT THE FABRIC ITEM
 *
 * Since 0494 a requirement row carries `entry_id` and `line_id` is NULL on every
 * one. Two entries may name the SAME cloth — a body panel and a sleeve cut from
 * one jersey — and they are planned separately because their components, sizes
 * and wastage differ. Summing them to one row per fabric would let a computed
 * entry paper over a REFUSED one, printing a confident figure that covers only
 * part of the cloth. That is the exact failure `fabricGrossOf` records for the
 * yarn split, one document down.
 *
 * ## PURE, SO IT CAN BE PROVED
 *
 * No `server-only`, no Supabase, no dates of its own. Names arrive as plain
 * `Record` maps rather than resolver functions, for the reason the accessories
 * sheet records: this data crosses a server/client boundary and a function
 * cannot.
 */

import { fmtQty } from "@/lib/uom/convert";

/** One stored fabric requirement row, as much of it as the sheet needs. */
export type StoredFabricRequirement = {
  entry_id: string | null;
  item_id: string | null;
  sno: number;
  basis: string | null;
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  slice_label: string | null;
  /** Garments this slice covers — what the consumption was multiplied by. */
  basis_qty: number | null;
  /** Fabric per garment, in the consumption unit. */
  consumption: number | null;
  wastage_pct: number | null;
  required_qty: number | null;
  refusal_reason: string | null;
  consumption_uom_id: string | null;
};

/** One stored yarn purchase row. */
export type StoredYarn = {
  item_id: string | null;
  sno: number;
  purchase_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
};

/** The manual entry a requirement row was planned by. */
export type EntryFacts = {
  sno: number;
  styleRefNo: string | null;
  structure: string | null;
  /** The garment parts this entry's cloth is cut into. */
  components: string[];
  widthForm: string | null;
};

/** What the ids resolve to. Maps, never functions — see the header. */
export type FabricSheetNames = {
  items: Record<string, { name: string; category: string | null }>;
  uoms: Record<string, { code: string; decimals: number | null }>;
  entries: Record<string, EntryFacts>;
};

export type FabricSheetRow =
  | { kind: "style"; key: string; label: string }
  | {
      kind: "entry";
      key: string;
      /** The cloth. `null` when the entry named none — a refusal will say so. */
      fabric: string;
      structure: string | null;
      components: string | null;
      widthForm: string | null;
      uom: string;
    }
  | {
      kind: "slice";
      key: string;
      /** `WHITE · M`, as the engine labelled it. */
      slice: string;
      /** Garments this slice covers. */
      pieces: number | null;
      consumption: number | null;
      wastagePct: number | null;
      qty: number | null;
      refusal: string | null;
      decimals: number | null;
    }
  | { kind: "total"; key: string; label: string; qty: number; uom: string; decimals: number | null }
  | {
      kind: "yarn";
      key: string;
      yarn: string;
      qty: number | null;
      uom: string;
      refusal: string | null;
      decimals: number | null;
    };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A style band's heading. A row scoped to no style covers every one of them. */
export function styleBandLabel(styleRefNo: string | null): string {
  const s = (styleRefNo ?? "").trim();
  return s || "ALL STYLES";
}

/**
 * How an entry's cloth is described on its header line.
 *
 * The structure and the components are what distinguish two entries of the SAME
 * fabric, so an entry that carries neither prints the fabric alone rather than a
 * trail of dashes. An unresolved fabric says so in words: a requirement row whose
 * item master is gone is still a real quantity somebody must knit, and dropping
 * it would shorten the sheet silently.
 */
export function entryHeading(names: FabricSheetNames, entryId: string | null, itemId: string | null) {
  const entry = entryId ? names.entries[entryId] : undefined;
  const item = itemId ? names.items[itemId] : undefined;
  return {
    fabric: item?.name?.trim() || "(fabric not named on this entry)",
    structure: entry?.structure?.trim() || null,
    components: entry?.components.length ? entry.components.join(" · ") : null,
    widthForm: entry?.widthForm?.trim() || null,
  };
}

/**
 * Stored rows → the document's rows, grouped and totalled.
 *
 * ## ORDER IS THE STORED ORDER, WITHIN A SORTED GROUPING
 *
 * Styles come out alphabetically — how a knitter walks a programme — with
 * `ALL STYLES` FIRST rather than wherever the letter A falls, because an
 * unscoped entry covers the styles listed beneath it and reading it after them
 * inverts that. WITHIN a style the entries keep their `sno`: that is the order
 * the planner built the BOM in, and re-sorting it would lose a decision they
 * made.
 *
 * ## A TOTAL IS A SUM OF STORED ROWS, NEVER A RE-DERIVATION
 *
 * The same rule the accessories sheet states, and it bites for a second reason
 * here: `ceilToPrecision` rounds each slice UP to its unit's precision, so the
 * slices legitimately sum to slightly more than the un-split figure. Re-deriving
 * the total — or "correcting" it down — would make the sheet disagree with the
 * requirement the fabric purchase order is written from.
 *
 * ## A REFUSED SLICE CONTRIBUTES NOTHING AND HIDES NOTHING
 *
 * Its `required_qty` is NULL, so it cannot be added; the row still prints, and
 * its sentence goes in the quantity cell. An entry whose slices are ALL refused
 * therefore shows a total of zero — which is why `totalIsPartial` exists below
 * and the document marks it. A clean-looking total over a refusal is the one
 * outcome this sheet must not produce.
 */
export function fabricRequirementSheetRows(
  stored: readonly StoredFabricRequirement[],
  names: FabricSheetNames,
): FabricSheetRow[] {
  type Bucket = { sno: number; entryId: string | null; itemId: string | null; rows: StoredFabricRequirement[] };
  const byStyle = new Map<string, Map<string, Bucket>>();

  for (const r of stored) {
    const style = styleBandLabel(r.style_ref_no);
    let entries = byStyle.get(style);
    if (!entries) byStyle.set(style, (entries = new Map()));
    // KEYED ON THE ENTRY, not the fabric — see the header. A row with no entry
    // id falls back to its item so it is still grouped rather than dropped.
    const key = r.entry_id ?? `item:${r.item_id ?? "?"}`;
    const at = entries.get(key);
    if (at) at.rows.push(r);
    else
      entries.set(key, {
        sno: names.entries[r.entry_id ?? ""]?.sno ?? r.sno,
        entryId: r.entry_id,
        itemId: r.item_id,
        rows: [r],
      });
  }

  const out: FabricSheetRow[] = [];
  const styles = [...byStyle.keys()].sort((a, b) => {
    if (a === "ALL STYLES") return -1;
    if (b === "ALL STYLES") return 1;
    return a.localeCompare(b);
  });

  for (const style of styles) {
    out.push({ kind: "style", key: `y:${style}`, label: style });

    const entries = [...(byStyle.get(style) as Map<string, Bucket>).values()].sort(
      (a, b) => a.sno - b.sno,
    );

    for (const bucket of entries) {
      const head = entryHeading(names, bucket.entryId, bucket.itemId);
      const first = bucket.rows[0];
      const uom = names.uoms[first.consumption_uom_id ?? ""];
      const uomCode = uom?.code ?? "";
      const decimals = uom?.decimals ?? null;
      const gkey = `${style}:${bucket.entryId ?? bucket.itemId ?? "?"}`;

      out.push({
        kind: "entry",
        key: `e:${gkey}`,
        fabric: head.fabric,
        structure: head.structure,
        components: head.components,
        widthForm: head.widthForm,
        uom: uomCode,
      });

      let total = 0;
      for (const r of bucket.rows) {
        const qty = num(r.required_qty);
        if (qty != null) total += qty;
        out.push({
          kind: "slice",
          key: `s:${gkey}:${r.sno}`,
          slice: (r.slice_label ?? "").trim() || "—",
          pieces: num(r.basis_qty),
          consumption: num(r.consumption),
          wastagePct: num(r.wastage_pct),
          qty,
          refusal: r.refusal_reason ?? null,
          decimals,
        });
      }

      out.push({
        kind: "total",
        key: `t:${gkey}`,
        label: `${head.fabric} — total`,
        // SUMMED FROM THE STORED ROWS, never re-derived. See the header.
        qty: Number(total.toFixed(6)),
        uom: uomCode,
        decimals,
      });
    }
  }
  return out;
}

/** The yarn purchase section's rows, in stored order. */
export function yarnSheetRows(
  stored: readonly StoredYarn[],
  names: FabricSheetNames,
): FabricSheetRow[] {
  return [...stored]
    .sort((a, b) => a.sno - b.sno)
    .map((y) => {
      const uom = names.uoms[y.uom_id ?? ""];
      return {
        kind: "yarn" as const,
        key: `yn:${y.sno}`,
        yarn: names.items[y.item_id ?? ""]?.name?.trim() || "(yarn not named)",
        qty: num(y.purchase_qty),
        uom: uom?.code ?? "",
        refusal: y.refusal_reason ?? null,
        decimals: uom?.decimals ?? null,
      };
    });
}

/**
 * Does a total sit over refused slices?
 *
 * The document marks such a total rather than printing it plainly. A figure that
 * looks complete while part of its cloth could not be worked out is worse than
 * no figure at all — it is the "0 is not an answer" rule applied to a subtotal,
 * and a fabric purchase order is written from this page.
 */
export function totalIsPartial(rows: readonly FabricSheetRow[], totalKey: string): boolean {
  const at = rows.findIndex((r) => r.key === totalKey);
  if (at < 0) return false;
  for (let i = at - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.kind !== "slice") break;
    if (r.qty == null) return true;
  }
  return false;
}

/** What the sheet prints in a quantity cell, at the unit's own precision. */
export function fabricSheetQty(qty: number | null, decimals: number | null): string {
  return qty == null ? "—" : fmtQty(qty, decimals);
}

/**
 * The consumption cell: `0.180 KGS + 5%`.
 *
 * Read as "180 grams per garment, plus a five percent cutting buffer" — the
 * derivation the requirement was computed from, printed so a knitter can check
 * the figure rather than trust it.
 *
 * AN INCOMPLETE DERIVATION PRINTS A DASH, never `0` and never a silent blank.
 * The engine refuses such a slice and its refusal is already on the row; this
 * cell must not imply a consumption the requirement does not have. Zero wastage
 * is a real answer and prints without the suffix — the buffer is optional, the
 * consumption is not.
 */
export function fabricConsumptionLabel(
  consumption: number | null,
  wastagePct: number | null,
  uomCode: string | null,
  decimals: number | null,
): string {
  const c = num(consumption);
  if (c == null || c <= 0) return "—";
  const unit = (uomCode ?? "").trim();
  const base = `${fmtQty(c, decimals)}${unit ? ` ${unit}` : ""}`;
  const w = num(wastagePct);
  return w != null && w > 0 ? `${base} + ${w}%` : base;
}

/**
 * The counts the section band shows: how many entries, slices and refusals.
 *
 * Derived here rather than in the component so the band cannot drift from the
 * table beneath it — the same reason `requirementSummary` exists next door.
 * REFUSALS ARE COUNTED because the band is where a reader decides whether to
 * trust the page, and a document with three unplannable slices must say three
 * before they scroll to find them.
 */
export function fabricRequirementSummary(rows: readonly FabricSheetRow[]): {
  styles: number;
  entries: number;
  slices: number;
  refused: number;
} {
  let styles = 0;
  let entries = 0;
  let slices = 0;
  let refused = 0;
  for (const r of rows) {
    if (r.kind === "style") styles++;
    if (r.kind === "entry") entries++;
    if (r.kind === "slice") {
      slices++;
      if (r.qty == null) refused++;
    }
  }
  return { styles, entries, slices, refused };
}
