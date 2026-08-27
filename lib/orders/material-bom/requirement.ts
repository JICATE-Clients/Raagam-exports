/**
 * Material BOM — how much of a material an order needs.
 *
 *     Total Material Required = SKU Quantity x (Number of Items / Number of Pieces)
 *
 * Client spec: 2 labels per piece on 600 pieces is 1,200 labels; 1 metre that
 * makes 4 pieces divides the total by 4. Plus a per-line Wastage %, and an
 * Attribute that decides how the requirement SPLITS — one bulk figure for the
 * order, one row per colour, or one row per size.
 *
 * "SKU Quantity" WAS the production target — order qty + excess + approval
 * pieces + rejection allowance — and since 2026-08-20 it is the ENTERED order
 * quantity alone. The client's instruction; see `targetsOf` below for what it
 * costs and how to put it back. `productionTarget()` in
 * `../amendments/approval-qty.ts` is untouched and still drives the Approval Qty
 * tab, so the two are now deliberately different numbers rather than accidentally
 * different ones.
 *
 * Client-safe (no `server-only`) for the reason `approval-qty.ts` and
 * `order-value.ts` are: the figures recalculate as the operator types, so they
 * run in the browser — and the server action computes the STORED requirement
 * from these same functions, which is what stops the number the operator
 * approved and the number a purchase order is checked against from being
 * derived twice.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * The rule `order-value.ts` records for money applies here with the same force,
 * because this number is spent: a requirement of 0 renders as "none needed",
 * which is the one answer a material requirement never intends. Every branch
 * that cannot answer returns a `Refusal` carrying the SENTENCE the screen
 * prints, so the operator learns which tab to go and fix.
 *
 * ## A PARTIAL EXPLOSION IS THE DANGEROUS ONE
 *
 * If one colour of a three-colour order has no quantity, emitting two rows
 * instead of three produces a smaller total that looks exactly like a correct
 * answer. So a set disagreement between the Combos tab and the Approval Qty tab
 * poisons the WHOLE explosion rather than being quietly dropped from it — the
 * same call `styleRate` makes for a priced style with no quantity behind it.
 */

import { excessQty, productionTarget } from "@/lib/orders/amendments/approval-qty";
import { styleKey } from "@/lib/orders/amendments/style-key";
import {
  ceilToPrecision,
  isUsableConversion,
  toPurchaseQty,
  uomPrecision,
  type ConversionLine,
} from "@/lib/uom/convert";
import type { RejectionTier } from "@/lib/masters/rejection-rule";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * How a material's requirement splits.
 *
 * LOWERCASE, and stored in a CHECKed text column rather than pointed at
 * `config_lookups`. The Attribute picker that used to sit in this cell reads
 * kind `material_attribute`, whose entire live content is one hand-typed row
 * ("STYLE") that no migration ever seeded — so a switch on it resolves to "no
 * basis" for every row, leaving the feature inert and looking configured. And a
 * lookup name is operator-editable and stored in CAPITALS, so `=== "Color-wise"`
 * compiles, runs and quietly matches nothing, which is the failure AGENTS.md
 * records under Nominated vendors. Lowercase matches this schema's own idiom
 * (`ratio_for in ('master','inner')`, 0414).
 *
 * ## `size` AND `combination` ARE NOT THE SAME SPLIT, and conflating them is a
 * ## bug this module shipped once
 *
 * A SIZE LABEL DOES NOT CARE WHAT COLOUR THE SHIRT IS. Size-wise must give one
 * row per size — every Medium garment across every colourway — because that is
 * the number of Medium labels to buy. Emitting `WHITE · M` and `NAVY · M`
 * separately is the COMBINATION split wearing the wrong name: it doubles the row
 * count and asks the operator to reconcile two numbers that are only ever added
 * back together.
 *
 * Combination is the genuine matrix, for a trim that varies along BOTH axes —
 * the size label printed in the garment's own colour. It is the only basis whose
 * row identifies a single SKU.
 */
/*
 * FIVE BASES, AND THE ORDER OF THIS TUPLE IS THE SCREEN'S ORDER.
 *
 * `style` added 2026-08-20 (client: "yes add style wise"), to match the Prices
 * tab's four modes — Style-wise / Color-wise / Size-wise / Color+Size — which is
 * the tab the Material BOM's Attribute is being made to read like.
 *
 * It sits after `order` because the list reads OUTWARD-IN: the whole order, then
 * a style, then a colour of that style, then a size of that colour, then both.
 * Each basis is a finer cut of the one before it, and a Select that reads in
 * that order tells the operator what it is choosing between.
 */
export const REQUIREMENT_BASES = [
  "order",
  "style",
  "colour",
  "size",
  "combination",
  /*
   * THE DESTINATION AXIS, and it breaks the outward-in reading above (client
   * 2026-08-21). The five before it are successively finer cuts of the PRODUCT —
   * order, style, colourway, size, the matrix. This one cuts by WHERE THE GOODS
   * SHIP, which is a different question entirely, and a Select that lists it as
   * a sixth degree of fineness would mislead. Group it separately on screen.
   *
   * Appended rather than inserted: the tuple order is the Select's order, and
   * moving an existing entry would silently re-sort a list the operator has
   * learned.
   */
  "country",
] as const;
export type RequirementBasis = (typeof REQUIREMENT_BASES)[number];

/**
 * WHAT THE ATTRIBUTE DROPDOWN OFFERS — four, not six (client 2026-08-21, with
 * the legacy screen beside ours).
 *
 * Legacy shows `Attribute = Country` with a SIZE-WISE TICK on each sub-row, and
 * the client confirmed that model: the Attribute picks ONE axis and a row splits
 * ITSELF into sizes. So the two composite options come off the list —
 *
 *     Colour + tick  IS  the old `combination`
 *     Order  + tick  IS  the old `size`
 *
 * ## THE TWO BRANCHES ARE NOT DELETED, AND THAT IS THE POINT
 *
 * `size` and `combination` stay in `REQUIREMENT_BASES`, in both CHECK
 * constraints, and as live branches of `productionSlices` — because that size
 * apportionment IS what a size-wise tick expands a row with. Deleting them would
 * mean writing the largest-remainder walk a second time, and the invariant that
 * every basis sums to the same total is what the vectors lean on hardest.
 *
 * They also stay so a row STORED under the old basis still resolves: the column
 * keeps its value and `REQUIREMENT_BASIS_LABELS` keeps its name. A storage
 * vocabulary and a menu are different lists, and conflating them is how a
 * dropdown change becomes a data migration.
 */
export const OFFERED_REQUIREMENT_BASES = [
  "order",
  "style",
  "colour",
  "country",
] as const satisfies readonly RequirementBasis[];

/**
 * BASES WHOSE ROWS ARE ALREADY ONE PER SIZE, so the per-row "Size wise" tick has
 * nothing left to add and must stand down (see `productionSlices`).
 *
 * Kept as a literal here rather than derived from `axesOfBasis` in
 * `lib/orders/bom-explosion/exploder.ts`, which would be the single declaration:
 * that module imports this one for `RequirementBasis`, so reading it back would
 * be an import cycle. The two are held together by a vector instead —
 * `check-bom-explosion.mts` asserts that the tick is a no-op on exactly the
 * bases whose axis set contains `size`, so they cannot drift apart silently.
 */
const SIZE_IS_ALREADY_THE_GRAIN = new Set<RequirementBasis>(["size", "combination"]);

/** What the screen prints when a figure cannot be produced. Never an empty
 *  string: a blank cell and a refused cell must not look alike. */
export type Refusal = { refused: string };

export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";
}

/**
 * One row the requirement explodes into.
 *
 * KEYED BY STYLE AND COMBO, never combo alone. WHITE can exist under two styles
 * with different targets, and collapsing them would let one style's white absorb
 * the other's — a wrong number with nothing on screen saying two things were
 * merged.
 */
export type ProductionSlice = {
  key: string;
  label: string;
  qty: number;
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  /**
   * The destination this slice ships to, on a country-wise line and nowhere
   * else. NULL on every other basis, and that is a VALUE — "every destination" —
   * not a missing lookup.
   */
  country_id?: string | null;
};

/**
 * An Approval Qty row, as much of it as the requirement needs.
 *
 * **ONE ROW IS ONE SIZE CELL**, and the absence of `size_id` here is what makes
 * that easy to misread — it is dropped because the requirement needs the
 * QUANTITY and not the label, never because rows are rolled up to the colourway
 * first. `garment_order_amendment_approval_qtys` stores one row per
 * `(style_ref_no, combo, size_id)` and `bom-order-basis.ts` maps them straight
 * across, so a colourway of five sizes arrives as five rows.
 *
 * It has to stay that way. `fullTarget` runs the rejection rule on `qty`, and
 * the rule is BRACKETED — summing the sizes first and bracketing the total is a
 * different, smaller answer (1,000 split 10/90/400/300/200 draws 53 extra pieces
 * per size and 30 in one go), and it is the smaller one that leaves a ten-piece
 * size run with no buffer at all. That is the failure the whole rule exists to
 * prevent, so a "tidy-up" that groups these rows by combo is a regression.
 */
export type ApprovalRow = {
  style_ref_no: string | null;
  combo: string | null;
  /** Ordered pieces of ONE SIZE of this style + combo. */
  qty: number;
  approval_qty: number;
};

/** A Combos-tab row. Present so a colour with no quantity can be NAMED. */
export type ComboRow = { style_ref_no: string | null; combo: string | null };

/**
 * One (style, combo, size) quantity off the Quantities tab's Assort tree (0414).
 *
 * Flattened by the caller — `no_of_cartons x that size's pieces` — exactly as
 * `ValuedQty` is in `order-value.ts`: the tree shape is the screen's business
 * and this module needs three keys and a number.
 *
 * READ AS A RATIO, NEVER AS ABSOLUTE PIECES — see `productionSlices`.
 */
export type AssortSizeRow = {
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  qty: number;
  /** The destination row these pieces belong to (0398). Null on a pre-0398 row. */
  country_id?: string | null;
};

/** Everything about the ORDER the requirement depends on. */
export type OrderProductionInput = {
  /** The order header's Excess %, applied per approval line. */
  excessPct: number;
  /** Whether a Garment Rejection Rule was named on the order (0413). */
  rejectionRuleChosen: boolean;
  tiers: readonly RejectionTier[] | null | undefined;
  approvals: readonly ApprovalRow[];
  combos: readonly ComboRow[];
  assortSizes: readonly AssortSizeRow[];
  /**
   * What the operator calls each size, keyed by id.
   *
   * A MAP AND NOT A FUNCTION, and that is a hard requirement rather than a
   * preference. This whole object is the return value of a SERVER ACTION
   * (`loadOrderProduction`), so React has to serialize it across the
   * server→client boundary — and a function cannot cross:
   *
   *     Functions cannot be passed directly to Client Components unless you
   *     explicitly expose it by marking it with "use server".
   *
   * It was `(id: string) => string`, a closure over a `Map` built in
   * `sizeNameFn()`, and the screen threw the moment an order was picked. Nothing
   * caught it earlier because `tsc` and the `check:*` scripts are both blind to
   * that boundary — the same gap AGENTS.md records under "Build is the gate".
   *
   * Optional still: a caller with no size lookup labels a slice by its uuid,
   * which is legible to nobody but is not wrong.
   */
  sizeNames?: Readonly<Record<string, string>>;
  /**
   * What the operator calls each destination country, keyed by id. A MAP, never
   * a resolver function, for exactly the reason `sizeNames` above records: this
   * object crosses a server action boundary and a function cannot.
   */
  countryNames?: Readonly<Record<string, string>>;
};

/** A BOM line, as much of it as the requirement needs. */
export type BomLineInput = {
  /** "Number of Items" — how many are used. The NUMERATOR. */
  no_of_items: number | null;
  /** "Number of Pieces" — how many garments they cover. The DIVISOR. */
  per_pieces: number | null;
  /** The line's own Wastage %. NOT the order's Excess %, which is already
   *  inside the slice quantity. */
  excess_pct: number | null;
  /** `uoms.decimal_places_allowed` of the CONSUMPTION unit. */
  decimals: number | null;
};

/**
 * One panel's share of a line (0436) — the Combination sheet's row, as much of
 * it as the requirement needs.
 *
 * `label` is the caller's, because THIS MODULE IS NAME-BLIND and a refusal has
 * to name the panel it is about. Everything else here resolves ids to names in
 * the screen, so passing the one string a refusal needs is cheaper than teaching
 * the engine the components master.
 */
export type BomLineComponent = {
  component_id: string;
  /** NULL means the line's own Item Color (0436). */
  item_color_id: string | null;
  no_of_items: number | null;
  per_pieces: number | null;
  label?: string | null;
};

/**
 * A LINE'S PANELS, COLLAPSED ONTO THE THING YOU ACTUALLY BUY.
 *
 * You do not buy sleeve-thread and front-thread; you buy thread — so panels of
 * the SAME colour sum into one rate and vanish. You do buy white thread and navy
 * thread separately, so each distinct colour survives as its own split and
 * becomes its own requirement row. That boundary is 0436's whole design, and it
 * is why a component never reaches `material_bom_amendment_requirements` while a
 * colour now does.
 *
 * The summed rate is expressed as items per ONE piece, so a split can be handed
 * straight to `requirementFor` with `per_pieces: 1`. Two front/2-per and
 * sleeve/1-per-2 become 2 + 0.5 = 2.5 per garment, which is the number a cone is
 * bought against — the panels are how it was ARRIVED at, not how it is ordered.
 *
 * AN EMPTY ARRAY IS NOT A REFUSAL, and callers must not treat it as one: a line
 * with no panels is the ordinary line, and its own ratio applies. 0436 is opt-in
 * per line precisely so that stays true.
 */
export type ColourSplit = {
  /** NULL means the line's own Item Color — resolved by the caller, which is
   *  also the only layer that can name a colour. */
  item_color_id: string | null;
  /** Which panels fed this rate. For the screen's summary; never arithmetic. */
  component_ids: string[];
  /** The panels' rates SUMMED, over one piece. */
  no_of_items: number;
  per_pieces: 1;
};

export function colourSplits(
  lineColourId: string | null,
  components: readonly BomLineComponent[],
): ColourSplit[] | Refusal {
  if (components.length === 0) return [];

  // Insertion-ordered, so the sheet's row order is the requirement's row order.
  // A Map keyed by the resolved colour is what merges two panels of one colour.
  const byColour = new Map<string, ColourSplit>();
  /* Which (panel, colour) pairs have already been counted — see the guard in the
     loop. A Set rather than a look at `component_ids`, because that array is the
     screen's summary and reading arithmetic off a display field is how the two
     come to mean different things. */
  const seen = new Set<string>();

  for (const c of components) {
    const items = num(c.no_of_items);
    const pieces = num(c.per_pieces);
    const who = (c.label ?? "").trim() || "A panel";

    // The same two guards `requirementFor` applies to a line, applied one level
    // down — because a bad panel would otherwise be summed into a rate that
    // looks entirely reasonable, and the refusal would name the LINE. `x / 0` is
    // Infinity in JS rather than a throw, which is how it would escape.
    if (items == null || items < 0) {
      return { refused: `${who}: enter how many are used` };
    }
    if (pieces == null || pieces <= 0) {
      return { refused: `${who}: pieces must be more than 0` };
    }

    const colour = c.item_color_id ?? lineColourId ?? null;
    const key = colour ?? "";

    /*
     * THE SAME PANEL LISTED TWICE FOR ONE COLOUR IS ONE PANEL COUNTED TWICE.
     *
     * Summing is this function's whole job — front body plus sleeves is one
     * thread rate — and the premise underneath it is that each row is a
     * DISTINCT panel. Hand it the same panel twice and the sum silently
     * doubles: not a crash, not a dash, just a rate that reads entirely
     * reasonably and buys twice what the order needs. That is the failure the
     * module header opens with, one level down from where it warns about it.
     *
     * ## IT IS A REFUSAL BECAUSE NOTHING ELSE CATCHES IT
     *
     * `material_bom_amendment_item_components` carries a PK on `id` and three
     * FKs and NO unique key over (item_line_id, component_id, item_color_id) —
     * checked against the live catalogue on 2026-08-25 — so a duplicate is
     * representable, insertable and invisible. And the caller cannot be trusted
     * to have de-duplicated: the screen's surviving caller synthesises this list
     * rather than reading the panel store (see `panelConsumption`'s header), and
     * it synthesises one entry PER PRODUCTION SLICE, so a two-part line over two
     * colourways hands four "panels" here of which two are TOP and two BOTTOM.
     * Measured against the real functions: the rate came to 8 where the honest
     * per-part figure is 4, and the line total to 8,000 against an honest 2,000.
     *
     * ## WHAT IT DELIBERATELY DOES NOT REFUSE
     *
     * The same panel in two DIFFERENT colours — a front body stitched in navy
     * and topstitched in red — is two things to buy and is 0436's own case, so
     * the identity is the PAIR. That also bounds the guard honestly: a caller
     * that fans a panel out across slices AND sets a different Item Color on
     * each row produces distinct pairs and passes. It catches the shape that
     * actually occurs, not every shape that could.
     */
    const ident = `${c.component_id}${SEP}${key}`;
    if (seen.has(ident)) {
      return { refused: `${who}: listed twice for one colour — enter each panel once` };
    }
    seen.add(ident);

    const at = byColour.get(key);
    if (at) {
      at.no_of_items += items / pieces;
      at.component_ids.push(c.component_id);
    } else {
      byColour.set(key, {
        item_color_id: colour,
        component_ids: [c.component_id],
        no_of_items: items / pieces,
        per_pieces: 1,
      });
    }
  }

  return [...byColour.values()];
}

/**
 * ONE PANEL SPLIT'S FINAL RATIO, after the slice's own overrides have resolved.
 *
 * ## TWO OPT-INS CAN NOW SIT ON ONE LINE, AND NOTHING SAYS WHICH WINS
 *
 * A Material BOM line can carry BOTH of these, and each was designed alone:
 *
 *   - PANELS (0436) — the Combination sheet. Front body 25m, sleeves 12m,
 *     collar 8m, summed by `colourSplits` into a rate per garment.
 *     0436: *"a line that enters component rows here takes its ratio from them
 *     instead."*
 *   - A SLICE OVERRIDE (0442) — a figure typed against one (combo, size,
 *     country) cell, because an XXL seam is longer than an XS one.
 *     0442: the override replaces the line's figures, per FIELD.
 *
 * Both documents say "the line's ratio, replaced". Together they are two rival
 * answers to one question, and by the time this is called `consumptionFor` has
 * already collapsed the override chain into `resolved` — so this is the only
 * place the collision can be settled.
 *
 * ## SETTLED: THE OVERRIDE WINS (client 2026-08-25)
 *
 * Strict precedence, in the client's own order:
 *
 *     Tier 1  manual slice override
 *     Tier 2  combination / panel rate
 *     Tier 3  the line's standard bulk default
 *
 * **This REVERSES the "panels win" that stood here provisionally**, so a reader
 * who finds that rule quoted elsewhere is holding something this supersedes.
 *
 * THIS IS A TRADE RULE AND THE ENGINE COULD NOT DERIVE IT. Three candidates were
 * live and the doc that recorded them is worth keeping straight, because two of
 * them were rejected rather than never considered:
 *
 *   - **replace the construction outright — CHOSEN.** The override supplies the
 *     ratio and the panel rate stands down.
 *   - *scale every seam* — rejected. An override would have multiplied the panel
 *     rate rather than replacing it.
 *   - *refuse as a data-entry conflict* — rejected, and it was this module's own
 *     instinct: the house rule is to refuse rather than emit a plausible number.
 *
 * The client's reason is about the planner, not the arithmetic: overrides are
 * how an exceptional floor circumstance gets entered — five extra high-contrast
 * zippers on one size curve because the sewing risk is higher there, or test
 * pieces for a quality gate — and an engine that overwrites an explicit manual
 * figure leaves the planner fighting it during high-velocity data entry.
 *
 * ## THE RATIO ONLY. THE PANEL SPLIT SURVIVES INTACT
 *
 * "Replace the construction" is about the NUMBER, and the code makes that
 * separation structural rather than a matter of care. Panels do two jobs, and
 * this function is only in the second:
 *
 *   - `colourSplits` divides the line into one row per TRIM COLOUR. That runs in
 *     the caller, before this is reached, and its result feeds the row's
 *     `item_color_id`, `lineQuantityByColour`'s per-cone MOQ grouping, the PO
 *     ceiling and the grey→DC→dyed path (0445-0448). Nothing here can reach any
 *     of it.
 *   - this returns `{ no_of_items, per_pieces }` and nothing else. It cannot
 *     remove a row, merge two colours, or change what is bought — only how much.
 *
 * So an override on a two-colour line still produces two rows — and gets the
 * SAME rate on each, which is the second half of the ruling.
 *
 * ## SAME RATE EVERY COLOUR, AND THE MULTIPLICATION WAS CHOSEN
 *
 * An override has no colour axis (`sliceKey` is combo/size/country/combination/
 * style), so one cannot say "navy 3, red 1". The same overridden rate therefore
 * reaches every trim colour and the line's total multiplies by the colour count.
 * This was raised as an open consequence and PUT TO THE CLIENT WITH THE
 * MULTIPLICATION VISIBLE (2026-08-25), against their worked example: a 2/pc line
 * over WHITE 300 / NAVY 200 with 4/pc typed once gives 1,200 + 800 = 2,000, one
 * figure moving both colours. They chose it.
 *
 * The reading that won is **"this line's RATE is wrong, fix it"**, not "this
 * COLOUR needs more". Two alternatives lost and are named so the argument is not
 * had again: a PER-COLOUR override was rejected as a schema and UI change rather
 * than an arithmetic one (a new axis, the unique index, new grid cells), and
 * REFUSING on multi-colour lines was rejected because it blocks a planner with a
 * legitimate whole-line correction. Both are pinned negatively by vectors — the
 * rate is not apportioned between colours and not scaled against the panel.
 *
 * ## NOTHING EXERCISES THIS RULE TODAY, AND THAT IS MEASURED (2026-08-25)
 *
 * The rule above is implemented and correct; it currently changes no number,
 * because the collision it settles cannot presently occur. Do not read a green
 * suite as evidence that a live BOM has been re-planned.
 *
 * **0463 retired the 0436 panel store**: the screen sends `components: []` on
 * every line as an instruction to keep none (mba-master-screen.tsx, "THE 0436
 * COMPONENT STORE IS RETIRED (0463) and this is what empties it"), the table
 * holds 0 rows, and the per-panel editor that filled it was replaced by the
 * Combination popup — which writes to the SLICE store, keyed on `combination`
 * since 0463.
 *
 * Two consequences:
 *
 *  - **On the server this function is unreachable.** `requirementRows` builds
 *    its splits from `line.components`, which is always empty, so `colourSplits`
 *    returns `[]`, `rowSplits` is `[null]` and the panel branch never runs. The
 *    tier-1-over-tier-2 rule therefore governs nothing on the path that STORES a
 *    requirement until a panel store feeds it again.
 *  - **On the screen the surviving caller was not passing panels.** It
 *    synthesised the list from slice rows carrying a combination name, one entry
 *    per (name x production slice), so `colourSplits` summed a part's rate once
 *    per colourway. Measured end to end against these functions on a two-part,
 *    two-colour line: the screen totalled 8,000, the server stored 1,000, and the
 *    honest figure is 2,000. That path is being removed.
 *
 * The ruling is implemented here anyway, and deliberately: the rule belongs
 * where the collision is settled, not in whichever caller happens to revive
 * panels. Reviving one is then a caller change with the arithmetic already
 * decided and pinned by vectors.
 *
 * A LINE WITH NO OVERRIDE ON THIS SLICE IS NOT THE AMBIGUOUS CASE. There
 * `resolved` is the line's own figures and the panels are the only ratio typed,
 * so the panel rate stands — which is why the guard below is a comparison
 * against the line, not a truthiness test. A truthiness test would call every
 * inheriting slice an override and hand tier 1 to a figure nobody typed.
 */
export function panelConsumption(
  /** The line's figures with every slice override already composed in, per
   *  field (`consumptionFor`). */
  resolved: { no_of_items: number | null; per_pieces: number | null },
  /** The line's OWN figures, before any override — what `resolved` is compared
   *  against to tell "the operator typed something here" from "it inherited". */
  line: { no_of_items: number | null; per_pieces: number | null },
  /** This colour's panel rate: items per ONE piece, `per_pieces` always 1. */
  split: ColourSplit,
): { no_of_items: number | null; per_pieces: number | null } {
  const overridden =
    num(resolved.no_of_items) !== num(line.no_of_items) ||
    num(resolved.per_pieces) !== num(line.per_pieces);

  if (!overridden) {
    // TIER 2. Panels are the only ratio anyone typed, so they supply it.
    return { no_of_items: split.no_of_items, per_pieces: split.per_pieces };
  }

  /*
   * TIER 1 — the manual override, and the panel rate stands down (client
   * 2026-08-25). `split` is deliberately unread from here on.
   *
   * `resolved` RATHER THAN THE RAW OVERRIDE, and the difference is the whole
   * reason this takes a composed value: `consumptionFor` has already resolved
   * the chain PER FIELD, so an operator who typed only `no_of_items` against XXL
   * gets their figure over the line's own `per_pieces` — "more zippers, same
   * per-piece". Reading an override row directly here would hand back a null
   * `per_pieces` and refuse the slice, which is the failure that composition
   * exists to avoid.
   *
   * IT IS NOT DIVIDED BY, SCALED AGAINST OR BLENDED WITH `split`. "Scale every
   * seam" was a live candidate and was rejected; anything that multiplies the
   * two is that rejected rule arriving by the back door.
   */
  return { no_of_items: resolved.no_of_items, per_pieces: resolved.per_pieces };
}


const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/**
 * A colourway's comparison form. EXPORTED since the composer
 * (`lib/orders/bom-explosion/compose.ts`) has to match assort rows to a slice by
 * combo, and a second `trim().toUpperCase()` written there would be a second
 * definition of what "the same colourway" means — the exact drift AGENTS.md
 * records under Nominated vendors, where two spellings compiled, ran and matched
 * nothing. `styleKey` is shared from its own module for the same reason.
 */
export const comboKey = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/** Joins the two halves of a colour key. A control character, so a style or
 *  combo containing the separator cannot forge another pair's key. */
/**
 * The separator inside a composite slice key.
 *
 * EXPORTED SINCE 0449, because the screen groups a size child under its parent
 * by testing `key.startsWith(parent.key + SEP)` — `expandBySize` mints the child
 * that way on purpose, so the grouping is a string test rather than a second
 * explosion. A screen hard-coding its own separator would be a second definition
 * of what a key IS.
 *
 * NUL, so it cannot occur in a combo name, a style ref or a uuid.
 */
export const SLICE_SEP = "\u0000";
const SEP = SLICE_SEP;
const pairKey = (style: string, combo: string) => `${style}${SEP}${combo}`;

/**
 * Normalise a stored basis, refusing anything unrecognised.
 *
 * EMPTY-AND-EXPLAIN, NEVER A FALLBACK TO 'order'. A silent fallback makes the
 * Attribute advisory and the operator never learns it needs filling in — the
 * lesson the nominated-vendor rule records twice.
 */
export function basisOf(v: string | null | undefined): RequirementBasis | Refusal {
  const k = (v ?? "").trim().toLowerCase();
  return (REQUIREMENT_BASES as readonly string[]).includes(k)
    ? (k as RequirementBasis)
    : { refused: "Choose how this material splits" };
}

// ---------------------------------------------------------------------------
// Apportionment
// ---------------------------------------------------------------------------

/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * Largest remainder: floor every share, then hand the leftover pieces to the
 * largest fractional parts, ties going to the earlier size so the result is
 * stable across renders.
 *
 * WHY NOT CEIL EACH SHARE, which is what every other rounding in this feature
 * does: ceiling per size inflates the total by up to one piece per size, and
 * this number is the ceiling a quantity controller enforces. A control that
 * quietly raises its own limit is not a control. The upward rounding that
 * matters has already happened — in `excessQty` and `rejectionFor`, on the
 * target being split here.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const w = weights.map((x) => Math.max(num(x) ?? 0, 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return w.map(() => 0);

  const exact = w.map((x) => (total * x) / sum);
  const base = exact.map((x) => Math.floor(x));
  let left = Math.round(total - base.reduce((a, b) => a + b, 0));

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1;
  return base;
}

// ---------------------------------------------------------------------------
// The slices
// ---------------------------------------------------------------------------

type Target = { style: string; combo: string; qty: number };

/**
 * WHICH QUANTITY A BOM PLANS AGAINST. The client has taken three positions on
 * this and all three are named here, because the next reader will otherwise
 * read the current one as the only one there has ever been.
 *
 *   0418 · 2026-08-12   qty + excess + approval + rejection   the full target
 *   2026-08-20          the entered quantity alone
 *   2026-08-21          qty + excess + approval               rejection OUT
 *
 * `entered_only` is kept live rather than deleted: **Fabric BOM still uses it**
 * (see `fabricSlices`), and it is what the 08-20 instruction asked for.
 */
export type BaseQuantityRule = "entered_only" | "po_excess_approval" | "full_target";

/**
 * The rule a MATERIAL BOM plans against, in one place.
 *
 * Changing the client's mind about this is changing this one literal — which is
 * the point of it being a named constant rather than an `if` somewhere in
 * `targetsOf`. It has moved twice in two days; assume it will move again.
 */
export const MATERIAL_BASE_QUANTITY: BaseQuantityRule = "po_excess_approval";

/**
 * What a SEWING or PACKING accessory is bought against (client 2026-08-21).
 *
 * ## Why the rejection allowance is excluded, in the client's own terms
 *
 * A garment rejected during panel processing or printing has already consumed
 * its fabric and has NOT yet consumed its buttons. Buying trims against the
 * rejection buffer therefore over-orders every hangtag and carton on the order.
 * That is the "vital distinction" the client draws between this and fabric
 * planning, and it is why `fabricSlices` passes a different rule rather than
 * this one being changed globally.
 *
 * ## Why it is a rule ARGUMENT and not an edit to `targetsOf`
 *
 * `productionSlices` is shared with Fabric BOM. Editing the arithmetic in place
 * moves both, silently — `check-fabric-bom.mts:387` asserts "600 entered is
 * planned as 600, not 660" and is the vector that catches it.
 *
 * ## Why this is not a second copy of the arithmetic
 *
 * `excessQty` is imported, never reimplemented. It rounds UP and is applied PER
 * APPROVAL ROW, which is the client's own rule with their own worked example in
 * its header (500 at 5% reads as 25, not 24). That is why this takes a ROW and
 * is called before `targetsOf` folds the rows together — fold first and the
 * percentage would round once where the client rounds per line.
 *
 * ## The 08-20 reversal was aimed at a data-entry mistake, not at this formula
 *
 * The order that triggered it read 5,552 against a 5,000 PO — 252 excess and
 * 300 approval, and the 300 was `20` filled down across fifteen size rows. Put
 * back to the client against those figures on 2026-08-21, they confirmed the
 * formula and identified the 20 as an order-level number. So the fix for that
 * order is its data, not this function.
 */
export function materialTarget(a: ApprovalRow, excessPct: number): number {
  const qty = num(a.qty) ?? 0;
  if (qty <= 0) return 0;
  return qty + excessQty(qty, excessPct) + Math.max(0, num(a.approval_qty) ?? 0);
}

/**
 * What FABRIC is planned against — `materialTarget` plus the rejection allowance.
 *
 * ## THE ONE LINE OF DIFFERENCE, AND WHY IT IS A DIFFERENT FUNCTION
 *
 * `materialTarget`'s header records the client's distinction in their own terms:
 * a garment rejected during panel processing or printing has already consumed
 * its FABRIC and has NOT yet consumed its buttons. So the rejection buffer over-
 * orders every hangtag and carton on the order, and under-orders cloth by
 * exactly the same reasoning. Two rules, stated twice, rather than one rule with
 * a flag inside it — because the pair is the point and a reader has to be able
 * to see both halves at once.
 *
 * ## IT REFUSES WHERE THE ALLOWANCE IS UNANSWERABLE
 *
 * `productionTarget` is imported, never reimplemented — it is the Approval Qty
 * tab's own function, and sharing it is what stops the tab and the BOM
 * disagreeing about one order. It answers `{ qty: null, reason:
 * "projection-gap" }` when a Garment Rejection Rule was NAMED on the order and
 * the ladder has no tier covering this quantity. Its own header says why that is
 * a refusal rather than a zero:
 *
 *     a rule that was chosen and then failed to match any tier produces a
 *     plausible total with no dash anywhere near it — the operator has no way to
 *     learn that the defect buffer they configured contributed nothing.
 *
 * On the Approval Qty tab a dash in the column beside it says so. Nothing sits
 * beside this number: it is multiplied by a consumption and becomes the quantity
 * of cloth a purchase order is written for. So it refuses, and names the
 * colourway.
 *
 * ## THE BLANK-ROW GUARD IS LOAD-BEARING, not copied for symmetry
 *
 * `qty <= 0` short-circuits BEFORE `productionTarget` is called, and it has to.
 * A freshly seeded Approval Qty grid is full of zero rows; `rejectionFor(0,
 * tiers)` matches no tier, so without this guard an order with a rejection rule
 * and one blank row would refuse the whole explosion and name a colourway the
 * operator has not typed anything into yet.
 */
export function fullTarget(a: ApprovalRow, order: OrderProductionInput): number | Refusal {
  const qty = num(a.qty) ?? 0;
  if (qty <= 0) return 0;

  const t = productionTarget(
    { qty, approvalQty: Math.max(0, num(a.approval_qty) ?? 0) },
    order.excessPct,
    order.tiers,
    order.rejectionRuleChosen,
  );
  if (t.qty == null) {
    return {
      refused: `${a.combo || "(blank)"}: the Garment Rejection Rule has no tier covering ${qty} pcs — fix the rule or clear it on the order`,
    };
  }
  return t.qty;
}

/** Every approval line resolved to a production target, or the first refusal. */
/**
 * THE QUANTITY THE MATERIAL BOM PLANS AGAINST — the entered one, and nothing
 * added to it.
 *
 * ## THIS REVERSES 0418, DELIBERATELY, AND IT IS EASY TO PUT BACK
 *
 * Until 2026-08-20 this multiplied `productionTarget()` — order qty + the
 * buyer's excess + approval pieces + the rejection allowance. That is the
 * client's own "SKU Quantity", it is what `doc/orders-six-step.md` describes,
 * and it is the figure the whole rejection-rule feature was built to feed.
 *
 * The client asked for it to follow the ENTERED quantity only (2026-08-20,
 * repeated after the trade-off was put to them). The trigger was an order
 * carrying 5,000 PO against 5,552 target: 252 of excess and 300 of approval
 * pieces, of which the 300 was almost certainly a "fill down" entered per size
 * rather than per order. **The instruction stands whatever the cause**, and this
 * is the one place it has to change — the screen and the server action both
 * come through here, so they cannot disagree.
 *
 * ## WHAT THIS COSTS, AND WHY IT IS ALL IN ONE FUNCTION
 *
 *  - **Trims are now bought for the pieces ordered, not the pieces cut.** An
 *    order that makes 5,552 garments to ship 5,000 will be 552 buttons short.
 *    That gap is exactly what the excess and the rejection rule existed to
 *    close, so the client is choosing to close it some other way — the material
 *    Excess % on each BOM line is now the ONLY buffer left, and it is per line
 *    and typed by hand.
 *  - **Stored requirements move.** Every saved BOM recomputes smaller on its
 *    next save, and `basisFingerprint` below hashes the same quantity this
 *    returns, so existing documents flag `Recalculate` rather than drifting
 *    silently. That is the intended behaviour of the hash, not a side effect.
 *  - **The PO ceiling drops with it** (`lib/purchase/bom-ceiling.ts`), which
 *    tightens a control rather than loosening one — the safe direction.
 *
 * Restoring it is one call: swap the line below back to `productionTarget(...)`
 * and put the rejection-gap refusal back with it. `approval-qty.ts` is untouched
 * and the Approval Qty tab still computes and shows the full target, so nothing
 * had to be deleted to do this.
 */
function targetsOf(
  order: OrderProductionInput,
  rule: BaseQuantityRule = MATERIAL_BASE_QUANTITY,
): Target[] | Refusal {
  if (order.approvals.length === 0) {
    return { refused: "No production quantity yet — fill Approval Qty on the order" };
  }

  /*
   * ONE TARGET PER (STYLE, COMBO), FOLDED FROM HOWEVER MANY ROWS IT IS TYPED ON.
   *
   * 0435 made Approval Qty a row per SIZE, so a three-colour order over five
   * sizes arrives here as FIFTEEN rows, not three. This used to `push` one
   * target per ROW, and the damage was invisible in every existing vector
   * because the file's assertions all SUM: five slices of 100 total exactly as
   * one of 500.
   *
   * What broke is IDENTITY. `productionSlices`' colour branch maps targets 1:1,
   * so it emitted five WHITE slices sharing one key, and the combination branch
   * pushed `${pair}${SEP}${sizeId}` once per target — the same key five times.
   * `uq_mba_req_slice (item_line_id, style_ref_no, combo, size_id) nulls not
   * distinct` (0418:259) then refuses the second insert, so a colour-wise BOM
   * against any real order fails to save. `order`, `style` and `size` were
   * correct only by accident: all three re-collapse the rows themselves.
   *
   * THE FOLD SUMS PER-ROW VALUES, and that ordering is load-bearing rather than
   * incidental — the buyer's excess is applied per LINE (`excessQty`'s own
   * header records the client's worked example: 500 at 5% reads as 25, not 24),
   * so anything derived from a row must be derived BEFORE the rows are summed.
   * Folding first and deriving after would round once where the client rounds
   * per line.
   *
   * The size is deliberately NOT part of the key. `size` and `combination`
   * apportion the colour total across the assort curve, which is the client's
   * ratio; reading the approval rows' own `size_id` instead would be a
   * different (and arguably better) answer, and a change to a number the
   * operator already signed off. Left alone on purpose.
   */
  const byColour = new Map<string, Target>();
  let entered = 0;
  for (const a of order.approvals) {
    const style = styleKey(a.style_ref_no);
    const combo = comboKey(a.combo);
    const key = pairKey(style, combo);
    /* PER ROW, BEFORE THE FOLD — `materialTarget`'s header says why the order of
       these two operations is load-bearing.

       THREE RULES, AND THE SWITCH IS EXHAUSTIVE ON PURPOSE. A `default` branch
       falling back to the entered quantity would make a rule added later plan
       silently short on the largest purchase in the order; naming all three
       means the next member is a type error at this line, which is where the
       decision has to be made anyway. */
    let qty: number;
    if (rule === "full_target") {
      const t = fullTarget(a, order);
      // A REFUSAL POISONS THE WHOLE EXPLOSION, as everywhere else in this file:
      // returning the rows that answered gives a smaller total that reads correct.
      if (isRefusal(t)) return t;
      qty = t;
    } else if (rule === "po_excess_approval") {
      qty = materialTarget(a, order.excessPct);
    } else {
      qty = num(a.qty) ?? 0;
    }
    entered += num(a.qty) ?? 0;
    const prev = byColour.get(key);
    if (prev) prev.qty += qty;
    else byColour.set(key, { style, combo, qty });
  }
  const out = [...byColour.values()];

  // Rows exist but every one is blank. Distinct from "no rows at all", and it is
  // the state a freshly seeded Approval Qty grid is in — so it must say so
  // rather than hand back a requirement of 0 on a real order.
  //
  // MEASURED ON THE ENTERED QUANTITY, NOT ON THE TARGET, and that distinction
  // arrived with the 08-21 base: a grid holding nothing but sample pieces now
  // produces a non-zero target, so testing the target would let a BOM compute
  // against an order nobody has entered a quantity for. The refusal names the
  // quantity, so the quantity is what it has to test.
  if (entered <= 0) {
    return { refused: "Approval Qty rows have no quantity" };
  }
  return out;
}

/**
 * The rows a material's requirement explodes into.
 *
 * ## Size is a RATIO, not a list of absolute quantities
 *
 * `garment_order_amendment_assort_lines` hangs off
 * `garment_order_amendment_quantities`, which breaks an order down by COUNTRY
 * and CONSIGNEE. A partially-entered assortment is therefore normal, not an
 * error — an order shipping to two countries with one entered is a perfectly
 * ordinary mid-entry state. Reading those numbers as absolute pieces would
 * silently buy material for half the order.
 *
 * So the assortment supplies PROPORTIONS, and each combo's own production target
 * is apportioned across them. That keeps the invariant the vectors assert: the
 * size rows sum to the colour rows sum to the order row.
 *
 * Apportioning per COMBO rather than once over the whole order matters — two
 * colourways rarely carry the same size curve, and a global ratio would move
 * pieces between them.
 */
export function productionSlices(
  basis: RequirementBasis,
  order: OrderProductionInput,
  /**
   * DEFAULTS TO THE MATERIAL RULE, and Fabric BOM overrides it explicitly.
   * Defaulting the other way would make every accessory line quietly wrong the
   * day someone forgot to pass it, which is the direction that costs money.
   */
  rule: BaseQuantityRule = MATERIAL_BASE_QUANTITY,
  /**
   * WHICH PRIMARY ROWS SPLIT THEMSELVES INTO SIZES (0449, legacy's per-row
   * "Size wise" tick).
   *
   * A PREDICATE, NOT A TABLE READ. The flags live in the override store, and a
   * pure function that reached into it would stop being testable from a fixture
   * — the caller answers instead. Absent means no row splits, which is what
   * every caller that predates the tick means.
   *
   * THE TICK IS NOT NEW ARITHMETIC. `Order + every row ticked` reproduces the old
   * `size` basis exactly, and `Colour + every row ticked` reproduces
   * `combination` exactly — asserted as an equivalence in
   * `check-bom-requirement.mts`, which is the strongest statement available: if
   * the two ever diverge, one of them is wrong.
   */
  sizeWise?: (slice: ProductionSlice) => boolean,
): ProductionSlice[] | Refusal {
  const primary = primarySlices(basis, order, rule);
  if (isRefusal(primary) || !sizeWise) return primary;

  /*
   * THE TICK ADDS THE SIZE AXIS, SO ADDING IT TWICE MUST DO NOTHING.
   *
   * `size` and `combination` are already one row PER SIZE. Splitting those rows
   * by size again crossed the axis with itself: a `combination` line with a
   * ticked row produced "WHITE · S · S", "WHITE · S · M", "WHITE · M · S",
   * "WHITE · M · M" — a size against a size, with the colourway's quantity
   * divided across the four.
   *
   * IT DID NOT FAIL QUIETLY, IT FAILED UNREADABLY. Every pair of those rows is
   * identical on (style_ref_no, combo, size_id, country_id), so
   * `uq_mba_req_slice` refuses the second insert and the SAVE dies with a
   * constraint name — on a screen that has already drawn the doubled rows.
   *
   * Reachable because the two bases did not leave the system when they left the
   * MENU on 2026-08-21: `OFFERED_REQUIREMENT_BASES` is four, but `size` and
   * `combination` remain live values in the CHECK constraint and are documented
   * to keep resolving for rows stored under them, while the tick is a per-slice
   * flag stored independently of the basis.
   *
   * The idempotence is the whole reason the grain is modelled as a SET
   * (`lib/orders/bom-explosion/exploder.ts`): `canonicalAxes` de-duplicates, so
   * `{style_ref, colour, size}` + size is itself and this cannot be expressed.
   * Stated here as well because `productionSlices` is the function that runs.
   */
  if (SIZE_IS_ALREADY_THE_GRAIN.has(basis)) return primary;

  const targets = targetsOf(order, rule);
  if (isRefusal(targets)) return targets;

  const out: ProductionSlice[] = [];
  for (const sl of primary) {
    if (!sizeWise(sl)) {
      out.push(sl);
      continue;
    }
    const kids = expandBySize(sl, order, targets);
    // A REFUSAL POISONS THE WHOLE EXPLOSION, as everywhere else in this file:
    // emitting the rows that answered gives a smaller total that reads correct.
    if (isRefusal(kids)) return kids;
    out.push(...kids);
  }
  return out;
}

/**
 * One primary row, split into the sizes of the combos it covers (0449).
 *
 * ## THE APPORTIONMENT IS PER COMBO, THEN SUMMED — never the other way round
 *
 * That is 0420's rule and it is why this is not two lines of code: two colourways
 * rarely share a size curve, so blending them before apportioning moves pieces
 * between sizes. A row that spans several combos (Order-wise, Country-wise)
 * therefore divides ITS OWN quantity across those combos first, in proportion to
 * what each holds, and only then walks each combo's curve.
 *
 * For a Country row that scaling matters: its quantity is already an apportioned
 * share of the order, not the sum of the combos it covers.
 *
 * ## THE KEY EXTENDS THE PARENT'S, WHICH IS WHAT MAKES THE EQUIVALENCE EXACT
 *
 * `${parent.key}${SEP}${sizeId}` resolves to `${pairKey}${SEP}${sizeId}` under a
 * colour row and `${SEP}${sizeId}` under an order row — byte-identical to the
 * keys `combination` and `size` already mint. So the tick reaches the same rows
 * by the same names, and `uq_mba_req_slice` sees no difference.
 */
function expandBySize(
  sl: ProductionSlice,
  order: OrderProductionInput,
  targets: readonly Target[],
): ProductionSlice[] | Refusal {
  if (order.assortSizes.length === 0) {
    return { refused: "Size break-up not entered on Quantities ▸ Assort" };
  }

  const wantStyle = sl.style_ref_no == null ? null : styleKey(sl.style_ref_no);
  const wantCombo = sl.combo == null ? null : comboKey(sl.combo);
  const mine = targets.filter(
    (t) =>
      (wantStyle === null || t.style === wantStyle) &&
      (wantCombo === null || t.combo === wantCombo),
  );
  if (mine.length === 0) {
    return { refused: `Size break-up not entered on Quantities ▸ Assort for ${sl.label}` };
  }

  // This row's own quantity, divided across the combos it covers. Largest
  // remainder, so the parts sum to exactly the row.
  const comboShares = apportion(
    sl.qty,
    mine.map((t) => t.qty),
  );

  const bySizeAcross = new Map<string, number>();
  const rowsOut: ProductionSlice[] = [];

  for (let i = 0; i < mine.length; i++) {
    const t = mine[i];
    const rows = order.assortSizes.filter(
      (r) => styleKey(r.style_ref_no) === t.style && comboKey(r.combo) === t.combo,
    );
    if (rows.length === 0) {
      return {
        refused: `Size break-up not entered on Quantities ▸ Assort for ${t.combo || sl.label}`,
      };
    }
    // Collapse repeats first: one combo can appear on several assort lines (one
    // per carton set), and the ratio is the sum across them.
    const bySize = new Map<string, number>();
    for (const r of rows) {
      if (!r.size_id) continue;
      bySize.set(r.size_id, (bySize.get(r.size_id) ?? 0) + (num(r.qty) ?? 0));
    }
    const sizes = [...bySize.entries()];
    if (sizes.length === 0 || sizes.every(([, q]) => q <= 0)) {
      return { refused: `Size break-up has no quantities for ${t.combo || sl.label}` };
    }

    const shares = apportion(
      comboShares[i],
      sizes.map(([, q]) => q),
    );

    sizes.forEach(([sizeId], j) => {
      if (wantCombo !== null) {
        // A COLOUR ROW KEEPS ITS COLOUR, so the label reads "WHITE · S" exactly
        // as `combination` mints it.
        rowsOut.push({
          key: `${sl.key}${SEP}${sizeId}`,
          label: `${sl.label} · ${order.sizeNames?.[sizeId] ?? sizeId}`,
          qty: shares[j],
          style_ref_no: sl.style_ref_no,
          combo: sl.combo,
          size_id: sizeId,
          country_id: sl.country_id ?? null,
        });
      } else {
        // A ROW WITH NO COLOUR AXIS COLLAPSES IT — "how many Mediums?" is one
        // number, which is `size`'s whole argument (0420).
        bySizeAcross.set(sizeId, (bySizeAcross.get(sizeId) ?? 0) + shares[j]);
      }
    });
  }

  if (wantCombo !== null) return rowsOut;

  return [...bySizeAcross.entries()].map(([sizeId, qty]) => ({
    key: `${sl.key}${SEP}${sizeId}`,
    label: order.sizeNames?.[sizeId] ?? sizeId,
    qty,
    style_ref_no: sl.style_ref_no,
    combo: null,
    size_id: sizeId,
    country_id: sl.country_id ?? null,
  }));
}

/** The rows a basis produces before any per-row size tick is applied. */
function primarySlices(
  basis: RequirementBasis,
  order: OrderProductionInput,
  rule: BaseQuantityRule,
): ProductionSlice[] | Refusal {
  const targets = targetsOf(order, rule);
  if (isRefusal(targets)) return targets;

  if (basis === "order") {
    return [
      {
        key: "",
        label: "Whole order",
        qty: targets.reduce((a, t) => a + t.qty, 0),
        style_ref_no: null,
        combo: null,
        size_id: null,
      },
    ];
  }

  /*
   * STYLE-WISE SPLITS BEFORE THE COLOUR CHECKS, and that placement is the point.
   *
   * A style total is the sum of its approval rows — it does not need the Combos
   * tab and the Approval Qty tab to name the same colourways, so it must not be
   * refused when they disagree. Putting this branch below would inherit three
   * refusals that have nothing to do with it, and a BOM planned per style would
   * stop over a colour rename it never reads.
   *
   * Keyed on the style alone; `combo` and `size_id` stay null because a
   * style-wise line is bought once for the style whatever colour it is made in.
   */
  if (basis === "style") {
    const byStyle = new Map<string, number>();
    for (const t of targets) byStyle.set(t.style, (byStyle.get(t.style) ?? 0) + t.qty);
    return [...byStyle].map(([style, qty]) => ({
      key: style,
      // A blank ref is a real state — the Styles tab's Ref No is free text — and
      // it must be NAMED rather than shown as an empty row.
      label: style || "(no style ref)",
      qty,
      style_ref_no: style || null,
      combo: null,
      size_id: null,
    }));
  }

  /*
   * COUNTRY-WISE — the destination axis (client 2026-08-21).
   *
   * PLACED HERE, ABOVE THE COMBO CHECKS, for the same reason `style` is: a
   * destination total does not need the Combos tab and the Approval Qty tab to
   * name the same colourways, so it must not inherit three refusals that have
   * nothing to do with it. A BOM split by country would otherwise stop over a
   * colour rename it never reads.
   *
   * ## THE TARGET IS NOT KEYED BY COUNTRY, SO THIS APPORTIONS
   *
   * Approval Qty is (style, combo) and knows nothing about destinations; the
   * Quantities tree is where a country lives. So the order total is divided
   * across the destinations by their own weights, through the SAME `apportion`
   * every other split uses — largest remainder, so the parts sum to exactly the
   * total and the cross-basis invariant survives. Anything else would let
   * country-wise and order-wise disagree about one order.
   *
   * ## A DESTINATION WITH NO QUANTITY POISONS THE EXPLOSION
   *
   * Two rows summing short read exactly like a correct answer — the partial
   * explosion this module's header warns about. So an unquantified destination
   * is NAMED and the whole split stops, rather than being quietly dropped.
   */
  if (basis === "country") {
    if (order.assortSizes.length === 0) {
      return { refused: "No destinations on Quantities to split by" };
    }

    // Grouped in FIRST-APPEARANCE order, so the rows read down the screen in the
    // order the operator entered their destinations.
    const byCountry = new Map<string, number>();
    for (const r of order.assortSizes) {
      const id = r.country_id ?? "";
      byCountry.set(id, (byCountry.get(id) ?? 0) + (num(r.qty) ?? 0));
    }

    const nameOf = (id: string) =>
      id ? (order.countryNames?.[id] ?? id) : "(no destination)";

    for (const [id, w] of byCountry) {
      if (w <= 0) return { refused: `${nameOf(id)} has no quantity on Quantities` };
    }

    const total = targets.reduce((a, t) => a + t.qty, 0);
    const ids = [...byCountry.keys()];
    const shares = apportion(
      total,
      ids.map((id) => byCountry.get(id) ?? 0),
    );

    // The STYLE is kept only where the order has one, exactly as size-wise does:
    // a row keyed to a style the operator did not ask to split by would imply a
    // division that was never requested.
    const onlyStyle = new Set(targets.map((t) => t.style)).size > 1 ? null : (targets[0]?.style || null);

    return ids.map((id, i) => ({
      key: `${SEP}${SEP}${id}`,
      label: nameOf(id),
      qty: shares[i],
      style_ref_no: onlyStyle,
      combo: null,
      size_id: null,
      country_id: id || null,
    }));
  }

  // Both remaining bases split by colour, so both need the two tabs to agree.
  const declared = new Set(
    order.combos.map((c) => pairKey(styleKey(c.style_ref_no), comboKey(c.combo))),
  );
  if (declared.size === 0) return { refused: "This order has no combos to split by" };

  const targeted = new Set(targets.map((t) => pairKey(t.style, t.combo)));

  // A colour the order DECLARES but does not quantify. Emitting the others
  // yields a smaller total that reads as correct, so the whole explosion stops
  // and names the colour.
  for (const c of order.combos) {
    if (!targeted.has(pairKey(styleKey(c.style_ref_no), comboKey(c.combo)))) {
      return { refused: `Combo ${c.combo ?? "(blank)"} has no quantity on Approval Qty` };
    }
  }
  // And the reverse: a quantity for a colour the Combos tab no longer lists,
  // which is what a rename leaves behind. The tabs disagree; picking either
  // silently is the failure.
  for (const t of targets) {
    if (!declared.has(pairKey(t.style, t.combo))) {
      return { refused: `Combo ${t.combo || "(blank)"} is not on the Combos tab` };
    }
  }

  const multiStyle = new Set(targets.map((t) => t.style)).size > 1;
  const labelFor = (t: Target) =>
    multiStyle ? `${t.style} · ${t.combo || "(blank)"}` : t.combo || "(blank)";

  if (basis === "colour") {
    return targets.map((t) => ({
      key: pairKey(t.style, t.combo),
      label: labelFor(t),
      qty: t.qty,
      style_ref_no: t.style || null,
      combo: t.combo || null,
      size_id: null,
    }));
  }

  // ---- size / combination ----
  //
  // Both walk the same apportionment and differ only in whether the colour
  // survives into the slice. Sharing the walk is deliberate: two copies would be
  // two places for the size curve to be read differently, and "every basis sums
  // to the same total" is the invariant the vectors lean on hardest.
  if (order.assortSizes.length === 0) {
    return { refused: "Size break-up not entered on Quantities ▸ Assort" };
  }

  const matrix: ProductionSlice[] = [];
  for (const t of targets) {
    const rows = order.assortSizes.filter(
      (r) => styleKey(r.style_ref_no) === t.style && comboKey(r.combo) === t.combo,
    );
    if (rows.length === 0) {
      return {
        refused: `Size break-up not entered on Quantities ▸ Assort for ${labelFor(t)}`,
      };
    }

    // Collapse repeats first: one combo can appear on several assort lines (one
    // per carton set), and the ratio is the sum across them.
    const bySize = new Map<string, number>();
    for (const r of rows) {
      if (!r.size_id) continue;
      bySize.set(r.size_id, (bySize.get(r.size_id) ?? 0) + (num(r.qty) ?? 0));
    }
    const sizes = [...bySize.entries()];
    if (sizes.length === 0 || sizes.every(([, q]) => q <= 0)) {
      return { refused: `Size break-up has no quantities for ${labelFor(t)}` };
    }

    const shares = apportion(
      t.qty,
      sizes.map(([, q]) => q),
    );
    sizes.forEach(([sizeId], i) => {
      const name = order.sizeNames?.[sizeId] ?? sizeId;
      matrix.push({
        key: `${pairKey(t.style, t.combo)}${SEP}${sizeId}`,
        label: multiStyle ? `${labelFor(t)} · ${name}` : `${t.combo || "(blank)"} · ${name}`,
        qty: shares[i],
        style_ref_no: t.style || null,
        combo: t.combo || null,
        size_id: sizeId,
      });
    });
  }

  if (basis === "combination") return matrix;

  // SIZE-WISE COLLAPSES THE COLOUR AXIS. The matrix is apportioned per combo
  // FIRST — which is what preserves each colourway's own size curve — and only
  // then summed by size, so the totals still agree with the colour and order
  // bases. Summing before apportioning would blend two different curves into one.
  //
  // The STYLE is kept only where the order has one. A size label is bought per
  // size across the whole order, and a row keyed to a style the operator did not
  // ask to split by would imply a division that was never requested.
  const bySizeAcrossCombos = new Map<string, { qty: number; label: string }>();
  for (const m of matrix) {
    const id = m.size_id as string;
    const prev = bySizeAcrossCombos.get(id);
    bySizeAcrossCombos.set(id, {
      qty: (prev?.qty ?? 0) + m.qty,
      label: order.sizeNames?.[id] ?? id,
    });
  }

  const onlyStyle = multiStyle ? null : (targets[0]?.style || null);
  return [...bySizeAcrossCombos.entries()].map(([sizeId, v]) => ({
    key: `${SEP}${sizeId}`,
    label: v.label,
    qty: v.qty,
    style_ref_no: onlyStyle,
    combo: null,
    size_id: sizeId,
  }));
}

// ---------------------------------------------------------------------------
// The requirement
// ---------------------------------------------------------------------------

/**
 * One slice's requirement, in the CONSUMPTION unit.
 *
 *     ceilToPrecision(qty x (no_of_items / per_pieces) x (1 + wastage/100), dp)
 *
 * `excess_pct` here is the BOM's own WASTAGE and multiplies the MATERIAL figure,
 * never the pieces. The order's Excess % is a different number and is already
 * inside `slice.qty`; applying a second percentage to the pieces would compound
 * two buffers invisibly. The UI labels this column "Wastage %" for that reason.
 */
function sliceRequirement(
  line: BomLineInput,
  slice: ProductionSlice,
  applied: number,
): number | Refusal {
  const items = num(line.no_of_items);
  const pieces = num(line.per_pieces);
  const wastage = num(line.excess_pct) ?? 0;

  // 0 is not "no material needed" — every grid opens on a blank row and a
  // half-filled one carries 0. Same call `styleRate` makes for a price of 0.
  if (items == null || items <= 0) return { refused: "Enter how many are used per piece" };

  // `x / 0` is Infinity in JS, not a throw, so an unguarded divisor escapes into
  // the UI as an ordinary-looking number — `conversionFactor`'s stated reason.
  if (pieces == null || pieces <= 0) return { refused: "Pieces must be more than 0" };

  // VALIDATED EVEN WHERE IT IS NOT APPLIED. `baseRequirementFor` passes
  // `applied = 0`, but a Wastage of 150 still has to refuse there — two columns
  // side by side, one answering and one refusing the same row, reads as the
  // BEFORE figure being fine and only the AFTER one being broken.
  if (wastage < 0 || wastage > 100) return { refused: "Wastage must be between 0 and 100" };

  const qty = num(slice.qty) ?? 0;
  return ceilToPrecision(
    ((qty * items) / pieces) * (1 + applied / 100),
    uomPrecision(line.decimals),
  );
}

export function requirementFor(line: BomLineInput, slice: ProductionSlice): number | Refusal {
  return sliceRequirement(line, slice, num(line.excess_pct) ?? 0);
}

/**
 * The same slice BEFORE the line's Wastage % (client 2026-08-20: "two fields not
 * one — excess will user give, and calculated is based on no of pcs and no of
 * item, with or without excess value").
 *
 * ## WHY THIS IS COMPUTED AND NOT DIVIDED BACK OUT
 *
 * Wastage is a plain multiplier, so `excessCalcQty / (1 + w/100)` looks like it
 * would do — and it is wrong for the reason every figure in this file is
 * ceilinged: `requirementFor` rounds UP to the unit's precision, so the division
 * un-rounds a number that was deliberately rounded and lands just under the
 * honest figure. On a 3-decimal unit with 3% wastage that is the difference
 * between 1,236 and 1,235.922. The BEFORE figure has to be ceilinged from its
 * own multiplication, which is what this does.
 *
 * It refuses in exactly the cases `requirementFor` refuses, including on a
 * Wastage it does not itself use — see the guard.
 */
export function baseRequirementFor(
  line: BomLineInput,
  slice: ProductionSlice,
): number | Refusal {
  return sliceRequirement(line, slice, 0);
}

/**
 * MOQ, applied to the ITEM'S TOTAL — never to a requirement row.
 *
 * THIS IS THE ONE THAT LOOKS LIKE A DETAIL AND BUYS SIX TIMES TOO MUCH. A
 * colour-wise explosion makes six rows for one material; an MOQ of 500 applied
 * per row orders 3,000 of something the order needs 100 of. The supplier's
 * minimum is a minimum per ORDER, so it is a rollup — which is also why `moq`
 * does not appear on the requirement child table at all.
 *
 * `unitKnown` says whether the quantity the MOQ is being compared against has a
 * unit: the purchase quantity where the line names a pack, the requirement
 * otherwise. With neither known, the figure "500" has no unit, and applying it
 * would be the blank-supply-type shape the nominated-vendor rule refuses — so it
 * refuses too.
 */
export function moqRollup(
  quantities: readonly (number | null)[],
  moq: number | null,
  unitKnown: boolean,
): { total: number; afterMoq: number } | Refusal {
  const known = quantities.filter((q): q is number => num(q) != null);
  if (known.length === 0) return { refused: "Nothing to total — every line refused" };
  const total = known.reduce((a, b) => a + b, 0);

  const m = num(moq);
  if (m == null || m <= 0) return { total, afterMoq: total };
  if (!unitKnown) return { refused: "Set a purchase unit before an MOQ can be applied" };
  return { total, afterMoq: Math.max(total, m) };
}

/**
 * Round a quantity UP to the next multiple of a step (0437).
 *
 * The client's case: an excess-calculated figure lands on 567 and nobody orders
 * 567 of anything, so the operator names a step — 50, 144 for a gross, 12 for a
 * dozen — and the figure becomes orderable.
 *
 * ## UP, never to nearest, and that is the same decision made everywhere here
 *
 * `rejectionFor` records it once and everything follows: *"shipping 59 when 60
 * were needed is precisely the failure this rule exists to prevent. The cost of
 * the other direction is at most one garment."* Rounding 567 DOWN to 550 buys
 * short on a number that is already the floor's requirement.
 *
 * ## A STEP OF 0 IS NOT A STEP, AND NULL IS NOT AN ERROR
 *
 * NULL / absent means the operator has not asked for rounding — the ordinary
 * case, and the state every row predating 0437 is in — so the value passes
 * through unchanged. A step that is present but <= 0 is a half-typed box, and
 * `Math.ceil(x / 0)` is Infinity in JS rather than a throw, so it would escape
 * into the purchase figure as an ordinary-looking number. `conversionFactor`
 * guards the same trap for the same reason. It passes through too: a box being
 * typed into is not a refusal, and the operator is one keystroke from a step.
 *
 * ## THE `toFixed(6)` IS LOAD-BEARING, exactly as it is in `ceilToPrecision`
 *
 * `600 / 50` is 11.999999999999998 in binary floating point for enough
 * (value, step) pairs to matter, and `Math.ceil` of that is 12 — which returns
 * 600 correctly. But `1.2 / 0.1` is 11.999999999999998 and ceils to 12, giving
 * 1.2000000000000002 back. Fixing the quotient to six places before the ceil is
 * what makes an already-round figure stay itself instead of gaining a step. The
 * comment in `ceilToPrecision` records the identical trap ("without it 150
 * becomes 150.01") and this is the second place it bites.
 */
export function roundUpTo(value: number, step: number | null | undefined): number {
  const v = num(value);
  if (v == null) return value;
  const s = num(step);
  if (s == null || s <= 0) return v;
  return Number((Math.ceil(Number((v / s).toFixed(6))) * s).toFixed(6));
}

/**
 * The whole tail of a line's quantity chain, in the ONE order the client chose.
 *
 *     Excess Calculated Qty  ->  MOQ  ->  Round To  ->  Final Quantity
 *
 * ## MOQ FIRST. THEY DO NOT COMMUTE AND THE GAP IS NOT SMALL
 *
 * A line needing 100 with an MOQ of 550 and a Round To of 500:
 *
 *     MOQ then Round  ->  max(100, 550) = 550  ->  ceil to 500s  = 1000
 *     Round then MOQ  ->  ceil to 500s  =  500  ->  max(500, 550) =  550
 *
 * Nearly double, on a rule that reads the same either way in English. The
 * client chose MOQ first (2026-08-19), and the reason survives the example:
 * the supplier's minimum is a fact about what may be bought at all, and Round
 * To is how the operator makes that figure orderable. Round first and the
 * Final Quantity stops being a multiple of the step the operator named
 * whenever the MOQ is the binding number — which defeats the column.
 *
 * ## EVERY STEP IS EXPOSED, because the operator is being asked to trust it
 *
 * This returns the intermediate figures rather than just the answer. The grid
 * shows Excess Calculated Qty and Final Quantity in separate columns with MOQ
 * and Round To typed between them, so a number that jumped from 567 to 1000 has
 * its two reasons visible on the same row. A single "Calculated Qty" cell that
 * silently absorbed both is what this replaces.
 *
 * ## REFUSES, NEVER RETURNS 0 — the rule this whole module is written to
 *
 * A refusal carries the SENTENCE the screen prints. 0 reads as "none needed",
 * the one answer a material requirement never intends, and this figure is the
 * one a purchase order is written from.
 */
export type LineQuantity = {
  /**
   * Σ of every slice BEFORE the line's Wastage % (`baseRequirementFor`) — the
   * "Calculated Qty" column (client 2026-08-20).
   *
   * EQUAL TO `excessCalcQty` WHEN THERE IS NO WASTAGE, and that is the honest
   * answer rather than a reason to hide the column: the operator is being shown
   * what the order needs and what the buffer added, and "nothing" is a real
   * value for the second. `baseQuantities` omitted means the caller did not ask
   * for the split, and it falls back to the same figure for the same reason.
   */
  calcQty: number;
  /** Σ of every slice, with the line's Wastage % already inside (`requirementFor`). */
  excessCalcQty: number;
  /**
   * THE SAME TOTAL IN THE PURCHASE UNIT, BEFORE the minimum — the hop between
   * `excessCalcQty` and `afterMoq`.
   *
   * It exists so the screen can SHOW the unit changing. Without it the ribbon
   * prints "order needs 20,000 MTR ... MOQ 12 ... final 12 CONE" and the
   * operator is left to work out that the minimum was never compared against
   * the 20,000. It is also what lets "is this MOQ binding?" be asked of two
   * figures in the same unit — asking it across units is the bug this whole
   * change closes, and a dimmed-or-not badge is exactly where it would come
   * back.
   *
   * Equal to `excessCalcQty` where the line names no pack.
   */
  purchaseQty: number;
  /**
   * After the supplier's minimum.
   *
   * ## IN THE PURCHASE UNIT WHERE THE LINE NAMES A PACK, and that is the whole
   * point of `purchaseQuantities` below
   *
   * This and `finalQty` are the PURCHASE pair; `calcQty` and `excessCalcQty`
   * above are the CONSUMPTION pair. A row therefore changes unit halfway across,
   * and it has to: 0437 titles itself "a Material BOM line can round its
   * PURCHASE figure UP", and 0451 states it outright - "a minimum and a rounding
   * step are properties of the PURCHASE: facts about what may be bought of a
   * material at all". A minimum of 12 typed against a pack of cones is 12 cones.
   *
   * Equal to `excessCalcQty` when no MOQ applies AND no pack is named, which is
   * every line written before this and the reason nothing already stored moves.
   */
  afterMoq: number;
  /** After the operator's rounding step. THE figure a PO is written from, in the
   *  same unit as `afterMoq` above. */
  finalQty: number;
};

/**
 * The slices of one line, converted into the unit the material is BOUGHT in.
 *
 * ## IT CONVERTS PER SLICE AND THEN SUMS, AND THAT ORDER IS NOT ARBITRARY
 *
 * `bomCeilingForOrder` reads the STORED `purchase_qty` of each requirement row -
 * one `toPurchaseQty` per slice, each already rounded to the alternative unit's
 * own precision - and sums those. Converting the total instead would be more
 * accurate and would disagree with the ceiling by the accumulated rounding,
 * which is the failure this whole change exists to close: a grid and a ceiling
 * that differ by a little are read as a grid and a ceiling that differ, and the
 * operator learns to dismiss the control. Same arithmetic, same order, same
 * answer, to the digit.
 *
 * A NULL SLICE STAYS NULL - it refused upstream and `moqRollup` already knows
 * what to do with it. A slice that ANSWERED and cannot convert also becomes
 * null rather than being dropped: dropping it would total less than the order
 * needs and read as correct, the partial-sum failure recorded throughout this
 * file. `isUsableConversion` makes that unreachable in practice; it is written
 * this way so it cannot become reachable quietly.
 *
 * @param decimals `decimal_places_allowed` of the ALTERNATIVE (purchase) unit -
 *                 never the consumption unit's, which is what the figures going
 *                 in were rounded by.
 */
export function toPurchaseSlices(
  quantities: readonly (number | null)[],
  conversion: ConversionLine | null,
  decimals: number | null,
): readonly (number | null)[] {
  if (!conversion || !isUsableConversion(conversion)) return quantities;
  return quantities.map((q) => {
    const v = num(q);
    if (v == null) return null;
    return toPurchaseQty(v, conversion, uomPrecision(decimals));
  });
}

export function lineQuantity(
  sliceQuantities: readonly (number | null)[],
  moq: number | null,
  roundTo: number | null,
  unitKnown: boolean,
  /**
   * The same slices from `baseRequirementFor`. OPTIONAL so the three existing
   * call sites — the stored write among them — keep working unchanged while the
   * screen opts in; a required parameter here would have been a change to the
   * server action for a column only the grid draws.
   *
   * NOT PUT THROUGH `moqRollup`: an MOQ and a rounding step describe what may be
   * BOUGHT, and this figure is what the order CONSUMES. Rolling it up would make
   * the first column jump to 550 because of a supplier minimum, which is exactly
   * the conflation the four separate columns exist to undo.
   */
  baseQuantities?: readonly (number | null)[],
  /**
   * THE SAME SLICES IN THE PURCHASE UNIT (`toPurchaseSlices`), where the line
   * names a pack. The MOQ and the rounding step run over THESE.
   *
   * ## THE BUG THIS PARAMETER EXISTS TO CLOSE
   *
   * Without it the tail ran over `sliceQuantities`, which are in the CONSUMPTION
   * unit - while `bomCeilingForOrder` has always run the same two numbers over
   * the stored `purchase_qty`. One `moq` of 5000, two units: a line needing
   * 20,000 MTR of thread on a 2,500 MTR cone showed a Final Quantity of 20,000
   * MTR on the grid (the minimum inert) while the ceiling read 5,000 CONE -
   * 12,500,000 MTR, and an over-purchase control that no longer fires.
   *
   * OPTIONAL, and absent means "this line names no pack", which is the fallback
   * the ceiling itself takes (`purchase_qty ?? required_qty`). Every existing
   * call site - the vectors, the stored write - keeps its exact behaviour.
   */
  purchaseQuantities?: readonly (number | null)[],
): LineQuantity | Refusal {
  /* THE CONSUMPTION TOTAL, rolled up with NO minimum: `calcQty` and
     `excessCalcQty` are what the order CONSUMES, and consumption does not care
     that a supplier has a minimum. Passing `null` for the MOQ is what makes this
     a plain sum that still refuses an empty line the way the tail does. */
  const consumed = moqRollup(sliceQuantities, null, unitKnown);
  if (isRefusal(consumed)) return consumed;

  const roll = moqRollup(purchaseQuantities ?? sliceQuantities, moq, unitKnown);
  if (isRefusal(roll)) return roll;

  // A ROUNDING STEP NEEDS A UNIT for the same reason an MOQ does. "Round to
  // 144" against a line with no purchase or consumption unit is 144 of nothing
  // — the blank-supply-type shape the nominated-vendor rule refuses, and the
  // shape `moqRollup` refuses one line above. Only asked when a step is really
  // present: a line with no rounding is not made to answer for a unit it does
  // not need.
  const step = num(roundTo);
  if (step != null && step > 0 && !unitKnown) {
    return { refused: "Set a purchase unit before a rounding step can be applied" };
  }

  // Σ of the known base slices. A slice that REFUSED contributes nothing here
  // just as it does in `moqRollup` — and the refusal itself has already been
  // reported by `moqRollup` above if it refused every slice, so this cannot
  // quietly answer for a line the with-wastage column called unanswerable.
  const base = (baseQuantities ?? []).filter((q): q is number => num(q) != null);

  return {
    calcQty: base.length ? base.reduce((a, b) => a + b, 0) : consumed.total,
    excessCalcQty: consumed.total,
    purchaseQty: roll.total,
    afterMoq: roll.afterMoq,
    finalQty: roundUpTo(roll.afterMoq, step),
  };
}

/**
 * MOQ AND THE ROUNDING STEP, APPLIED PER TRIM COLOUR (0436, client 2026-08-22).
 *
 * A line whose Combination sheet names navy thread on the body and red on the
 * sleeves is buying TWO THINGS. `moqRollup`'s standing rule — the minimum is a
 * minimum per ORDER, never per requirement row — is about the COLOURWAY
 * explosion, where six rows are six sizes of the same white thread and a per-row
 * MOQ of 500 orders 3,000 of something the order needs 100 of. That reasoning
 * does not reach a trim colour: a supplier's minimum is a minimum per CONE, so
 * navy and red each have to clear it on their own.
 *
 * The distinction the code could not previously draw is the one 0436 supplies.
 * A requirement row now carries `item_color_id`, so a colourway row and a
 * trim-colour row stop looking alike — before it, both were "a row of this line"
 * and grouping by either would have grouped by both.
 *
 * ## ONE GROUP REDUCES TO `lineQuantity`, EXACTLY
 *
 * That property is what keeps every line written before 0436 unchanged: a line
 * with no panels has one group — its own Item Color — and this returns what
 * `lineQuantity` returned, to the digit. So this is not a second MOQ rule
 * standing beside the first; it is the first, with the grouping made explicit.
 *
 * ## A REFUSED COLOUR POISONS THE LINE
 *
 * The module header's partial-explosion rule, applied one level down. A line
 * that answers for navy and refuses for red totals less than the order needs and
 * looks exactly like a correct answer — the failure that gets believed rather
 * than reported. So the refusal travels instead, carrying the sentence that
 * already names what to go and fix.
 */
export type ColourQuantities = {
  /** NULL is the line's own Item Color; only the caller can resolve a name. */
  item_color_id: string | null;
  /** This colour's slice figures — `requirementFor`'s answers, refusals dropped
   *  to null by the caller exactly as `lineQuantity` expects them. */
  quantities: readonly (number | null)[];
  /** The same slices before the line's Wastage %. Optional for the reason
   *  `lineQuantity`'s own parameter is optional. */
  baseQuantities?: readonly (number | null)[];
  /** The same slices in the PURCHASE unit - `toPurchaseSlices`. The minimum and
   *  the step run over these; see `lineQuantity`'s own parameter. Per COLOUR,
   *  because the pack is a property of the line and the colours share it. */
  purchaseQuantities?: readonly (number | null)[];
};

export function lineQuantityByColour(
  groups: readonly ColourQuantities[],
  moq: number | null,
  roundTo: number | null,
  unitKnown: boolean,
): LineQuantity | Refusal {
  /* NOT "0 across the board". No groups means the caller produced no slices at
     all — the same unanswerable state `moqRollup` refuses on — and 0 reads as
     "none needed", which is the one answer this module never intends. */
  if (groups.length === 0) {
    return { refused: "Nothing to total — every line refused" };
  }

  const parts: LineQuantity[] = [];
  for (const g of groups) {
    const one = lineQuantity(
      g.quantities,
      moq,
      roundTo,
      unitKnown,
      g.baseQuantities,
      g.purchaseQuantities,
    );
    if (isRefusal(one)) return one;
    parts.push(one);
  }

  const total = (pick: (p: LineQuantity) => number) =>
    parts.reduce((a, p) => a + pick(p), 0);

  return {
    /* THE FIRST TWO SIMPLY SUM. They are what the order CONSUMES, and
       consumption does not care that a supplier has a minimum — the same
       separation `lineQuantity` states for `baseQuantities` one function up. */
    calcQty: total((p) => p.calcQty),
    excessCalcQty: total((p) => p.excessCalcQty),
    /* SUMS LIKE THE FIRST TWO, not like the last two: it is the requirement
       expressed in another unit, and nothing has been lifted to a minimum yet. */
    purchaseQty: total((p) => p.purchaseQty),
    /* THESE TWO ARE WHERE THE GROUPING BITES: each colour cleared the minimum
       and the step on its own before being added, so the sum is what the
       purchase really costs rather than what a single rollup would have said.
       `bomCeilingForOrder` groups the same way, or the ceiling would refuse a
       PO written for the figure this very function told the operator to buy. */
    afterMoq: total((p) => p.afterMoq),
    finalQty: total((p) => p.finalQty),
  };
}


// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/**
 * A fingerprint of everything the requirement was computed FROM.
 *
 * ## Why a total is not enough, and this is the whole reason the column exists
 *
 * WHITE 300 / NAVY 200 becoming WHITE 200 / NAVY 300 leaves the order total at
 * 500 while every colour-wise requirement row is wrong. A stored
 * `computed_for_qty` compares equal and the screen reports "Updated" over a
 * material plan that no longer matches the order.
 *
 * ## What is and is not in it — four decisions
 *
 * The hash is over the sorted (style, combo, TARGET) triples, and every one of
 * these falls out of that choice rather than being listed separately:
 *
 *  - **A combo's DESCRIPTION is not in it.** It is a label, not a quantity, and
 *    nothing downstream multiplies by it. Flagging Recalculate over a typo fix
 *    trains the operator to ignore the badge, which costs more than it saves.
 *  - **A new combo with qty 0 IS in it.** It adds a colour row to every
 *    colour-wise explosion, so the shape of the plan changed even though the
 *    total did not.
 *  - **A REMOVAL is in it**, because the hash is over the whole sorted list
 *    rather than a running sum — a list that lost an entry hashes differently.
 *  - **Excess % and the rejection rule are in it BY CONSTRUCTION**, since both
 *    move the targets. And a rule swapped for one that happens to produce the
 *    same targets does NOT flag, which is correct: nothing to recompute.
 *
 * A target that cannot be resolved encodes as `?`, so a projection gap opening up
 * is a change rather than a silently equal hash.
 */
export function basisFingerprint(order: OrderProductionInput): string {
  // THE SAME QUANTITY `targetsOf` MULTIPLIES, and that identity is the whole
  // contract: hash anything else and a document either flags Recalculate when
  // nothing that matters moved, or stays quiet when something did. It followed
  // `productionTarget` while the requirement did; it follows the entered
  // quantity now that the requirement does (2026-08-20).
  const rows = order.approvals
    .map((a) => `${styleKey(a.style_ref_no)}|${comboKey(a.combo)}|${num(a.qty) ?? 0}`)
    .sort();
  return fnv1a64(rows.join("\n"));
}

/**
 * FNV-1a, doubled to 64 bits.
 *
 * Not a cryptographic hash and does not need to be: this value is only ever
 * compared against ANOTHER fingerprint of the SAME order, so a collision between
 * two different orders is meaningless. `crypto.subtle` was the alternative and
 * is async, which would make every list row await a digest.
 */
function fnv1a64(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Total production across the whole order — the figure shown beside the hash so
 *  an operator can read WHAT it was computed for, not just whether it moved. */
export function totalProductionOf(order: OrderProductionInput): number | Refusal {
  const targets = targetsOf(order);
  if (isRefusal(targets)) return targets;
  return targets.reduce((a, t) => a + t.qty, 0);
}
