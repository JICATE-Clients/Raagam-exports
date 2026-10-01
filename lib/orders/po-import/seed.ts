/**
 * A reviewed buyer-PO draft → what Order Entry opens with
 * (doc/order/digitalisation-plan.md §2).
 *
 * Pure and client-safe. Order Entry's `?draft=<id>` intent calls
 * `buildPoSeed` with the masters the screen already holds, then hands the
 * result to the SAME `applyRows` a saved document goes through — so a draft
 * opens exactly as a saved order would, and nothing here re-implements a grid.
 *
 * ## WHAT IT FILLS, AND WHAT IT LEAVES FOR THE MERCHANDISER
 *
 * Header: customer, PO No (as typed — po_ref), PO date, delivery date,
 * currency, season, country. Styles (one per style ref, PO qty summed), their
 * sizes, one combo per colour, one quantity row per (style, delivery date) with
 * the size-wise assortment under it, and prices (Style-wise when every line of
 * a style has one price, Color-wise when they differ by colour).
 *
 * Everything the PO cannot say — merchandiser, rejection rule, payment terms,
 * consignee, components, processes — is left blank for the operator. Order
 * Entry's own required-field holds and Save checks then do their normal job.
 *
 * ## A SIZE THAT MATCHES NOTHING IS REPORTED, NEVER DROPPED SILENTLY
 *
 * The quantity row's PO Qty is the PO's own total for that style, INCLUDING
 * pieces in sizes that matched no size master. The assortment cells can only
 * carry the matched sizes, so the quantity balance check on Save will show
 * the gap — which is right: the pieces exist on the buyer's PO and the order
 * must account for them.
 */
import type { SeededAmendmentChildren } from "@/lib/orders/amendments/order-seed";
import { styleKey } from "@/lib/orders/amendments/style-key";
import {
  matchCountry,
  matchCurrency,
  matchCustomer,
  matchSize,
  matchStyle,
  normDate,
  sizeKey,
} from "./match";
import type { PoDraft, PoImportStored } from "./types";

export type PoMasters = {
  customers: readonly { id: string; name: string; code?: string | null; inactive?: boolean | null }[];
  /** `config_lookups` rows of kind 'size'. */
  sizes: readonly { id: string; name: string; code?: string | null }[];
  currencies: readonly { code: string; name: string; symbol?: string | null }[];
  countries: readonly { id: string; name: string; code?: string | null; inactive?: boolean | null }[];
  styles: readonly {
    id: string;
    name: string;
    code?: string | null;
    article_no?: string | null;
    style_category?: string | null;
    style_description?: string | null;
    unit_kind?: string | null;
    blocked?: boolean | null;
  }[];
};

/** A fresh stored record for a draft the model just returned. */
export function storedFromDraft(draft: PoDraft): PoImportStored {
  return autoMatch(
    { draft, customer_id: null, currency_code: null, country_id: null, size_map: {}, style_map: {} },
    null,
  );
}

/** Every size label the draft prints, canonical form, first-seen order. */
export function draftSizeLabels(draft: PoDraft): string[] {
  const out: string[] = [];
  for (const l of draft.lines) for (const s of l.sizes) {
    const k = sizeKey(s.size);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Every style ref the draft prints, as `styleKey`, first-seen order. */
export function draftStyleKeys(draft: PoDraft): string[] {
  const out: string[] = [];
  for (const l of draft.lines) {
    const k = styleKey(l.style_ref_no);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Fill every decision NOBODY HAS MADE YET from the masters. A non-null choice
 * is the reviewer's (or an earlier accepted match) and is never touched; null /
 * absent is re-matched, which is safe because matching is deterministic.
 * `masters = null` only normalises the keys (no master list to match against).
 */
export function autoMatch(stored: PoImportStored, masters: PoMasters | null): PoImportStored {
  const d = stored.draft;
  const size_map: Record<string, string | null> = {};
  for (const k of draftSizeLabels(d)) {
    size_map[k] = stored.size_map[k] ?? (masters ? matchSize(k, masters.sizes)?.id ?? null : null);
  }
  const style_map: Record<string, string | null> = {};
  for (const k of draftStyleKeys(d)) {
    style_map[k] = stored.style_map[k] ?? (masters ? matchStyle(k, masters.styles)?.id ?? null : null);
  }
  return {
    draft: d,
    customer_id:
      stored.customer_id ?? (masters ? matchCustomer(d.header.customer_name, masters.customers)?.id ?? null : null),
    currency_code:
      stored.currency_code ?? (masters ? matchCurrency(d.header.currency, masters.currencies) : null),
    country_id:
      stored.country_id ?? (masters ? matchCountry(d.header.country, masters.countries)?.id ?? null : null),
    size_map,
    style_map,
  };
}

/** What the review screen paints amber / lists under "Still to resolve". */
export function unresolved(stored: PoImportStored): string[] {
  const out: string[] = [];
  const h = stored.draft.header;
  if (!stored.customer_id) out.push(h.customer_name ? `Customer "${h.customer_name}" matches no single customer` : "No customer on the PO");
  if (!h.po_no?.trim()) out.push("No PO number on the PO");
  if (h.currency && !stored.currency_code) out.push(`Currency "${h.currency}" matches no currency`);
  for (const [label, id] of Object.entries(stored.size_map)) if (!id) out.push(`Size "${label}" matches no size`);
  if (!stored.draft.lines.length) out.push("No order lines were read");
  return out;
}

export function draftTotals(draft: PoDraft): { qty: number; value: number | null } {
  let qty = 0;
  let value = 0;
  let priced = true;
  for (const l of draft.lines) {
    const q = l.sizes.reduce((a, s) => a + (Number.isFinite(s.qty) ? s.qty : 0), 0);
    qty += q;
    if (l.unit_price == null) priced = false;
    else value += q * l.unit_price;
  }
  return { qty, value: priced ? Math.round(value * 100) / 100 : null };
}

export type PoSeedHeader = {
  customer_id: string | null;
  po_no: string;
  po_date: string;
  delivery_date: string;
  currency_code: string;
  season: string;
  country_id: string | null;
};

export type PoSeed = {
  header: PoSeedHeader;
  seed: SeededAmendmentChildren;
};

const caps = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** The draft as Order Entry rows. `stored` should already have been through `autoMatch`. */
export function buildPoSeed(stored: PoImportStored, masters: PoMasters): PoSeed {
  const d = stored.draft;
  const headerDelivery = normDate(d.header.delivery_date);

  /* ---- group lines by style ---- */
  type Group = { key: string; ref: string; lines: PoDraft["lines"] };
  const groups: Group[] = [];
  for (const l of d.lines) {
    const key = styleKey(l.style_ref_no) || "STYLE 1";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, ref: key, lines: [] };
      groups.push(g);
    }
    g.lines.push(l);
  }

  const sizeIdOf = (label: string) => stored.size_map[sizeKey(label)] ?? null;
  const lineQty = (l: PoDraft["lines"][number]) => l.sizes.reduce((a, s) => a + (Number.isFinite(s.qty) ? s.qty : 0), 0);

  const seed: SeededAmendmentChildren = {
    styles: [],
    dyeings: [],
    prints: [],
    structures: [],
    combos: [],
    priceDetails: [],
    approvalQtys: [],
    packTypes: [],
    packTypeLines: [],
    styleSizes: [],
    styleCoordinates: [],
    packComponents: [],
    styleComponents: [],
    styleProcesses: [],
    taActivities: [],
    taApprovals: [],
    quantities: [],
    countrySizes: [],
  };

  groups.forEach((g, gi) => {
    const styleId = stored.style_map[g.key] ?? null;
    const master = styleId ? masters.styles.find((s) => s.id === styleId) ?? null : null;
    const firstDesc = g.lines.find((l) => l.description?.trim())?.description ?? null;
    const poQty = g.lines.reduce((a, l) => a + lineQty(l), 0);

    seed.styles.push({
      sno: gi + 1,
      style_ref_no: g.ref,
      style_id: styleId,
      approved_sample_id: null,
      article_no: master?.article_no ?? null,
      style_category: master?.style_category ?? null,
      style_category_id: null,
      style_description: caps(firstDesc) || master?.style_description || null,
      order_unit_id: null,
      plan_unit_id: null,
      unit_kind: master?.unit_kind ?? null,
      layout_type: null,
      po_qty: poQty,
      packs_ordered: null,
      description: null,
    });

    /* Sizes: every MATCHED size the style prints, in first-seen order, once. */
    const sizeIds: string[] = [];
    for (const l of g.lines) for (const s of l.sizes) {
      const id = sizeIdOf(s.size);
      if (id && !sizeIds.includes(id)) sizeIds.push(id);
    }
    sizeIds.forEach((size_id, si) => seed.styleSizes!.push({ style_ref_no: g.ref, sno: si + 1, size_id }));

    /* Combos: one per colour. A line with no colour gets none — the operator names it. */
    const colours: string[] = [];
    for (const l of g.lines) {
      const c = caps(l.colour);
      if (c && !colours.includes(c)) colours.push(c);
    }
    for (const c of colours) {
      seed.combos.push({
        sno: seed.combos.length + 1,
        style_ref_no: g.ref,
        style: g.ref,
        article_no: master?.article_no ?? null,
        combo: c,
        combo_description: null,
        structures: [],
      });
    }

    /* Prices: one price for the style → Style-wise; different by colour → Color-wise. */
    const priced = g.lines.filter((l) => l.unit_price != null);
    const distinct = [...new Set(priced.map((l) => l.unit_price as number))];
    if (distinct.length === 1) {
      seed.priceDetails.push({
        sno: seed.priceDetails.length + 1,
        style_ref_no: g.ref,
        style: g.ref,
        article_no: master?.article_no ?? null,
        price_type: "Style-wise",
        combo: null,
        size_id: null,
        unit: null,
        price: distinct[0],
      });
    } else if (distinct.length > 1) {
      const seen = new Set<string>();
      for (const l of priced) {
        const c = caps(l.colour);
        if (seen.has(c)) continue;
        seen.add(c);
        seed.priceDetails.push({
          sno: seed.priceDetails.length + 1,
          style_ref_no: g.ref,
          style: g.ref,
          article_no: master?.article_no ?? null,
          price_type: "Color-wise",
          combo: c || null,
          size_id: null,
          unit: null,
          price: l.unit_price as number,
        });
      }
    }

    /* Quantities: one row per delivery date of this style. */
    const byDate = new Map<string, PoDraft["lines"]>();
    for (const l of g.lines) {
      const k = normDate(l.delivery_date) ?? headerDelivery ?? "";
      byDate.set(k, [...(byDate.get(k) ?? []), l]);
    }
    for (const [date, lines] of byDate) {
      seed.quantities.push({
        sno: seed.quantities.length + 1,
        country_id: stored.country_id,
        style_ref_no: g.ref,
        style_no: null,
        consignee_id: null,
        assortment_type_id: null,
        pack_type: null,
        // Blank = inherits the header PO No (lib/orders/po-no.ts) — the single-PO case.
        po_no: null,
        po_qty: lines.reduce((a, l) => a + lineQty(l), 0),
        delivery_date: date || null,
        earlier_shipment_date: null,
        warehouse_id: null,
        discharge_port_id: null,
        pack: null,
        is_ratio_wise_pack: false,
        ratio_for: null,
        is_single_style_pack: true,
        master_carton_name: null,
        inner_carton_name: null,
        pack_description: null,
        assort_lines: lines.map((l, li) => ({
          sno: li + 1,
          style_ref_no: g.ref,
          combo: caps(l.colour) || null,
          no_of_cartons: 0,
          inners_per_carton: 0,
          is_pack_row: false,
          sizes: l.sizes
            .map((s) => ({ size_id: sizeIdOf(s.size), qty: s.qty }))
            .filter((s): s is { size_id: string; qty: number } => !!s.size_id && s.qty > 0),
        })),
      });
    }
  });

  return {
    header: {
      customer_id: stored.customer_id,
      // PO No is kept AS TYPED (po_ref, client 2026-09-30) — never upper-cased.
      po_no: (d.header.po_no ?? "").trim(),
      po_date: normDate(d.header.po_date) ?? "",
      delivery_date: headerDelivery ?? earliest(d.lines.map((l) => normDate(l.delivery_date))) ?? "",
      currency_code: stored.currency_code ?? "",
      season: caps(d.header.season),
      country_id: stored.country_id,
    },
    seed,
  };
}

function earliest(dates: (string | null)[]): string | null {
  const real = dates.filter((x): x is string => !!x).sort();
  return real[0] ?? null;
}
