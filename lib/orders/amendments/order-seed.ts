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
  countrySizes: Seeded<AmendmentCountrySize>[];
}

export const EMPTY_SEED: SeededAmendmentChildren = {
  styles: [],
  dyeings: [],
  prints: [],
  structures: [],
  combos: [],
  priceDetails: [],
  approvalQtys: [],
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
      .select("id, sno, style_ref_no, style_no, combo, structure_name")
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
      .select("id, style_name, article_no, style_description, category:config_lookups!style_category_id(name)")
      .eq("blocked", false),
    s.from("color_card_colors").select("id, name"),
    s
      .from("config_lookups")
      .select("id, kind, name")
      .in("kind", ["roll_form_print", "structure"])
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
  const structureByName = indexByName(lookups.filter((l) => l.kind === "structure"));

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

  const structures: Seeded<AmendmentStructure>[] = [];
  const seenStructure = new Set<string>();
  for (const f of fabrics ?? []) {
    const text = f.structure_name?.trim();
    if (!text || seenStructure.has(text.toUpperCase())) continue;
    seenStructure.add(text.toUpperCase());
    const id = structureByName.get(text.toUpperCase()) ?? null;
    if (!id && !keepUnmatchedMaster("structure", text)) continue;
    structures.push({ sno: structures.length + 1, structure_id: id });
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
  }

  return { styles, dyeings, prints, structures, combos, priceDetails, approvalQtys, countrySizes };
}
