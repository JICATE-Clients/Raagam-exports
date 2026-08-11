import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  AmendmentStyle,
  AmendmentDyeing,
  AmendmentPrint,
  AmendmentStructure,
  AmendmentCombo,
  AmendmentPriceDetail,
  AmendmentApprovalQty,
  AmendmentCountrySize,
  AmendmentPackType,
  AmendmentQuantity,
} from "./types";

/**
 * Orders ▸ Garment Order Amendment — seeding the child tabs from the order.
 *
 * An amendment document that starts BLANK cannot be compared to anything: there
 * is no "before", so nothing downstream can answer "what changed?". So picking
 * the SCNo loads the order's current styles / colours / prints / structures /
 * combos / prices / quantities into the tabs, and the operator edits the ones
 * that are amending. This mirrors the header, which already auto-loads from the
 * order (see `OrderPickerRow` in service.ts — "confirmed behaviour: SCNo loads
 * the order").
 *
 * ── The join key is TEXT, deliberately ──────────────────────────────────────
 * Not one order child table carries a `garment_styles` FK. `order_prices`,
 * `order_descriptions`, `order_coordinate_colors`, `order_pack_ratios` and
 * `order_pack_ratio_lines` all identify a style by `style_ref_no` + `style_no`
 * text (0328 · 0329 · 0330). The amendment child tables match that shape, which
 * is why they look denormalised — they are consistent with the module, and
 * adding a uuid FK to them would make them the odd one out AND force a
 * text↔uuid resolution on every read anyway. The key across the whole Orders
 * module is `(sales_order_id, style_ref_no)`.
 *
 * `garment_order_amendment_styles.style_id` is the one exception (0128): the
 * Style(s) tab has a real picker. It is resolved by NAME here, and left null
 * when the order's `style_no` names no style master — never invented.
 *
 * ── What this file does NOT do ──────────────────────────────────────────────
 * It does not write anything, and it does not apply an amendment back to the
 * order. Whether approval mutates the live `sales_orders` is still an open
 * question with the client; 0129 records the decision only, on purpose.
 */

/** A child row as it exists BEFORE the amendment is saved: no id, no parent. */
type Seeded<T> = Omit<T, "id" | "amendment_id">;

export interface SeededAmendmentChildren {
  styles: Seeded<AmendmentStyle>[];
  dyeings: Seeded<AmendmentDyeing>[];
  prints: Seeded<AmendmentPrint>[];
  structures: Seeded<AmendmentStructure>[];
  combos: Seeded<AmendmentCombo>[];
  priceDetails: Seeded<AmendmentPriceDetail>[];
  approvalQtys: Seeded<AmendmentApprovalQty>[];
  /**
   * Quantities (0398) — one row per style, carrying its ordered quantity.
   *
   * THE ONLY TAB WITH NO ORDER-SIDE TABLE TO RESTATE. `sales_orders` holds a
   * single header `order_qty` / `delivery_date` / `ship_date` and no per-country
   * or per-consignee split, so there is nothing to mirror the way the other tabs
   * mirror their children. Seeding the per-style quantities off `order_pack_ratios`
   * — the same source Approval Qty uses — is the closest honest starting point:
   * the operator splits a row by country or consignee from there.
   *
   * Country, consignee, warehouse and port are left NULL rather than guessed.
   * The order does not carry them, and a plausible wrong default on a shipping
   * document is worse than an empty cell.
   */
  quantities: Seeded<AmendmentQuantity>[];
  /**
   * Pack type(s) (0399) — ALWAYS EMPTY FROM AN ORDER, and optional for that
   * reason.
   *
   * Quantities at least had `order_pack_ratios` to start from. Nothing on the
   * order side records a packing METHOD: `order_pack_ratios` holds the ratio
   * lines, not whether the carton is solid or assorted. So there is nothing to
   * restate and the tab starts on its one blank row.
   *
   * It is in this type all the same because `applyRows` maps a saved document
   * through the SAME shape — the tab would otherwise be the one grid whose
   * stored rows had no way back onto the screen.
   */
  packTypes?: Seeded<AmendmentPackType>[];
  /** Still seeded and still diffed (scripts/check-amendment-diff.mts), but the
   *  Country/Sizewise TAB was withdrawn on 2026-08-10, so the screen no longer
   *  consumes it. Optional rather than deleted: the diff vectors are the only
   *  remaining consumer and they should keep working. */
  countrySizes?: Seeded<AmendmentCountrySize>[];
  /**
   * How many of the order's fabrics are solid / yarn-dyed / melange.
   *
   * NOT ROWS, and deliberately not a tab: melange takes its colour from the
   * purchased yarn and yarn-dyed is coloured before knitting, so both need no
   * dyeing row — a fact the Color/Print tab should SAY rather than enforce.
   * `order_fabrics.item_sub_type` is per fabric ROW, so "this order is melange"
   * is not a well-formed statement and a mixed order is normal; hiding a grid on
   * it would strand rows already saved on a grid that no longer renders.
   */
  fabricTypes?: FabricTypeCounts;
}

/** Counts by `order_fabrics.item_sub_type`; `other` covers null / unrecognised. */
export type FabricTypeCounts = {
  solid: number;
  yarn_dyed: number;
  melange: number;
  other: number;
};

export const EMPTY_SEED: SeededAmendmentChildren = {
  styles: [],
  dyeings: [],
  prints: [],
  structures: [],
  combos: [],
  priceDetails: [],
  approvalQtys: [],
  packTypes: [],
  quantities: [],
  countrySizes: [],
};

/**
 * The style key, normalised. Trim + upper-case, because field VALUES are stored
 * in capitals app-wide (AGENTS.md "CAPITALS") but rows saved before that rule
 * are not — so `"tsh-001 "` off an old order and `"TSH-001"` off a new one are
 * the same style and must match. Returns "" for a row with no style at all,
 * which callers treat as unkeyed rather than as a style named "".
 */
export function styleKey(refNo: string | null, styleNo?: string | null): string {
  return (refNo?.trim() || styleNo?.trim() || "").toUpperCase();
}

// ---------------------------------------------------------------------------
// THE ONE POLICY CALL IN THIS FILE — see the note at the bottom of the module.
// ---------------------------------------------------------------------------

/**
 * The order names its colours, prints and structures as free TEXT
 * (`order_fabric_components.fabric_color` / `.fabric_print`,
 * `order_fabrics.structure_name`). The amendment stores them as uuid FKs into
 * `color_card_colors` and `config_lookups`. So seeding has to resolve text to a
 * master row — and some of it will not resolve, because the order side was
 * never constrained to the masters.
 *
 * DECIDED (2026-08-09): the row is KEPT, with a blank picker, for all three
 * kinds. A colour the order really carries must not vanish from the amendment
 * without the operator seeing it — a blank picker is a visible prompt, a
 * dropped row is silent data loss, and silence is the failure mode nobody
 * catches. The cost is accepted and real: **a seeded amendment can arrive with
 * blanks that must be filled before it will save**, and on an order whose
 * colours were all typed freehand that may be every row in the tab.
 *
 * It stays a function, and stays per-kind, because the obvious next request is
 * to split it — an unmatched colour is worth chasing, an unmatched structure
 * name is often legacy noise. One `if` here, never a condition at a call site.
 */
export function keepUnmatchedMaster(
  _kind: "colour" | "print" | "structure",
  _text: string,
): boolean {
  return true;
}

// ---------------------------------------------------------------------------

/** Case-insensitive text → master id, for the three text-keyed tabs. */
function indexByName(rows: { id: string; name: string | null }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = r.name?.trim().toUpperCase();
    if (k && !m.has(k)) m.set(k, r.id);
  }
  return m;
}

/**
 * Read the order as it stands and shape it into the amendment's eight child
 * tabs. Returns `EMPTY_SEED` for an order id that resolves to nothing, so a
 * caller never has to null-check the individual arrays.
 */
export async function seedAmendmentFromOrder(
  salesOrderId: string,
): Promise<SeededAmendmentChildren> {
  if (!salesOrderId) return EMPTY_SEED;
  const s = await createClient();

  // ---- the order's own children -------------------------------------------
  const [{ data: prices }, { data: packs }, { data: fabrics }] = await Promise.all([
    s
      .from("order_prices")
      .select("sno, style_ref_no, style_no, article_no, price_type, rate_uom, rate")
      .eq("sales_order_id", salesOrderId)
      .order("sno"),
    s
      .from("order_pack_ratios")
      .select("id, sno, style_ref_no, style_no, country_code, order_qty")
      .eq("sales_order_id", salesOrderId)
      .order("sno"),
    s
      .from("order_fabrics")
      .select("id, sno, style_ref_no, style_no, combo, structure_name, item_sub_type")
      .eq("sales_order_id", salesOrderId)
      .order("sno"),
  ]);

  const packIds = (packs ?? []).map((p) => p.id);
  const fabricIds = (fabrics ?? []).map((f) => f.id);

  const [{ data: packLines }, { data: components }] = await Promise.all([
    packIds.length
      ? s
          .from("order_pack_ratio_lines")
          .select("sno, style_ref_no, style_no, combo")
          .in("pack_ratio_id", packIds)
          .order("sno")
      : Promise.resolve({ data: [] as { sno: number; style_ref_no: string | null; style_no: string | null; combo: string | null }[] }),
    fabricIds.length
      ? s
          .from("order_fabric_components")
          .select("id, sno, fabric_color, fabric_print")
          .in("order_fabric_id", fabricIds)
          .order("sno")
      : Promise.resolve({ data: [] as { id: string; sno: number; fabric_color: string | null; fabric_print: string | null }[] }),
  ]);

  const componentIds = (components ?? []).map((c) => c.id);
  const { data: yarnColors } = componentIds.length
    ? await s
        .from("order_fabric_yarn_colors")
        .select("sno, yarn_dyed_color")
        .in("fabric_component_id", componentIds)
        .order("sno")
    : { data: [] as { sno: number; yarn_dyed_color: string }[] };

  // ---- the masters the text has to resolve against ------------------------
  const [{ data: styleRows }, { data: colorRows }, { data: lookupRows }] = await Promise.all([
    s
      .from("garment_styles")
      // `categories`, not `config_lookups` — 0394 repointed style_category_id and
      // kept the constraint name, so the old embed named a relationship that no
      // longer exists and failed the whole seed query (same defect as service.ts).
      .select("id, style_name, article_no, style_description, category:categories!style_category_id(name)")
      .eq("blocked", false),
    s.from("color_card_colors").select("id, name"),
    s
      .from("config_lookups")
      .select("id, kind, name")
      // `fabric_structure`, not the empty `structure` kind — see 0396 and the
      // note on `structureOpts` in amendment-screen.tsx. Matching
      // `order_fabrics.structure_name` against an empty index is why every
      // seeded structure row arrived with a null id and was dropped on save.
      .in("kind", ["roll_form_print", "fabric_structure"])
      .eq("is_active", true),
  ]);

  type StyleMaster = {
    id: string;
    style_name: string | null;
    article_no: string | null;
    style_description: string | null;
    category: { name: string | null } | null;
  };
  const styleMasters = (styleRows ?? []) as unknown as StyleMaster[];
  const styleByName = new Map<string, StyleMaster>();
  for (const r of styleMasters) {
    const k = r.style_name?.trim().toUpperCase();
    if (k && !styleByName.has(k)) styleByName.set(k, r);
  }

  const colorByName = indexByName((colorRows ?? []) as { id: string; name: string | null }[]);
  const lookups = (lookupRows ?? []) as { id: string; kind: string; name: string | null }[];
  const printByName = indexByName(lookups.filter((l) => l.kind === "roll_form_print"));
  const structureByName = indexByName(lookups.filter((l) => l.kind === "fabric_structure"));

  // ---- Style(s) ------------------------------------------------------------
  // No order-side styles TABLE exists, so the tab is derived: every distinct
  // style the order's prices and pack ratios mention, in first-seen order.
  const styles: Seeded<AmendmentStyle>[] = [];
  const seenStyle = new Set<string>();
  for (const r of [...(prices ?? []), ...(packs ?? [])]) {
    const key = styleKey(r.style_ref_no, r.style_no);
    if (!key || seenStyle.has(key)) continue;
    seenStyle.add(key);
    const master = styleByName.get((r.style_no ?? "").trim().toUpperCase()) ?? null;
    styles.push({
      sno: styles.length + 1,
      style_ref_no: r.style_ref_no ?? r.style_no ?? null,
      style_id: master?.id ?? null,
      article_no: master?.article_no ?? null,
      style_category: master?.category?.name ?? null,
      style_description: master?.style_description ?? null,
      // Units and PO qty are amendment-side decisions with no order-side
      // column to read — the operator sets them.
      order_unit_id: null,
      plan_unit_id: null,
      po_qty: 0,
      description: null,
    });
  }

  /** Style ref + article for the four text-keyed tabs, off the derived list. */
  const styleLabel = (refNo: string | null, styleNo: string | null) => {
    const hit = styles.find((x) => styleKey(x.style_ref_no) === styleKey(refNo, styleNo));
    return {
      style_ref_no: refNo ?? styleNo ?? null,
      style: styleNo ?? null,
      article_no: hit?.article_no ?? null,
    };
  };

  // ---- Color / Print — dyeings, prints, structures --------------------------
  const dyeings: Seeded<AmendmentDyeing>[] = [];
  for (const y of yarnColors ?? []) {
    const id = colorByName.get(y.yarn_dyed_color.trim().toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("colour", y.yarn_dyed_color)) continue;
    dyeings.push({ sno: dyeings.length + 1, section: "yarn", dye_type: null, color_id: id });
  }
  for (const c of components ?? []) {
    if (!c.fabric_color?.trim()) continue;
    const id = colorByName.get(c.fabric_color.trim().toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("colour", c.fabric_color)) continue;
    dyeings.push({ sno: dyeings.length + 1, section: "fabric", dye_type: null, color_id: id });
  }

  const prints: Seeded<AmendmentPrint>[] = [];
  const seenPrint = new Set<string>();
  for (const c of components ?? []) {
    const text = c.fabric_print?.trim();
    if (!text || seenPrint.has(text.toUpperCase())) continue;
    seenPrint.add(text.toUpperCase());
    const id = printByName.get(text.toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("print", text)) continue;
    prints.push({ sno: prints.length + 1, print_id: id });
  }

  /**
   * The structures the STYLE already declares, from its Components tab.
   *
   * "The system should automatically fill these rows based on the fabric
   * structures already defined in the initial Style Entry … pulled directly from
   * the Components tab of the Style setup" (client 2026-08-10). Listing them here
   * is what makes them available to the Combos tab, where colours get mapped onto
   * individual parts.
   *
   * FETCHED HERE RATHER THAN IN THE `Promise.all` ABOVE, because it is keyed on
   * `styles[].style_id`, which does not exist until the derived Style(s) list has
   * been resolved against `styleByName` a few lines up. One extra round trip, and
   * only when the order resolved to at least one style master.
   */
  const styleIds = [
    ...new Set(styles.map((x) => x.style_id).filter((x): x is string => !!x)),
  ];
  const { data: styleComponents } = styleIds.length
    ? await s
        .from("garment_style_components")
        .select("structure_id")
        .in("style_id", styleIds)
    : { data: [] as { structure_id: string | null }[] };

  const structures: Seeded<AmendmentStructure>[] = [];
  // TWO SOURCES, ONE LIST, SO DEDUPE HAS TO WORK IN BOTH CURRENCIES: the order's
  // fabrics carry structure NAMES (free text on `order_fabrics`), the style's
  // components carry structure IDS. A single text-keyed set would let the same
  // structure in twice, once under each.
  const seenStructure = new Set<string>();
  const seenStructureId = new Set<string>();
  for (const f of fabrics ?? []) {
    const text = f.structure_name?.trim();
    if (!text || seenStructure.has(text.toUpperCase())) continue;
    seenStructure.add(text.toUpperCase());
    const id = structureByName.get(text.toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("structure", text)) continue;
    if (id) seenStructureId.add(id);
    structures.push({ sno: structures.length + 1, structure_id: id });
  }
  // UNION, NOT REPLACE. A PO can name a structure the style never mentioned —
  // which is exactly what the spec's "+ Add structure provides manual
  // flexibility" is for — so the order's own rows keep their place at the top.
  for (const c of (styleComponents ?? []) as { structure_id: string | null }[]) {
    const id = c.structure_id;
    if (!id || seenStructureId.has(id)) continue;
    seenStructureId.add(id);
    structures.push({ sno: structures.length + 1, structure_id: id });
  }

  /**
   * The dyeing hint's data. `items.fabric_type_id`'s validation message names the
   * purpose exactly: "Fabric Type is required (Solid, Yarn-dyed or Melange) — it
   * determines the dyeing PO type." This is the order-level echo of that.
   */
  const fabricTypes: FabricTypeCounts = { solid: 0, yarn_dyed: 0, melange: 0, other: 0 };
  for (const f of fabrics ?? []) {
    const t = (f as { item_sub_type?: string | null }).item_sub_type;
    if (t === "solid" || t === "yarn_dyed" || t === "melange") fabricTypes[t] += 1;
    else fabricTypes.other += 1;
  }

  // ---- Combos --------------------------------------------------------------
  // A combo is named on both the fabric rows and the pack-ratio lines; the same
  // combo on both is one row, keyed by style + combo.
  const combos: Seeded<AmendmentCombo>[] = [];
  const seenCombo = new Set<string>();
  for (const r of [...(fabrics ?? []), ...(packLines ?? [])]) {
    const combo = r.combo?.trim();
    if (!combo) continue;
    const k = `${styleKey(r.style_ref_no, r.style_no)}|${combo.toUpperCase()}`;
    if (seenCombo.has(k)) continue;
    seenCombo.add(k);
    combos.push({ sno: combos.length + 1, ...styleLabel(r.style_ref_no, r.style_no) });
  }

  // ---- Prices --------------------------------------------------------------
  // `order_prices` is a structural match for the tab: style / article / type /
  // uom / rate. `rate_for_docs` and `mrp_rate` have no amendment column.
  const priceDetails: Seeded<AmendmentPriceDetail>[] = (prices ?? []).map((p, i) => ({
    sno: i + 1,
    ...styleLabel(p.style_ref_no, p.style_no),
    article_no: p.article_no ?? styleLabel(p.style_ref_no, p.style_no).article_no,
    price_type: p.price_type ?? null,
    unit: p.rate_uom ?? null,
    price: Number(p.rate ?? 0),
  }));

  // ---- Approval Qty + Country/Sizewise -------------------------------------
  // Both come off `order_pack_ratios`: one row per style, its ordered quantity
  // and whether the order carries a country breakdown.
  const approvalQtys: Seeded<AmendmentApprovalQty>[] = [];
  const quantities: Seeded<AmendmentQuantity>[] = [];
  const countrySizes: Seeded<AmendmentCountrySize>[] = [];
  const seenPackStyle = new Set<string>();
  for (const p of packs ?? []) {
    const key = styleKey(p.style_ref_no, p.style_no);
    if (!key || seenPackStyle.has(key)) continue;
    seenPackStyle.add(key);
    const label = styleLabel(p.style_ref_no, p.style_no);
    approvalQtys.push({
      sno: approvalQtys.length + 1,
      ...label,
      approval_qty: Number(p.order_qty ?? 0),
    });
    countrySizes.push({
      sno: countrySizes.length + 1,
      ...label,
      countrywise: !!p.country_code?.trim(),
    });
    quantities.push({
      sno: quantities.length + 1,
      country_id: null,
      style_ref_no: p.style_ref_no,
      // `styleLabel` names its column `style`; this table's is `style_no`,
      // matching the order children it is keyed against.
      style_no: p.style_no,
      consignee_id: null,
      assortment_type_id: null,
      po_qty: Number(p.order_qty ?? 0),
      delivery_date: null,
      earlier_shipment_date: null,
      warehouse_id: null,
      discharge_port_id: null,
    });
  }

  return { styles, dyeings, prints, structures, combos, priceDetails, approvalQtys, quantities, countrySizes, fabricTypes };
}
