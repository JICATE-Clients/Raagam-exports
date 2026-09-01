import { z } from "zod";
import { capsTextNullable, requiredKind } from "@/lib/validation/formats";
/* Client-safe (no `server-only`), same as `inactive.ts` itself — the option
   rules below run in the browser, inside the picker. */
import type { Deactivatable } from "@/lib/masters/inactive";
import { isUnitKind, type UnitKind } from "@/lib/orders/styles/rules";
import { styleProcessInput, type ProcessKind } from "./style-processes";
/* TYPE-ONLY, so the client component is erased at compile time and never
   reaches the server bundle this file is imported into. The three document
   kinds are declared once, in the component that renders them; see
   `AmendmentFile`. */
import type { AttachmentKind } from "@/components/ui/file-attachments";

// ============================================================================
// Garment Orders ▸ Garment Order Amendment. Header + 10 sub-tabs.
// 0126 built the header + Logistic (charges + style-price grids) + Reason.
// 0128 added the data tabs — Style(s), Color/Print (dyeings + prints +
// structures), Combos, Prices, Approval Qty, Country/Sizewise — and reworked
// Reason into the "Amendment In" checkbox panel. Pack type(s) + full Quantities
// remain deferred (no screenshot). Icon fields reference sales_orders / buyers /
// profiles / garment_styles / uoms / color_card_colors / countries / currencies /
// customer_contacts / config_lookups (kinds department, ship_type, agent,
// payment_term, structure, roll_form_print).
// ============================================================================

// ============================================================================
// CASE-DUPLICATE MASTER ROWS
// ============================================================================
/**
 * The key two rows fold onto when they differ only by capitalisation — client
 * 2026-08-31, of the Customer dropdown: "ROJA" and "roja" are one entry.
 *
 * Trim as well as fold. A stored " ROJA" is the same customer as "ROJA" and
 * differs in a character nobody can see, which is the harder half of the same
 * problem: the operator looking at two identical-looking rows has no way to tell
 * which is which, so the fold has to be at least as tolerant as the eye.
 *
 * IT LIVES HERE, NOT IN `service.ts`, because both halves of the rule need it
 * and one of them runs in the browser: the service stamps the key onto each row
 * and the screen collapses on it, and a screen cannot import a `server-only`
 * module. One definition, two readers — the same reason `styleKey` sits where
 * the normalizers and the seed can both reach it.
 */
export function caseFoldKey(name: string | null | undefined): string {
  return (name ?? "").trim().toUpperCase();
}

/** A row `collapseCaseDuplicates` can fold: an id, a name, and the key. */
export type CaseFoldable = {
  id: string;
  name: string;
  code?: string | null;
  dedupe_key: string;
  inactive?: boolean | null;
};

/**
 * Collapse rows that differ only by capitalisation, KEEPING THE ONE THE RECORD
 * ALREADY HOLDS.
 *
 * ## WHY `heldId` IS NOT OPTIONAL
 *
 * Because forgetting it is the whole danger. These are distinct master rows with
 * distinct uuids; a fold picks a winner, and if the order in front of the
 * operator holds the loser then its Customer field renders EMPTY — not wrong,
 * not flagged, just blank — and the next save writes that blank over a perfectly
 * good FK. That is the silent data loss AGENTS.md's "Disabled rows" section
 * exists to prevent, arriving through a different door, and it is why the
 * service refuses to fold and hands the caller a key instead.
 *
 * Pass `null` when there genuinely is no held value (a new record). Making the
 * parameter required means that is a decision rather than an omission.
 *
 * ## WHICH ROW WINS, AND WHY IT IS STABLE
 *
 * In order: the held row; then an ACTIVE row over a switched-off one (choosing a
 * retired master when a live twin exists helps nobody); then a row that has a
 * `code` over one that does not (a coded row is the maintained one); then the
 * lowest id.
 *
 * That last tie-break is arbitrary and is chosen for being STABLE. The
 * alternative — "whichever the sort happened to put first" — depends on the
 * database's collation for two names that differ only in case, so the same
 * operator could be shown a different winner on different days and never be able
 * to say what changed.
 *
 * ## IT REPORTS WHAT IT HID
 *
 * `folded` names every value that had more than one row, so the screen can say
 * so in one line and the operator can merge the masters. Hiding a real master row
 * without saying so would leave a customer permanently unreachable and nothing
 * anywhere to explain it — the fold is a workaround for legacy data, and a
 * workaround that never asks to be fixed becomes the fix.
 */
export function collapseCaseDuplicates<T extends CaseFoldable>(
  rows: readonly T[],
  heldId: string | null,
): { rows: T[]; folded: string[] } {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const g = groups.get(r.dedupe_key);
    if (g) g.push(r);
    else groups.set(r.dedupe_key, [r]);
  }

  const out: T[] = [];
  const folded: string[] = [];
  for (const group of groups.values()) {
    if (group.length > 1) folded.push(group[0].name);
    out.push(
      group.reduce((best, r) => {
        if (r.id === heldId) return r;
        if (best.id === heldId) return best;
        const rOff = !!r.inactive;
        const bestOff = !!best.inactive;
        if (rOff !== bestOff) return rOff ? best : r;
        const rCoded = !!(r.code && r.code.trim());
        const bestCoded = !!(best.code && best.code.trim());
        if (rCoded !== bestCoded) return rCoded ? r : best;
        return r.id < best.id ? r : best;
      }),
    );
  }
  return { rows: out, folded };
}

// ============================================================================
// THE MERCHANDISER OPTION LIST
// ============================================================================
/** A row `merchandiserOptions` can narrow. `MerchandiserRow` satisfies it. */
export type MerchandiserLike = {
  id: string;
  name: string;
  is_merchandiser: boolean;
} & Deactivatable;

/**
 * Narrowed options for the Merchandiser field, PLUS the line to show when there
 * are none — deliberately the same three-field shape `nominatedVendorOptions`
 * returns, because it is the same rule.
 */
export type MerchandiserOptions<T> = {
  items: T[];
  /** Rendered under the field when the list is narrowed to nothing. */
  hint: string | null;
  /** The same reason in a few words, for a compact picker's placeholder. */
  shortHint: string | null;
};

/**
 * The employees this order may name as its merchandiser (client 2026-08-31:
 * Designation *or* Department is "Merchandiser").
 *
 * ## EMPTY-AND-EXPLAIN, NEVER A FALLBACK TO EVERY EMPLOYEE
 *
 * This is AGENTS.md's "Nominated vendors" rule, and it is the same shape down to
 * the return type: *"Empty-and-explain, never fall back to the full list: a
 * silent fallback makes the nomination list advisory and the operator never
 * learns it needs filling in."* Widening to all employees when none matches
 * would let an order be attributed to somebody who is not a merchandiser, and
 * would guarantee nobody ever finds out the master is unpopulated.
 *
 * It is not polish here, it is the difference between a diagnosable failure and
 * an undiagnosable one. Merchandiser became MANDATORY in the same change, so an
 * empty list makes Order Entry unsaveable — and an empty dropdown reads as
 * "nothing has been set up yet", which is a real and unremarkable answer. The
 * operator retries, gives up, and reports "I cannot save orders" rather than
 * "the merchandiser list is empty". The hint is what turns the second sentence
 * into the one they file.
 *
 * ## AND IT IS NOT ONE MESSAGE, BECAUSE THERE ARE TWO EMPTINESSES
 *
 * Measured on the live catalog 2026-08-31, which is why both branches are real
 * rather than defensive: `employees` holds ONE row, its `code` is NULL, its
 * designation is 'Test Designation', and no `config_lookups` row anywhere
 * contains the word "merchandiser". So today this returns the SECOND message —
 * there are employees, none of them is a merchandiser. Telling the operator
 * "no employees have been entered" there would send them to fix something that
 * is not broken.
 *
 * ## NO MENU PATH IS NAMED, DELIBERATELY
 *
 * The obvious hint would say where to go and fix it. There is nowhere: the
 * Employee master screen exists in the codebase but no route mounts it and
 * `submodules.ts` has no entry for it, so any path this sentence named would be
 * a direction to a row that does not exist — worse than no direction, because
 * the operator goes looking, fails, and concludes the screen is broken rather
 * than the sentence (AGENTS.md, "A LABEL IS ALSO WRITTEN DOWN IN THE PROSE").
 * When the master is registered, add the path here and `check:nav-paths` will
 * hold it honest from then on.
 *
 * ## THE HELD EMPLOYEE ALWAYS SURVIVES
 *
 * Same rescue `nominatedVendorOptions` performs and for the same reason: an
 * order naming a merchandiser who has since changed department, or been
 * switched off, must still resolve — otherwise the field renders empty and the
 * next save blanks the FK ("Disabled rows"). The rescue also empties
 * `shortHint`, because a box with the held row in it is not an empty box; the
 * paragraph stays, since the reason the OTHERS are missing is still worth
 * saying.
 */
export function merchandiserOptions<T extends MerchandiserLike>(
  rows: readonly T[],
  currentValue: string | null,
): MerchandiserOptions<T> {
  const items = rows.filter((r) => r.is_merchandiser);

  let hint: string | null = null;
  let shortHint: string | null = null;
  if (items.length === 0) {
    if (rows.length === 0) {
      hint =
        "No employees have been entered yet, so there is nobody to name here. " +
        "The Employee master has to be filled in first.";
      shortHint = "No employees entered";
    } else {
      hint =
        "No employee has a Designation or Department of “Merchandiser”, " +
        "so there is nobody to name here. Set one on the Employee master.";
      shortHint = "No merchandisers set up";
    }
  }

  if (!currentValue || items.some((r) => r.id === currentValue)) {
    return { items, hint, shortHint };
  }
  const held = rows.find((r) => r.id === currentValue);
  return held
    ? { items: [...items, held], hint, shortHint: null }
    : { items, hint, shortHint };
}

// ============================================================================
// EVERY STYLE CARRIES AT LEAST ONE FILE
// ============================================================================
/**
 * The style keys that have no document attached (client 2026-08-31: Add File is
 * "mandatory before the style profile can be saved or progressed").
 *
 * ## ONE FUNCTION, THREE CALLERS — THE `missingRequiredMaterialFields` SHAPE
 *
 * AGENTS.md names that function as the pattern for a requirement the Zod field
 * types cannot express: *"one exported function the screen, the Save button and
 * both actions call"*. This is the same situation — "has a file" is a fact about
 * a style's relationship to a SIBLING array, which no field-level `required` can
 * state — and so it takes the same shape rather than being written twice.
 *
 * It lives here, not in `actions.ts`, for the reason `file-rows.ts` records:
 * that module is `"use server"`, so nothing in it can be imported by the screen
 * or by a vector.
 *
 * ## KEYED THROUGH `styleKey`'s RULE, TRIM + UPPER
 *
 * Deliberately the same fold `normalizeStyleSizes` and the four other per-style
 * children compare by. A file attached under "st-1" belongs to the style "ST-1";
 * anything stricter would report a style as missing its document while the
 * document sits on it, which is the worst possible failure for a rule that
 * blocks Save.
 *
 * **It re-states the fold rather than calling `styleKey`, and that equivalence
 * is CHECKED rather than assumed.** T3-styles ran the two over 24 inputs —
 * empty, single and multiple spaces, tab, newline, null, undefined, mixed case,
 * leading and trailing whitespace, the slashed codes 0402 introduced
 * (`STL/2627/0001`), `"0"` and `" 0 "`, and five Unicode case-folding edge cases
 * (`ß`, `İ`, `ı`, `ﬁ`, fullwidth `ＳＴ－１`) — with **zero divergences**.
 *
 * `"0"` is the one that could have bitten and is the reason to keep the finding
 * rather than the verdict. `styleKey` is
 * `(refNo?.trim() || styleNo?.trim() || "").toUpperCase()`, so a FALSY trimmed
 * value falls through to the next branch — but `"0"` is a non-empty string and
 * therefore truthy, and the only falsy trimmed result is `""`, which the
 * fallback produces anyway. **If that helper ever gains a branch where a
 * legitimate trimmed value can be falsy, these two part company silently** and
 * this function must switch to calling it. Until then the restatement is safe
 * and keeps `types.ts` free of an import the screen does not need.
 *
 * ## A STYLE WITH NO REFERENCE IS NOT REPORTED
 *
 * A line the operator has opened and not yet named has nothing to attach a file
 * TO, and `normalizeStyles` may drop it entirely. Refusing the save over it
 * would make a blank row somebody tabbed into an unsaveable order — the same
 * abstention `comboTreeProblem` makes for a part that says nothing at all.
 */
export function stylesMissingFiles(
  styles: readonly { style_ref_no?: string | null }[],
  files: readonly { style_ref_no?: string | null; storage_path?: string | null }[],
): string[] {
  const withFiles = new Set(
    files
      /**
       * A ROW WITH NO PATH IS A FAILED UPLOAD, NOT A DOCUMENT — the same test
       * `normalizeFileRows` keys the whole table on. Counting it would let a
       * style pass this guard on an attachment that resolves to nothing when
       * production clicks it months later.
       *
       * IT IS NOT DEFENSIVE. It is the one thing this predicate does that the
       * screen's own guard did not, and T3-styles measured the gap rather than
       * arguing it: 105 cases compared across {blank / whitespace / matching /
       * differently-cased / other ref} × {no file / matching / differently-cased
       * / order-level / blank path / whitespace path / other style's} × {row
       * started by its ref, by a PO Qty, by a Description} — **12 divergences,
       * and all 12 were this filter.**
       *
       * The case is REACHABLE, which is why it earns a comment this long.
       * Nothing the screen uploads can produce it (`FileAttachments` appends a
       * row only once the upload returns a path) but the SEED can:
       * `openEdit` maps `storage_path: f.storage_path ?? ""`, so a legacy row
       * with a null path arrives as one. Under the screen's old per-row test
       * that style satisfied the button and failed the server — **Save enabled,
       * save refused, and nothing on screen saying why**. That is the "server
       * stricter than the screen" half of the drift this shared predicate
       * exists to prevent, and it was already live before the predicate landed.
       *
       * The 13th difference was outside that matrix: two style rows sharing one
       * reference are reported ONCE here and were reported twice by the per-row
       * test, so the rail badge no longer counts one missing document as two.
       */
      .filter((f) => !!(f.storage_path && f.storage_path.trim()))
      .map((f) => (f.style_ref_no ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of styles) {
    const ref = (s.style_ref_no ?? "").trim();
    if (!ref) continue;
    const key = ref.toUpperCase();
    if (withFiles.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * The sentence shown when a style has no document — T3-styles' wording, and the
 * reason it is a function is that the SCREEN and the SERVER must say it
 * identically. A blocked Save reads it out loud, and "attach the style's
 * document" would leave the operator guessing which document.
 */
export function styleFileMessage(styleRef: string): string {
  return `${styleRef}: attach the tech pack, sketch or spec image for this style before saving.`;
}

// Fixed dropdowns — legacy option lists (confirm exact values via screenshots).
// WITHDRAWN FROM THE FORM 2026-08-11 (client) and kept for the same reason
// RECEIPT_MODES is: `orders_amendments.initiated` and its stored rows are
// untouched, and this tuple is the only record of the vocabulary they hold.
export const INITIATED_OPTIONS = ["By Customer", "By Us"] as const;
// AMEND_TYPE_OPTIONS joined them 2026-08-11: the "Type" dropdown went, on the
// grounds that the company only makes garments, so Fabric and Made-ups were
// answers no order could have. `amend_type` still holds them on older rows.
export const AMEND_TYPE_OPTIONS = ["Garment", "Fabric", "Made-ups"] as const;

/**
 * ORDER UNIT IS PCS OR SET, AND IT IS THE STYLE'S OWN ANSWER (client
 * 2026-08-11: "Order Unit (PCS/SET) is sufficient").
 *
 * It was a `uoms` picker — nos / mtr / kg / gross / yard / set — seeded from
 * `garment_styles.unit_id`. The line now reads the style's `unit_kind`
 * ('piece' | 'set', 0392), which is the SAME value that caps that style's
 * Coordinates grid via `COORDINATE_LIMITS`.
 *
 * DERIVED, NOT COPIED, AND THAT IS THE POINT. A garment style either IS one
 * garment or IS a set of 2-6 coordinates, so an order line naming that style
 * has no room to disagree with it — there is nothing here for an operator to
 * choose. Resolving it through `style_id` on every read means the two can never
 * drift; a snapshot column would be a second source of truth for a fact the
 * style already owns. `style_id` is stored, so a reopened amendment re-derives
 * the same answer.
 *
 * `uoms` CANNOT CARRY THIS VALUE and must not be made to. It is seeded
 * lowercase, has NO piece row at all, and its codes are editable from the Stock
 * Unit master — inferring Piece/Set from it is exactly what the Style screen
 * rejected outright on 2026-08-11, and re-proposing it here would break the
 * rule silently the day someone tidies that master.
 *
 * THE WORDS ARE THE CLIENT'S: PCS and SET, not the Style screen's Piece / Set.
 * Capitals per AGENTS.md, and not merely cosmetic here — this string is STORED,
 * on `garment_order_amendment_price_details.unit`, whose Unit "is pulled from
 * the Order Unit established in the initial Style Entry".
 *
 * Keyed by `UnitKind` rather than written as a ternary so a third kind added to
 * `COORDINATE_LIMITS` fails to compile here instead of quietly reading blank.
 */
const ORDER_UNIT_LABELS: Record<UnitKind, string> = { piece: "PCS", set: "SET" };

/**
 * A style's Order Unit as the word the order shows and stores.
 *
 * BLANK IS A REAL ANSWER, NOT A DEFAULT. Every style created before 2026-08-10
 * has no `unit_kind` (0392 added it nullable), and guessing PCS for those would
 * put an invented unit against a real PO Qty. Same silence `coordinateLimit`
 * keeps, for the same reason.
 */
export function orderUnitLabel(unitKind: string | null | undefined): string {
  return isUnitKind(unitKind) ? ORDER_UNIT_LABELS[unitKind] : "";
}
/**
 * How finished garments are sorted into cartons (client 2026-08-10). Four
 * standard industry methods, and the two axes are independent: colour solid or
 * assorted, size solid or assorted.
 *
 *   Solid Colour / Solid Size   one colour, one size per carton
 *   Solid Colour / Assort Size  one colour, mixed sizes
 *   Assort Colour / Solid Size  mixed colours, one size
 *   Assort Colour / Assort Size mixed colours AND mixed sizes
 *
 * ONE DECLARATION, because the list is named in two places: the Pack type(s) tab
 * defines it and the Quantities tab picks one per destination. Two hand-written
 * copies of a four-item list is how they start disagreeing about the wording,
 * and the wording is what the Packing List prints.
 *
 * STORED SINCE 0399, and the legacy screen answered the question this comment
 * used to leave open: the tab is a GRID, so an order declares the pack methods
 * it uses and may declare more than one. Not a header column, and not (yet) a
 * column on the quantities child.
 *
 * ALSO SEEDED AS DATA, ONCE (0400). The same four names are rows under
 * `config_lookups` kind `assortment_type`, which is what the Quantities tab's
 * Assortment Type picks from — so the two tabs ask the same question in the
 * same words. The tie is the WORDING and nothing enforces it: that kind is
 * operator-maintained through the picker's inline Add, deliberately, so
 * re-wording a method here means a NEW migration re-wording the row too
 * (editing 0400 changes nothing — it has already run). Nothing breaks if they
 * drift; the two tabs just stop reading alike.
 *
 * THIS TUPLE NO LONGER CONSTRAINS ANYTHING (2026-08-27). The Pack type(s) cell
 * was a `<Select>` over these names and is now a typed box (client: "packtype
 * field manual entry, not a default value"), so what an order may name is
 * whatever the operator types. `pack_type` is text with no CHECK and
 * `amendmentPackTypeInput` is `nullableText` and not a `z.enum` of this, which
 * is what made the change UI-only: nothing already saved became invalid and no
 * migration was needed.
 *
 * SO WHAT IS IT FOR NOW? Two things, both still worth one declaration. The
 * screen prints it under the grid as the usual wordings, and 0400 seeded these
 * same names into the lookup the Quantities tab picks from — so re-wording a
 * method here still means a new migration if the two tabs are to keep reading
 * alike. It is a vocabulary offered, not a list enforced.
 */
export const PACK_TYPE_OPTIONS = [
  "Solid Colour / Solid Size",
  "Solid Colour / Assort Size",
] as const;

/**
 * THE TWO ASSORT-COLOUR METHODS ARE RETIRED (client 2026-08-25: "remove
 * Assorted Color Solid Size and Assorted Color Assorted Size from the active
 * dropdown — they are never used on the Tirupur floor and only create visual
 * noise").
 *
 * **THIS IS THE SECOND HALF OF A RETIREMENT THAT WAS HALF-DONE FOR A WEEK.**
 * `0432` retired the same two on the OTHER store on 2026-08-18 —
 * `config_lookups` kind `assortment_type`, `is_active = false` — which took them
 * off the Quantities tab's Assortment Type picker for free, because
 * `DataPicker` hides an inactive row and keeps a held one. The Pack type(s) tab
 * reads this compile-time tuple instead, so it went on offering all four. Two
 * stores, one decision, and only one of them heard it: exactly the drift the
 * comment above predicts in the abstract.
 *
 * AND THE DROPDOWN IT WAS RETIRED FROM IS GONE (2026-08-27). The cell is typed
 * now, so nothing hides a retired method and nothing stops an operator naming
 * one — that is what manual entry means, and it is the client's own later
 * instruction. `packTypeOptions()` went with the `<Select>`: it re-admitted a
 * held off-tuple value and tagged it `(inactive)`, which was the "Disabled
 * rows" rule reaching a plain `<Select>`, and a typed box has no option list to
 * drop a stored value from in the first place.
 *
 * KEPT, NOT DELETED, for what it still says: these two are not offered as
 * examples under the grid. Deleting them would put them back in that sentence,
 * which is the one place the retirement still has a surface to act on. The row
 * ceiling and the "N of M methods" badge that used to read
 * `PACK_TYPE_OPTIONS.length` are both gone — a ceiling counting a list nobody
 * picks from is a "+ Add" that stops working for no visible reason.
 */
export const RETIRED_PACK_TYPES: readonly string[] = [
  "Assort Colour / Solid Size",
  "Assort Colour / Assort Size",
];

/**
 * How a style's price is broken down (client 2026-08-10). "The most critical
 * field in this tab, as it determines how the pricing grid behaves":
 *
 *   Style-wise            one price for the style, whatever the colour or size.
 *   Color-wise            a price per colourway; a neon combo can cost more.
 *   Size-wise             a price per size; 2XL can cost more than S.
 *   Color-wise Size-wise  a price per colour AND size combination (0416).
 *
 * THE FOURTH IS NEW AND THE OTHER THREE ARE UNCHANGED — the client's four modes
 * (2026-08-12) are the original three plus the combination. Stored as text in
 * `garment_order_amendment_price_details.price_type`, which is why this is a
 * plain tuple and not a config_lookups kind: fixed modes the business does not
 * add to, like SHIP_MODES and PAY_MODES below.
 *
 * THE ORDER IS THE READING ORDER, narrowest last. It is also what the Prices
 * grid renders, so re-ordering this re-orders the dropdown.
 *
 * A ROW MAY HOLD A VALUE NOT IN THIS TUPLE — `price_type` has no CHECK, and a
 * `<Select>` matches on value, so a re-worded mode would render a saved row
 * blank. Same trap PACK_TYPE_OPTIONS records above. Re-wording one means
 * migrating the stored rows too.
 */
export const PRICE_TYPE_OPTIONS = [
  "Style-wise",
  "Pack-wise",
  "Pack-wise Size-wise",
  "Color-wise",
  "Size-wise",
  "Color-wise Size-wise",
] as const;
export type PriceType = (typeof PRICE_TYPE_OPTIONS)[number];

/**
 * "PACK-WISE" IS THE FIFTH MODE (client 2026-08-25), and it is the one whose
 * AXES ARE NOT WHAT MAKES IT DIFFERENT.
 *
 * A retail set is priced per box — "$12 per Baby Box" — not per garment, so
 * that the price on a commercial invoice matches the thing customs is looking
 * at. On the GRID that is a 1x1 matrix, exactly like Style-wise: one rate, no
 * colour axis, no size axis. `priceAxes` and `modeAxes` therefore need NO new
 * branch — an unrecognised mode already answers `{colour:false, size:false}`,
 * which is the right answer here rather than a lucky one.
 *
 * WHAT CHANGES IS THE MULTIPLICAND. Every other mode is a rate per GARMENT and
 * `orderValue` multiplies it by `po_qty`. Pack-wise is a rate per PACK and must
 * be multiplied by `packs_ordered` (0467). Multiplying $12 by 3,000 pieces
 * instead of 1,000 packs overstates the order threefold and looks entirely
 * plausible on the screen that prints it — so `priceBasisOf` in
 * `order-value.ts` is a hard fork in the arithmetic, not a display choice.
 *
 * It sits SECOND, beside Style-wise, because the tuple's order is the reading
 * order and the two are the same shape of answer (one rate for the line). The
 * grid renders this tuple directly, so this is also the dropdown order.
 */
export const PACK_WISE_PRICE: PriceType = "Pack-wise";

/**
 * "PACK-WISE SIZE-WISE" IS THE SIXTH MODE (client 2026-08-28): one rate per BOX
 * per SIZE — "the 5-Piece Gift Pack has a set unit rate for Size S".
 *
 * It sits THIRD, beside Pack-wise, because the tuple is the reading order and
 * the dropdown order, and the two pack modes are one question asked at two
 * grains. Putting it after "Color-wise Size-wise" would read as a variant of
 * the colour modes, which it is not: it prices a CONTAINER, and no colour axis
 * exists on a box that holds several.
 *
 * WHAT IT INHERITS AND WHAT IT ADDS. Like Pack-wise it is a rate per BOX, so
 * `priceBasisOf` must answer "pack" for it and `orderValue` must multiply by
 * `packs_ordered` — the $12 x 1,000 boxes vs x 3,000 garments fork. Unlike
 * Pack-wise it has a SIZE axis, so `modeAxes` opens the size grid and
 * `styleRate` blends the per-size rates.
 *
 * THE BLEND NEEDS NO NEW WEIGHT, and this is the one thing about it that is
 * not obvious. `styleRate` weights by the Quantities tab's PIECES, not by
 * boxes — but a method has ONE composition applied to every size, so
 * `pieces(size) = boxes(size) x packSize` with `packSize` constant. The
 * constant cancels out of a weighted average, so blending by pieces gives the
 * identical rate to blending by boxes, and `blendedRate x packs_ordered` is
 * exactly `SUM(rate(size) x boxes(size))`. Vectored, because "it cancels" is
 * the kind of reasoning that is true until a composition varies by size.
 */
export const PACK_WISE_SIZE_PRICE: PriceType = "Pack-wise Size-wise";
export const SIZE_WISE_PRICE: PriceType = "Size-wise";

/**
 * THE ONE MODE AN ORDER WITH NO PACK TYPE IS PRICED IN (client 2026-08-29:
 * "when Pack Type is No the system locks the grid to standard Style Price
 * only").
 *
 * NAMED, NOT `PRICE_TYPE_OPTIONS[0]`. The tuple's order is its READING order
 * and the note above says re-ordering it re-orders the dropdown — so an index
 * would silently become a different mode the first time somebody moved
 * Color-wise up. The two pack modes beside this are named for the same reason.
 */
export const STYLE_WISE_PRICE: PriceType = "Style-wise";

/**
 * WHAT THE PRICES TAB OFFERS WITH NO PACK TYPE LIVE (client 2026-08-29).
 *
 * ## THIS NARROWS; IT DOES NOT REVERSE 2026-08-28
 *
 * The pack branch above is untouched — an order WITH a pack type still offers
 * Pack-wise, Pack-wise Size-wise and Size-wise exactly as that ruling set out.
 * What changed is the other side of the same `if`, which until now fell through
 * to the whole six-mode tuple: an order with no pack type could be priced
 * Color-wise, Size-wise or Color-wise Size-wise, and the client has ruled that
 * without a pack type there is one rate for the style and nothing else.
 *
 * So the two halves are now BOTH narrow, and neither is the full tuple. That is
 * worth stating because `PRICE_TYPE_OPTIONS` is no longer offered anywhere in
 * full — it remains the vocabulary (and what `price_type` may hold), not a menu.
 *
 * A STORED ROW OUTSIDE THE LIVE LIST IS STILL SHOWN, tagged, by
 * `priceModeOptions` — the same courtesy the pack branch already extends. A
 * Color-wise order entered before today reads back as Color-wise rather than
 * blank, which is the trap the tuple's own note describes.
 */
export const NO_PACK_PRICE_MODES: readonly PriceType[] = [STYLE_WISE_PRICE];

/**
 * WHICH MODES THE PRICES TAB OFFERS ONCE A PACK TYPE IS LIVE (client
 * 2026-08-28, second ruling).
 *
 * ## This is NOT `isPackWise`, and conflating them is the whole risk
 *
 * `isPackWise` (`order-value.ts`) answers "is this rate a rate per BOX?" — the
 * multiplicand fork. This list answers "may the operator choose this on a pack
 * order?" — a screen question. They were the SAME list until now, which is why
 * one predicate served both, and the moment a per-garment mode joined the
 * dropdown they stopped being the same statement. Reading `isPackWise` where
 * this list is meant would drop Size-wise out of the dropdown; reading this list
 * where `isPackWise` is meant would multiply a garment rate by the box count.
 *
 * ## Why a per-garment mode is on a pack order at all
 *
 * The first ruling was "a pack order prices the box, and only the box" — one
 * rate per carton so the commercial invoice carries one figure. The operator has
 * since asked for plain Size-wise beside the two pack modes, and it is a real
 * trade: some buyers contract a set at a per-GARMENT rate per size and let the
 * box price fall out of the composition. Nothing about the earlier ruling is
 * withdrawn — the per-STYLE and per-COLOUR grids stay hidden, so there is still
 * exactly one place a rate is typed for a pack, and still no way to quote a box
 * and a garment for the same method at once (`packPriceMode` reads ONE mode per
 * method).
 *
 * ## What the operator must be able to see
 *
 * `$12` under Pack-wise and `$12` under Size-wise value a 3-style gift box at
 * 4,800 and 14,400 respectively, and BOTH are correct arithmetic for what they
 * mean. So the grid's rate column names its unit ("Rate / pack" vs
 * "Rate / piece") rather than leaving one header over two questions. That is the
 * guard; there is no arithmetic one, because there is nothing wrong with either
 * figure.
 *
 * DERIVED FROM THE TUPLE, so the dropdown keeps `PRICE_TYPE_OPTIONS`' declared
 * reading order (Pack-wise, Pack-wise Size-wise, Size-wise) and a mode re-worded
 * there cannot leave a dangling literal here.
 */
export const PACK_BRANCH_PRICE_MODES: readonly PriceType[] = PRICE_TYPE_OPTIONS.filter(
  (o) => o === PACK_WISE_PRICE || o === PACK_WISE_SIZE_PRICE || o === SIZE_WISE_PRICE,
);

/**
 * Is this stored mode one the pack branch renders?
 *
 * Trimmed and case-folded like every other read of `price_type` in this module,
 * because a row SAVED before a re-wording is the case this has to survive — a
 * method whose mode fails this test reads back as the default and its typed
 * rates go invisible.
 */
export function isPackBranchMode(priceType: string | null | undefined): boolean {
  const m = (priceType ?? "").trim().toLowerCase();
  return PACK_BRANCH_PRICE_MODES.some((o) => o.toLowerCase() === m);
}

export const SEASON_OPTIONS = ["Summer", "Winter", "Spring", "Autumn"] as const;

/**
 * Color/Print ▸ the Dyeing row's **Type**, and there are TWO lists because the
 * question is not the same one (client 2026-08-17).
 *
 *   Yarn dyeing   → Y/D, Melange
 *   Fabric dyeing → Dyed, Melange
 *
 * Yarn is either dyed as yarn (Y/D) or bought already melange; fabric is
 * piece-dyed after knitting (Dyed) or knitted from melange yarn. "Melange" is in
 * both because a melange fabric IS melange yarn — the same fact stated from
 * either side — and offering it in only one would make the other section
 * unable to describe a perfectly ordinary order.
 *
 * KEYED BY `section`, NOT one merged list, for the reason AGENTS.md's cascading
 * filters section gives: two facets side by side where one answers the other's
 * question. A single list offering Y/D under Fabric dyeing would be offering a
 * value that cannot be right there.
 *
 * NOT TO BE CONFUSED WITH `ITEM_SUB_TYPE_OPTIONS` (combo-rules.ts), which is
 * the STRUCTURE's Fabric Type — Solid / Melange / Yarn Dyed since the client
 * removed `printed` on 2026-08-31 ("an aesthetic processing step, not a base
 * fabric type"). That one decides HOW A PART'S COLOUR CELL IS ANSWERED —
 * `componentColourEntry`, three answers: a filtered list, a typed description,
 * or nothing at all. This one describes how a declared dyeing is done and
 * drives nothing.
 *
 * Neither `takesDyedColour` nor `takesAllOverPrint` is named here any more:
 * both are deleted, and a comment naming a deleted gate is how the next reader
 * comes to restore it. They share two words and no meaning, so they stay
 * deliberately separate constants — merging them would put `solid` into a
 * dyeing dropdown and `Y/D` into a rule that tests for `yarn_dyed`.
 */
export const DYE_TYPE_OPTIONS = {
  yarn: ["Y/D", "Melange"],
  fabric: ["Dyed", "Melange"],
} as const;

/**
 * The Type options for one dyeing row, with whatever it already holds.
 *
 * `dye_type` was free TEXT until 2026-08-17, so a stored value need not be in
 * either list. It is appended rather than dropped — the standing rule from
 * AGENTS.md's "Disabled rows": a value the record already holds that the picker
 * no longer offers renders the cell EMPTY, and the next save writes that
 * emptiness over real data.
 *
 * Compared EXACTLY, not case-folded, and that is the subtle half. `<Select>`
 * matches its `value` by exact string, so folding "melange" onto "Melange" here
 * would tidy the list and leave the cell blank — reintroducing the bug this
 * carve-out exists to prevent. A near-duplicate entry is the honest cost.
 *
 * `garment_order_amendment_dyeings` held ZERO rows when this was written, so the
 * carve-out is future-proofing rather than a migration: it protects a value
 * typed between this change and its deploy.
 */
export function dyeTypeOptions(
  section: "yarn" | "fabric",
  held?: string | null,
): string[] {
  const list: string[] = [...DYE_TYPE_OPTIONS[section]];
  const v = held?.trim();
  return v && !list.includes(v) ? [...list, v] : list;
}
// Reused from the Applicant/Customer masters (see doc/masters-open-questions.md).
export const SHIP_MODES = ["AIR", "ROAD", "SEA"] as const;
export const PAY_MODES = ["CAD", "CASH", "CHEQUE", "DA", "DD", "DP", "LC", "OTH"] as const;
// CAPS like SHIP_MODES and PAY_MODES above — it was the only Title Case set in
// this block, on the same form. `orders_amendments.received_mode` is free text
// (0126:49) so there is no CHECK to move, but migration 0368 DOES rewrite the
// stored rows: the Select matches on value, so a row still holding "By Mail"
// would render as blank against a "BY MAIL" option list.
export const RECEIPT_MODES = ["BY MAIL", "BY HAND", "COURIER", "EMAIL"] as const;
// Color/Print ▸ Dyeing sections (the Yarn / Fabric split).
export const DYE_SECTIONS = ["yarn", "fabric"] as const;

// ---- row interfaces (mirror DB columns) ----
export interface AmendmentCharge {
  id: string;
  amendment_id: string;
  sno: number;
  section: "less" | "add";
  label: string | null;
  calc_mode: string | null;
  amount: number;
  unit: string | null;
}

export interface AmendmentStylePrice {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  price: number;
  csp_type: string | null;
  csp_price: number;
  fob_buyer_price: number;
  fob_selling_price: number;
}

// ---- Phase 2 (0128) child rows, one per data tab ----

/** Style(s) tab — a styles-detail row. */
export interface AmendmentStyle {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style_id: string | null;
  /**
   * THE STYLE MASTER'S OWN HEADER FIELDS, ON THE ORDER (0461, client
   * 2026-08-23). `pickStyle` seeds them; the order may then differ from the
   * style without rewriting history for every other order pointing at it.
   */
  approved_sample_id: string | null;
  article_no: string | null;
  /**
   * THE CATEGORY NAME, and `style_category_id` beside it is the row.
   *
   * The text has been here since the tab was built and is what the order seed
   * populates. It is a DISPLAY CACHE: the id is the truth, and both are written
   * from the picker's one `onChange` so they cannot disagree. It is not dropped
   * because `writeChildren` rewrites this table wholesale — absent from the
   * payload means NULLED, not frozen.
   */
  style_category: string | null;
  style_category_id: string | null;
  style_description: string | null;
  order_unit_id: string | null;
  plan_unit_id: string | null;
  /**
   * ORDER UNIT — 'piece' (shown PCS) or 'set' (SET), asked of the operator
   * again from 2026-08-27 (client: "that order unit need to show pcs and set").
   *
   * NOT `order_unit_id` above, which stays frozen and answers a different
   * question: it was a `uoms` FK offering nos / mtr / kg / gross / yard / set —
   * a stock unit. This is the two-valued vocabulary `COORDINATE_LIMITS` and
   * `garment_styles.unit_kind` already speak, so the coordinate cap, the Style
   * master and the order line cannot spell it three ways (0471).
   *
   * NULL IS "NOT ANSWERED", never PCS. The word is seeded into
   * `price_details.unit`, so a guess here is a guess that reaches an invoice.
   */
  unit_kind: string | null;
  /**
   * PIECES. Always pieces, on a set pack too — see `packs_ordered`.
   */
  po_qty: number;
  /**
   * PACKS the buyer ordered, when the order carries `is_set_pack` (0467).
   *
   * `po_qty` beside it stays the PIECE count and is derived from this one:
   * `po_qty = packs_ordered x sum(pack component qty_per_pack)`. The explosion
   * happens in the browser and only pieces are stored, because
   * `targetsOf` in the Material BOM engine folds an approval row through an
   * exhaustive three-branch switch and NOT ONE BRANCH CARRIES A MULTIPLIER —
   * neither do `fullTarget`, `totalProductionQty` or `bom-ceiling.ts`. A
   * `po_qty` holding packs would under-buy every trim and every kilo of cloth
   * by the set size, and each figure would look right on its own screen.
   *
   * NULL is "not a set pack / not asked", NOT 0. Zero packs is a claim an
   * operator can make and it is a different one.
   */
  packs_ordered: number | null;
  description: string | null;
}

/**
 * One member of a retail SET pack — Quantities' carton explosion's twin, one
 * level up the commercial chain (0467, client 2026-08-25).
 *
 * A kid's pyjama set is `{TOP x1, BOTTOM x1}`; a 3-pack of bodysuits is one
 * coordinate three times over in three colours. So a row is keyed on
 * **(coordinate, combo)** and not on the coordinate alone — keyed on the
 * garment only, the client's own worked example would be refused by the unique
 * index.
 *
 * THERE IS NO `pieces_per_pack` FIELD. It is the sum of these rows'
 * `qty_per_pack`, and a field for a sum is a second source of truth for an
 * addition — the same test that kept `pcs_per_pack` off the assortment line
 * twice (0414, restated by 0432 when it admitted `inners_per_carton` because
 * that one is typed and derivable from nothing).
 *
 * `combo` and `style_ref_no` are TEXT BY VALUE, the 0413 / 0433 convention: a
 * combo row's id is rewritten by every `writeChildren` pass, so an FK to it
 * points at a row that will not exist after the next Save.
 */
export interface AmendmentPackComponent {
  id: string;
  amendment_id: string;
  style_ref_no: string | null;
  sno: number;
  /** Which garment of the set — `items` of item class GAR, as Coordinates (0461). */
  coordinate_id: string | null;
  /** The colourway this member is made in, by value. */
  combo: string | null;
  /** How many of this coordinate are in ONE pack. Usually 1. */
  qty_per_pack: number;
}

/**
 * Order Info ▸ Styles Details ▸ one COORDINATE of one style line (0461).
 *
 * A COMPONENT IS A PART OF ONE OF THESE — the Style master says so in the one
 * hint line that survived its de-clutter sweep, and its Component grid narrows
 * on it. Until this table existed the order's Coordinate cell had nothing on the
 * order to scope by and offered the whole `items` GAR master.
 *
 * Keyed by `style_ref_no` for the reason the sizes, the processes and the
 * components all record, and read back by the same pass.
 */
export interface AmendmentStyleCoordinate {
  id: string;
  amendment_id: string;
  style_ref_no: string | null;
  sno: number;
  /** `items` of item class GAR (0396) — PIECES, TOP, BOTTOM. */
  coordinate_id: string | null;
}

/**
 * Style(s) tab — one SIZE of one style line (0407).
 *
 * The nested grid under a style row. It belongs to the style by `style_ref_no`,
 * NOT by an id: `writeChildren` reinserts `..._styles` wholesale on every save,
 * so an id would be a different uuid by the time this row was read back. 0407's
 * header carries the full account, and it is the same text key Price Details,
 * Quantities and Approval Qty already resolve on.
 */
export interface AmendmentStyleSize {
  id: string;
  amendment_id: string;
  style_ref_no: string | null;
  sno: number;
  /** `config_lookups` kind 'size' — the same rows `garment_style_sizes` uses. */
  size_id: string | null;
}

/**
 * Order Info ▸ Styles Details ▸ one COMPONENT of one style line (0457).
 *
 * THE STYLE MASTER'S "Components & Sizes" SECTION, ON THE ORDER (client
 * 2026-08-23: "we can style as separate child now but we need to merge it with
 * order entry … component and size also will come inside that order info").
 * Sizes were already here (`AmendmentStyleSize` above, 0407); this is the other
 * half, and it is the same three cells the Style master shows — Coordinate,
 * Component, Structure.
 *
 * Keyed by `style_ref_no` for exactly the reason the sizes and the processes
 * are, and read back by the same pass: `writeChildren` reinserts `..._styles`
 * wholesale, so an id would dangle.
 *
 * `pickStyle` SEEDS these from `garment_style_components` — so the order starts
 * from what the style declares and can then differ from it, which is the whole
 * point of the order holding its own rows. Editing the master instead would
 * rewrite every other order already pointing at that style.
 */
export interface AmendmentStyleComponent {
  id: string;
  amendment_id: string;
  style_ref_no: string | null;
  sno: number;
  /** "Coordinate" — `items` of class GAR (0396). PIECES, TOP, BOTTOM. */
  coordinate_id: string | null;
  /** "Component" — the `components` master (0396). FRONT BODY, COLLAR. */
  component_id: string | null;
  /** "Structure" on screen — a fabric CATEGORY (0405), not the knit family. */
  fabric_category_id: string | null;
  /**
   * "Type" — the fabric structure implied by the category, filled by
   * `componentTypeForCategory` on the Structure cell's change.
   *
   * STORED AND NOT SHOWN, exactly as on the Style master, which withdrew the
   * cell on 2026-08-18 and kept the column. It has to stay in the row shape and
   * in the payload, not merely in the table: `writeChildren` rewrites this grid
   * wholesale, so a field dropped from the payload is NULLED on the next save
   * rather than frozen.
   */
  comp_type: string | null;
  /** "Fabric" — withdrawn as a cell on the master 2026-08-11, stored for the
   *  same reason `comp_type` is. */
  item_id: string | null;
}

/**
 * One process of one style line (0411), read back.
 *
 * Keyed by `style_ref_no` for exactly the reason `AmendmentStyleSize` above is,
 * and the two are written and re-read by the same pass.
 *
 * `kind` is the screen's "Type" — 'garment' or 'component', matching 0411's
 * CHECK. It is NULLABLE here because the column is: a row mid-typing has no
 * answer yet, and the normalizer drops it rather than the database refusing it.
 */
export interface AmendmentStyleProcess {
  id: string;
  amendment_id: string;
  style_ref_no: string | null;
  sno: number;
  kind: ProcessKind | null;
  process_id: string | null;
  /** The cut panel this process is done on; null on a Garment Process (0421). */
  component_id: string | null;
  /** Legacy "Details" — a free-text remark, not a lookup (0412). */
  details: string | null;
}

/** Color/Print tab — a Yarn or Fabric dyeing row. */
export interface AmendmentDyeing {
  id: string;
  amendment_id: string;
  sno: number;
  section: "yarn" | "fabric";
  dye_type: string | null;
  /**
   * The colour AS TYPED (0403). Colour Cards was withdrawn as a screen on
   * 2026-08-11 and it was the app's only colour data, so this cell is free text
   * like `dye_type` beside it rather than a dropdown over nothing.
   */
  color_name: string | null;
  /** Pre-0403 colour-card reference. Frozen, not dropped — see 0403's header. */
  color_id: string | null;
}

/** Color/Print tab — a roll-form print row. */
export interface AmendmentPrint {
  id: string;
  amendment_id: string;
  sno: number;
  print_id: string | null;
  /** The value — always text, whether picked or typed (0477). See the column. */
  print_name: string | null;
}

/** Color/Print tab — a structure row. */
export interface AmendmentStructure {
  id: string;
  amendment_id: string;
  sno: number;
  /**
   * A fabric CATEGORY — SINGLE JERSEY, 1X1 LYCRA RIB (0415).
   *
   * Was `config_lookups` kind 'fabric_structure' (Circular Knit / Flat Knit /
   * Woven), which is the knit FAMILY one level up. 0405 gave this answer for the
   * style master and 0409 for the combo structure row; this grid was the last
   * one on the wrong level, and the level is what lets it be seeded from the
   * order's own style lines rather than retyped.
   */
  structure_id: string | null;
  /**
   * Solid / Melange / Yarn Dyed (0415) — the client's "see the Type for each
   * fabric structure immediately", and what decides which T&A processing
   * deadlines apply.
   *
   * THREE VALUES, NOT FOUR, SINCE 2026-08-31. `printed` is gone from
   * `ITEM_SUB_TYPE_OPTIONS` and from both CHECKs (0480) on the client's own
   * reasoning — "an aesthetic processing step, not a base fabric type" — and
   * the catalog held none in either amendment table on the day it went, which
   * is what made the constraint safe to tighten rather than carry for ever.
   *
   * NULL IS STILL A REAL STATE, not a missing default: `componentColourEntry`
   * answers `null` for it, so an unanswered Type neither offers a colour list
   * nor makes a part's Colour cell mandatory. Defaulting to 'solid' would put
   * an invented answer on a row nobody has read yet.
   */
  item_sub_type: string | null;
}

/** Combos tab — a combo row. */
export interface AmendmentCombo {
  id: string;
  amendment_id: string;
  sno: number;
  /** The style this colourway belongs to — read-only, copied from Style(s). */
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  /** The colourway's own name — "WHITE", "NAVY" (0397). */
  combo: string | null;
  /** Legacy shows Combo and ComboDescription as two columns (0408). */
  combo_description: string | null;
  /** The Detail overlay's outer grid (0408). Embedded, not a sibling list. */
  structures: AmendmentComboStructure[];
}

/**
 * Combos ▸ Detail ▸ one fabric structure of one combo (0408 · 0409).
 *
 * MANY PER COMBO. A tee is single jersey in the body and 1x1 rib at the collar,
 * both in the same colourway — which is what corrected 0397's "one combo is one
 * structure" (legacy screenshots 2259 · 2260).
 */
export interface AmendmentComboStructure {
  id: string;
  combo_id: string;
  sno: number;
  /** A fabric CATEGORY (0409) — SINGLE JERSEY, 1X1 LYCRA RIB. */
  structure_id: string | null;
  /** "Type" — 'main' | 'trims_fabric'. NOT the Style master's comp_type. */
  fabric_type: string | null;
  /**
   * "Composition" — a row of the COMPOSITION MASTER (0434).
   *
   * It pointed at `compositions` from 0408, at `items` of class FABRIC from
   * 0430, and at the master again from 2026-08-19. The swap back is not a
   * revert: 0430 moved off the master because a composition could only be
   * TYPED, and it can now be FETCHED — `compositionForStructure()` reduces the
   * structure's sole fabric to yarn categories and finds the master row stating
   * that blend. The fetch 0430 was asked for survives; the value is a master
   * record again.
   */
  composition_id: string | null;
  gsm: number | null;
  gsm_tolerance: number | null;
  /**
   * "Fabric Type" — 'solid' | 'melange' | 'yarn_dyed' (`ITEM_SUB_TYPE_OPTIONS`).
   *
   * `printed` was the fourth value and is gone (client 2026-08-31, 0480). It
   * used to decide WHICH aesthetic cell a part filled — a colour or a print,
   * never both — and that job ended on 2026-08-20 when the client put Colour
   * and Fabric Print side by side on every part, so the option outlived its
   * reason before it was removed.
   *
   * WHAT IT DECIDES NOW is `componentColourEntry`: a filtered list of this
   * order's declared colours (solid, melange), a typed description
   * (yarn_dyed — see `yarn_colors` below), or nothing at all (unanswered).
   */
  item_sub_type: string | null;
  /**
   * "Yarn Color" — the colours of the PRE-DYED YARNS this cloth is knitted
   * from (client 2026-08-31, column added by 0480).
   *
   * A PROPERTY OF THE CLOTH, WHICH IS WHY IT IS ON THE STRUCTURE AND NOT ON
   * THE PART. A yarn-dyed fabric is knitted from yarns that were dyed before
   * knitting, so its yarn colours are settled by the fabric itself — every
   * part cut from that cloth is made of the same yarns. Putting it on the
   * component would let the front body and the back body of one fabric
   * disagree about what the fabric is made of, which is not a state that
   * exists, and would ask the operator the same question once per part.
   *
   * The part-level field it is often confused with is `color_name` below,
   * which is the FINISHED panel's colour — a description like
   * "WHITE/BLUE STRIPE" on a yarn-dyed cloth, typed rather than picked
   * precisely because no single declared colour can state a blend. The two are
   * complementary: this says which yarns went in, that says what came out.
   *
   * ALWAYS AN ARRAY, NEVER NULL FROM THE DATABASE — the column is
   * `text[] not null default '{}'` (0480), so a fabric with no yarn colours
   * reads `[]`. `| null` is here for the seed and the screen, which build rows
   * that have not been round-tripped through Postgres yet, and for the same
   * reason every other column on this interface is nullable: a payload that
   * stops carrying it must be visibly absent rather than silently `[]`.
   */
  yarn_colors: string[] | null;
  /** The overlay's nested grid. */
  components: AmendmentComboComponent[];
  // Gsm Range is DERIVED (`gsmRange` in combo-rules.ts) and has no column.
}

/** Combos ▸ Detail ▸ one garment part made of that structure (0408). */
export interface AmendmentComboComponent {
  id: string;
  structure_id: string;
  sno: number;
  /** `items`, item class GAR (0396) — PIECES, TOP, BOTTOM. */
  coordinate_id: string | null;
  /** The `components` master (0396) — FRONT BODY, COLLAR. */
  component_id: string | null;
  /**
   * "Fabric Color" — TEXT, following 0403, which made the Color/Print tab's own
   * colour free text when Colour Cards was withdrawn as a screen. "Must be a
   * colour this amendment declared" stays a RULE the screen offers rather than
   * a constraint, so an order with no dyeing row yet is guided, not blocked.
   */
  color_name: string | null;
  /**
   * "Fabric Print" — ONE field, not a Fabric and a Print (0410, operator).
   * The legacy header's two words are one label, and it carries one control:
   * the green ⊛ that is this picker's inline create.
   */
  print_id: string | null;
  processed_as_trim: boolean;
}

/** Prices tab — a price-detail row (distinct from Logistic's style_prices). */
export interface AmendmentPriceDetail {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  price_type: string | null;
  /**
   * WHICH colourway this rate is for (0416) — the combo NAME, matching
   * `AmendmentCombo.combo` and the assort line's own `combo`.
   *
   * NULL on a Style-wise or Size-wise row, where the rate is not per colour.
   * With `size_id` beside it this is what lets `orderValue` weight each rate by
   * that combination's quantity instead of refusing to answer at all.
   */
  combo: string | null;
  /** WHICH size this rate is for (0416) — config_lookups kind 'size'. NULL
   *  unless the mode prices by size. */
  size_id: string | null;
  unit: string | null;
  price: number;
}

/** Approval Qty tab — a style + approval quantity row. */
export interface AmendmentApprovalQty {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  /** The colour this line is for (0413). By VALUE from the Combos tab. */
  combo: string | null;
  combo_description: string | null;
  /**
   * The SIZE this line is for (0435) — a `config_lookups` size, the same
   * vocabulary the assortment tree uses. NULL on a row seeded from a legacy
   * order, which has no size axis (`order_pack_ratios` is per style).
   *
   * Approval Qty is typed at THIS level and nowhere else (client 2026-08-19).
   * The combo line the operator sees above it is the sum of its sizes, so two
   * places to enter one number never exist.
   */
  size_id: string | null;
  /**
   * Ordered pieces of this style + combo + size.
   *
   * DERIVED SINCE 0435 and stored as a snapshot — it used to be typed. It comes
   * from the Quantities tab's assortment tree, which already states the pieces
   * of every (style, combo, size); nothing on this tab types it any more.
   */
  qty: number;
  approval_qty: number;
}

/**
 * Pack type(s) tab (0399) — one row per packing method the order uses.
 *
 * The whole row is its own value: there is nothing to say about a pack method
 * beyond naming it, which is why this is the only child with a single data
 * column. `pack_type` is free text since 2026-08-27 — typed, not picked — and
 * `PACK_TYPE_OPTIONS` is the wording the screen offers as examples.
 */
export interface AmendmentPackType {
  id: string;
  amendment_id: string;
  sno: number;
  pack_type: string | null;
}

/**
 * Pack type(s) ▸ what one packing method actually packs (0472).
 *
 * Legacy's Pack type(s) tab is MASTER-DETAIL and the conversion took only the
 * master — a pack type was a WORD and nothing else, which is why
 * `AmendmentPackType` above still describes itself as "the only child with a
 * single data column". Beneath each row legacy carries StyleRefNo | Style No |
 * Combo | Qty (client 2026-08-27, screenshot 2518).
 *
 * KEYED BY `pack_type` TEXT, exactly as the styles' children are keyed by
 * `style_ref_no`, and legitimately: `uq_goa_pack_types_method` makes
 * `(amendment_id, pack_type)` unique, so the word identifies its parent. That
 * is also what keeps this table inside `writeChildren`'s flat
 * delete-all-then-reinsert instead of needing `writeComboTree`'s pairing.
 *
 * `style` IS THE REF ON A TYPED LINE. Legacy's two columns were the master's
 * code and its name; Style became manual entry on 2026-08-25, so one string
 * answers both — `combos` and `price_details` already store `style` set to the
 * ref for this reason, and this follows them rather than inventing a third
 * convention.
 */
export interface AmendmentPackTypeLine {
  id: string;
  amendment_id: string;
  sno: number;
  /** The pack type this line belongs to, BY VALUE. */
  pack_type: string | null;
  style_ref_no: string | null;
  style: string | null;
  /** The colourway, as `combos.combo` holds it. */
  combo: string | null;
  /** Pieces of this (style, colourway) that the method packs. */
  qty: number;
}

/**
 * Order Entry ▸ T&A — one activity of the order's Time & Action ladder (0481).
 *
 * Client: "an order cannot be saved without its T&A path being defined", and
 * the reason legacy T&A died is that NOTHING EVER READ IT. So this row is
 * written on the order and READ BY THE DASHBOARD, which is what makes it unlike
 * every sibling child on this document.
 *
 * ## IT IS THE ONE CHILD WHOSE COLUMNS ARE NOT ALL ENTERED ON THIS SCREEN
 *
 *     entered on the ORDER, on the T&A tab   activity_id · days_required
 *     derived by the ladder, on both ends    target_date
 *     entered on the DASHBOARD, days later   actual_date · status · notes
 *
 * `writeChildren` deletes every child row and reinserts, which is lossless for
 * a pack type or a price line because the form holds their whole truth. It is
 * not lossless here: an operator reopening the order to fix a typo would
 * destroy every completion record on it, silently. `row_uid` is what stops
 * that — see it below, and `normalizeTaActivities` in `actions.ts` for the
 * merge itself.
 */
export interface AmendmentTaActivity {
  id: string;
  amendment_id: string;
  /**
   * THE ANCHOR (0481) — the 0446 pattern, a second time.
   *
   * Minted client-side, never shown, never edited, ROUND-TRIPPED BY THE FORM.
   * It is the only thing about this row that survives a save: `id` is re-minted
   * by the reinsert and `sno` is renumbered by the normalizer, so a completion
   * entered on the dashboard can be carried across by nothing else.
   *
   * Not nullable, unlike `mbaProcessInput.row_uid`, which is optional so an
   * older client cannot fail to save. This table has no older client — it is
   * created today — and the failure modes are not comparable: a lost anchor
   * there leaves a findable orphan challan line, a lost anchor here loses a
   * completion invisibly.
   */
  row_uid: string;
  /** Execution order — Fabric Plan first, Shipment last. Dense, 1..n on save. */
  sno: number;
  /** The `ta_activities` master row (0035 · 0266). The Dept column is read
   *  THROUGH this, off `ta_activities.department` — never copied onto the row,
   *  which would be a second answer that goes stale when the master is edited. */
  activity_id: string | null;
  /**
   * Working days this step needs, counted back from the step after it.
   *
   * NULL IS NOT ZERO. A row the grid seeded and nobody has filled in is legal,
   * and `backwardSchedule` already refuses it BY NAME ("Knitting: enter how
   * many days it needs"). Treating it as 0 would collapse two steps onto one
   * date and the plan would still look complete.
   */
  days_required: number | null;
  /**
   * The date this step must be COMPLETE by. STORED, not derived — the one place
   * in this module that breaks the house rule, because the daily dashboard asks
   * Postgres "what is due today across every open order" and a working-day
   * ladder with a holiday set is not a question SQL can answer.
   *
   * Safe only because the screen and the server action resolve it through the
   * SAME `orderTaLadder()`: both halves or neither, the rule `purchase_qty`
   * already follows.
   */
  target_date: string | null;
  /** Entered on the DASHBOARD. Carried across a save by `row_uid`. */
  actual_date: string | null;
  /** `pending` | `in_progress` | `done`. Set on the dashboard; the values are
   *  `ta_plan_activities`' (0401) verbatim, one spelling of one state machine. */
  status: string;
  notes: string | null;
}

/**
 * A document attached to the order (0416) — the style JPG, the buyer's original
 * PDF order sheet, a shade card.
 *
 * ## THE BYTES ARE NOT HERE
 *
 * `storage_path` is the key inside the PRIVATE `garment-order-docs` bucket,
 * never a URL. A signed URL expires, so a stored one gives a row that reads
 * correctly today and 404s next week — 0416's own words. Reads go through
 * `createSignedUrl`; `getPublicUrl` would hand the buyer's prices to anyone
 * holding the link, forever, with no login.
 *
 * ## `doc_kind` IS THE COMPONENT'S TYPE, IMPORTED
 *
 * `AttachmentKind` in `components/ui/file-attachments.tsx` already names the
 * three values, and the CHECK constraint names them a third time. Re-declaring
 * them here would be a fourth place for the same list to drift — the failure
 * `style_processes` above records for `ProcessKind` and solves the same way.
 */
export interface AmendmentFile {
  id: string;
  amendment_id: string;
  sno: number;
  doc_kind: AttachmentKind | null;
  file_name: string | null;
  /** The path WITHIN the bucket. Never a URL — see above. */
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  /**
   * WHICH STYLE LINE THIS DOCUMENT BELONGS TO (0479) — by the operator's own
   * reference, the same key the sizes, components, coordinates and pack
   * components are filed under, compared through `styleKey()`.
   *
   * NOT an id and not an ordinal: `writeChildren` deletes and reinserts the
   * styles wholesale on every save so a uuid does not survive one, and
   * `normalizeStyles` re-numbers `sno` by position so a file keyed to "style 2"
   * would silently follow the wrong garment the moment a line above it was
   * removed. The migration header spells both out.
   *
   * NULL is a document filed against the ORDER rather than a garment — which is
   * what every row saved before 2026-08-31 is, since the field lived on the
   * header until then. It is a real state, not a missing answer.
   */
  style_ref_no: string | null;
  created_at: string;
}

/**
 * Quantities tab (0398) — how the order's quantity splits across countries,
 * consignees and delivery dates.
 *
 * `style_ref_no` + `style_no` are the Orders module key, carried as TEXT like
 * every sibling child table; see the migration header for why this is not a
 * `garment_styles` FK.
 */
export interface AmendmentQuantity {
  id: string;
  amendment_id: string;
  sno: number;
  country_id: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  consignee_id: string | null;
  assortment_type_id: string | null;
  /**
   * WHICH PACKING METHOD THIS DESTINATION SHIPS (0473), BY VALUE — matches a
   * `pack_types` row, which `uq_goa_pack_types_method` makes unique.
   *
   * NOT the same question as `assortment_type_id` beside it: that says whether
   * the cartons are solid or assorted, this says what one box HOLDS. Naming a
   * method turns the size cells into BOX COUNTS and derives the colourway rows
   * from the method's composition — see `is_pack_row` on the assort line.
   *
   * NULL is a real answer: the destination is not packed to a declared method
   * and its size cells are ordinary piece counts, exactly as before 0473.
   */
  pack_type: string | null;
  /**
   * The buyer PO this destination belongs to (0427), asked only while the
   * header's `multi_order` is on. Null on every single-PO order, where the
   * header's own `po_no` answers for the whole document — see the migration.
   */
  po_no: string | null;
  po_qty: number;
  delivery_date: string | null;
  earlier_shipment_date: string | null;
  warehouse_id: string | null;
  discharge_port_id: string | null;
  // ---- the Assort overlay's header (0414) ----
  // One-to-one with this row, so they live ON it rather than in a header table
  // that could only ever have exactly one match. Master/Inner Carton and Pack
  // Description were withdrawn from the amendment HEADER on 2026-08-10, where
  // they were one answer for a whole order; legacy asks them per ASSORTMENT,
  // which is what a quantity row is.
  pack: string | null;
  /** The "Ratio" toggle — true means the size cells are a per-carton ratio. */
  is_ratio_wise_pack: boolean;
  /** 'master' | 'inner' — which carton the ratio is per (0328's tuple). */
  ratio_for: string | null;
  is_single_style_pack: boolean;
  master_carton_name: string | null;
  inner_carton_name: string | null;
  pack_description: string | null;
  /** The Assortments grid — one line per combo. */
  assort_lines: AmendmentAssortLine[];
}

/**
 * Quantities ▸ Assort ▸ one line of the Assortments grid (0414).
 *
 * `pcs_per_pack` is DELIBERATELY ABSENT — it is the sum of the line's size
 * cells (the pieces in one carton), so a field for it would be a second source
 * of truth for an addition. Same rule `gsmRange` follows on the Combos overlay.
 */
export interface AmendmentAssortLine {
  id: string;
  quantity_id: string;
  sno: number;
  /**
   * WHICH STYLE THIS LINE PACKS, BY VALUE (0433) — the Multiple Style half of
   * the Single / Multiple switch on the quantity row. Same reason `combo` is
   * text: `writeChildren` reinserts every Styles Details row on each save, so
   * an FK to one would dangle.
   *
   * NULL on a Single Style pack, and that is not "not filled in yet" — it is
   * the line saying it INHERITS the destination's style. Copying the parent's
   * ref down would go stale the moment that ref was edited.
   */
  style_ref_no: string | null;
  /** The colourway, BY VALUE — a combo row's id is rewritten on every save. */
  combo: string | null;
  no_of_cartons: number;
  /** Ratio bundles per carton — the third factor of Solid Colour / Assort Size's
   *  `cartons x inners x ratio` (0432). Ignored by a Solid / Solid line, which
   *  has no ratio and no knowable carton count. */
  inners_per_carton: number;
  /**
   * THIS LINE'S SIZE CELLS ARE BOXES, NOT PIECES (0473).
   *
   * One box holds every colourway at once, so the count of boxes is a property
   * of the SIZE — asking it once per colourway row would let the operator type
   * 100 against WHITE and 90 against BLACK for one size and silently mean two
   * different pack counts for one physical carton. So one line per style
   * carries the boxes and every colourway line beneath it carries the pieces
   * those boxes explode into.
   *
   * DECLARED, NOT INFERRED. "The line with no combo" is already a legal state
   * on a Single Style pack (0433), so reading the flag off a null combo would
   * make two different things indistinguishable in the table.
   */
  is_pack_row: boolean;
  sizes: AmendmentAssortLineSize[];
}

/** Quantities ▸ Assort ▸ one size cell of one line (0414). */
export interface AmendmentAssortLineSize {
  id: string;
  line_id: string;
  /** `config_lookups` kind 'size' — the same rows 0407 names per style. */
  size_id: string | null;
  /** An explicit 0 is meaningful: "this carton has no XL". */
  qty: number;
}

/** Country/Sizewise tab — a style + countrywise flag row. */
export interface AmendmentCountrySize {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  countrywise: boolean;
}

export interface GarmentOrderAmendment {
  id: string;
  code: string | null;
  is_draft: boolean;
  // order header
  sales_order_id: string | null;
  amend_date: string;
  initiated: string | null;
  amend_type: string | null;
  /** The Customer master row this order is for (0404). Was `buyer_id`. */
  customer_id: string | null;
  po_no: string | null;
  po_date: string | null;
  merchandiser_id: string | null;
  season: string | null;
  amend_year: number | null;
  delivery_date: string | null;
  excess_pct: number;
  pack: boolean;
  /**
   * RETAIL SET PACKAGING (0467) — this order is SOLD in packs and booked in
   * pack counts, while the factory still makes pieces.
   *
   * NOT `pack` above, which is CARTON sortation and gates the Pack type(s)
   * section. The two are independent: a 3-pack of bodysuits is still shipped in
   * cartons, and those cartons are still either solid-size or assorted. One
   * boolean cannot answer both.
   */
  is_set_pack: boolean;
  /**
   * MULTI STYLE — this PO carries more than one style line.
   *
   * The column keeps the legacy `Mult.Ord` name and the UI says "Multi Style"
   * (client 2026-08-17). What it has always meant here is the number of STYLES:
   * it captions the Style(s) grid and `addStyle` sets it when a second line is
   * added. Renaming the column would rewrite a value every stored row already
   * carries a meaning for, for a label fix — see 0427.
   */
  mult_ord: boolean;
  /** MULTI ORDER — several buyer PO numbers on this one order (0427). Opens the
   *  PO No column on the Quantities tab. Not `mult_ord`; see it above. */
  multi_order: boolean;
  // logistic scalars
  department_id: string | null;
  ship_type_id: string | null;
  contact_id: string | null;
  logi_po_date: string | null;
  agent_id: string | null;
  ship_mode: string | null;
  country_id: string | null;
  currency_code: string | null;
  received_date: string | null;
  received_mode: string | null;
  pay_mode: string | null;
  pay_terms_id: string | null;
  /** Which Garment Rejection Rule supplies Approval Qty's Projection (0413). */
  rejection_rule_id: string | null;
  /** The Style Quotation this order was raised from (0511) — provenance, and
   *  the handle "Copy From SQ No" reaches the fabric estimation through. NULL
   *  for an order booked straight off a customer PO, which is the usual case. */
  sq_detail_id: string | null;
  ex_rate: number;
  avg_rate: number;
  gross_value: number;
  // cash discount
  cd1_pct: number;
  cd1_days: number;
  cd2_pct: number;
  cd2_days: number;
  cd3_pct: number;
  cd3_days: number;
  // reason ("Amendment In" panel)
  amend_in_material_bom: boolean;
  amend_in_fabric_bom: boolean;
  amend_in_garment_process_bom: boolean;
  reason_text: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  sales_order?: { id: string; order_number: string | null; location_id: string | null } | null;
  customer?: { id: string; code: string | null; name: string } | null;
  charges: AmendmentCharge[];
  style_prices: AmendmentStylePrice[];
  styles: AmendmentStyle[];
  style_sizes: AmendmentStyleSize[];
  style_coordinates: AmendmentStyleCoordinate[];
  /** Retail SET pack members (0467), keyed off the styles like the four above. */
  pack_components: AmendmentPackComponent[];
  style_components: AmendmentStyleComponent[];
  style_processes: AmendmentStyleProcess[];
  dyeings: AmendmentDyeing[];
  prints: AmendmentPrint[];
  structures: AmendmentStructure[];
  combos: AmendmentCombo[];
  price_details: AmendmentPriceDetail[];
  approval_qtys: AmendmentApprovalQty[];
  pack_types: AmendmentPackType[];
  /** What each pack type packs (0472), keyed off `pack_types` by text. */
  pack_type_lines: AmendmentPackTypeLine[];
  /** The order's Time & Action ladder (0481). Merged on save, never replaced. */
  ta_activities: AmendmentTaActivity[];
  quantities: AmendmentQuantity[];
  country_sizes: AmendmentCountrySize[];
  files: AmendmentFile[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const num = z.coerce.number().default(0);

/**
 * A number that may be genuinely ABSENT — `numN` to `num` as `uuidN` is to a
 * required uuid.
 *
 * **`z.coerce.number().nullable()` DOES NOT DO THIS**, and the way it fails is
 * silent. `coerce` runs `Number(v)` BEFORE the nullability check, and
 * `Number(null)` is `0` and `Number("")` is `0` — so the obvious spelling turns
 * every "not answered" into a confident zero and the `.nullable()` never sees a
 * null to pass through. On `packs_ordered` (0467) that is the difference
 * between "this is not a set pack" and "the buyer ordered no packs", which is
 * exactly the distinction 0467's verify block raises an exception to protect.
 *
 * So the emptiness test happens FIRST, in a preprocess, and only a value that
 * survives it is coerced.
 */
const numN = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().nullable(),
);

// ---- Phase 2 (0128) nested grid inputs ----

export const amendmentStyleInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style_id: uuidN,
  // The Style master's header fields, merged onto the order (0461). Season and
  // Year are deliberately NOT among them — see 0462 and the note in
  // `normalizeStyles`.
  approved_sample_id: uuidN,
  article_no: nullableText,
  // The name and the row it resolves to. See `AmendmentStyle` above: the id is
  // the truth, the text is a cache, both written from one event.
  style_category: nullableText,
  style_category_id: uuidN,
  style_description: nullableText,
  order_unit_id: uuidN,
  plan_unit_id: uuidN,
  /* ORDER UNIT (0471). An ENUM, not `nullableText`, and that is the half the
     DB check cannot cover on its own: the stored words are 'piece' / 'set'
     while the operator reads PCS / SET, so the display word is the likeliest
     thing to arrive from a caller that formats before it saves. Both ends
     refuse it — this and the column's CHECK — because `lib/data-io` writes
     straight to Postgres and the action is not on that path. */
  unit_kind: z
    .enum(["piece", "set"])
    .nullish()
    .transform((v) => v ?? null),
  po_qty: num,
  /* PACKS, beside the piece count (0467). `numN` and not `num`: NULL is "not a
     set pack", 0 is "zero packs ordered", and coercing the first to the second
     would make every existing order claim it ordered none. */
  packs_ordered: numN,
  description: nullableText,
});

/**
 * Order Info ▸ Styles Details ▸ Pack Composition (0467).
 *
 * Flat and keyed by `style_ref_no`, the same shape the sizes, the components
 * and the coordinates take — the screen nests these under their style row and
 * flattens on submit.
 */
export const amendmentPackComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  coordinate_id: uuidN,
  /* BY VALUE, and capsed like every other stored value. A combo's id is
     rewritten by each `writeChildren` pass (0413 / 0433). */
  combo: capsTextNullable(),
  qty_per_pack: num,
});

/**
 * Order Info ▸ Styles Details ▸ Coordinates (0461).
 *
 * Flat and keyed by `style_ref_no`, the same shape the sizes and the components
 * take — the screen nests these under their style row and flattens on submit.
 */
export const amendmentStyleCoordinateInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  coordinate_id: uuidN,
});

/**
 * One size of one style line (0407).
 *
 * `style_ref_no` is the row's only link to its style, so it is part of the
 * INPUT rather than something the action derives — the screen knows which style
 * a size sits under and nothing downstream could work it out afterwards.
 *
 * NOT CAPSED. `capsName()` would be wrong twice over: the value here is a uuid,
 * not a name, and the names it resolves to are numeric on this very screen
 * ("2", "3", "14"). The CAPITALS rule reaches the size WORD where it is typed —
 * on the `config_lookups` row itself — not where it is referenced.
 */
export const amendmentStyleSizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  size_id: uuidN,
});

/**
 * Order Info ▸ Styles Details ▸ Components (0457).
 *
 * Flat and keyed by `style_ref_no`, the same shape `amendmentStyleSizeInput`
 * takes and for the same reason — the screen nests these under their style row
 * and flattens on submit.
 *
 * `comp_type` and `item_id` are here even though neither has a cell. Both are
 * carried through so the seed from `garment_style_components` can round-trip
 * them; leaving them out would let a save NULL a value the master stated, which
 * is what `writeChildren`'s wholesale rewrite does to anything absent from the
 * payload.
 */
export const amendmentStyleComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  coordinate_id: uuidN,
  component_id: uuidN,
  fabric_category_id: uuidN,
  comp_type: nullableText,
  item_id: uuidN,
});

export const amendmentDyeingInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  section: z.enum(["yarn", "fabric"]).default("yarn"),
  dye_type: nullableText,
  // CAPS (AGENTS.md, STANDING). The transform lives in the ZOD SCHEMA, not
  // in the action: `lib/data-io` parses imports with these same *Input
  // schemas and writes straight to Postgres, so an action-level
  // `.toUpperCase()` would silently miss every spreadsheet import. The
  // `<Input uppercase>` on the Colour cell is the other required half — it
  // catches the keystroke AND adds the CSS transform that reaches rows
  // saved before this rule.
  //
  // `dye_type` beside it is deliberately NOT capsed here: it is
  // pre-existing and unrequested, and capping it would visually uppercase
  // values already stored in lowercase. Flagged, not folded in.
  color_name: capsTextNullable(),
  /**
   * STILL IN THE SCHEMA THOUGH NOTHING ON SCREEN SETS IT (0403). Unlike the
   * withdrawn HEADER fields above, a child grid is deleted and reinserted
   * wholesale by `writeChildren` — so a field dropped from this input is
   * nulled on the next save rather than frozen. Keeping it is what makes the
   * freeze real.
   */
  color_id: uuidN,
});

export const amendmentPrintInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  /**
   * THE VALUE, AND THE ONE THE SCREEN WRITES (0477). `print_id` below is set
   * only when the operator picked a master row; this is filled either way.
   *
   * CAPS (AGENTS.md, STANDING) — and in the ZOD, not in the action, for the
   * reason `amendmentDyeingInput.color_name` states beside it: `lib/data-io`
   * parses with these same `*Input` schemas and writes straight to Postgres, so
   * an action-level `.toUpperCase()` misses every path that does not go through
   * the action. The `<TypeOrPick uppercase>` on the cell is the other half — it
   * catches the keystroke and adds the CSS transform that reaches rows saved
   * before this rule.
   */
  print_name: capsTextNullable(),
  /**
   * KEPT BESIDE THE NAME, never replaced by it. `writeChildren` deletes and
   * reinserts this grid wholesale, so a field dropped from this input is NULLED
   * on the next save of every order carrying one — the same argument
   * `amendmentDyeingInput.color_id` records. It is also what lets
   * `declaredPrintOptions` still narrow the Combos tab's list to the prints this
   * order picked.
   */
  print_id: uuidN,
});

export const amendmentStructureInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  structure_id: uuidN,
  /**
   * Solid / Melange / Yarn Dyed (0415, narrowed 2026-08-31).
   *
   * VALIDATED AGAINST THE ONE VOCABULARY rather than left as free text, because
   * `lib/data-io` parses imports with this schema and writes straight to
   * Postgres — an unchecked string would reach the column and be refused by the
   * CHECK as a raw database error rather than a field-level message. `""` maps
   * to null so a cleared `<Select>` reads as "not answered" and not as an
   * invalid member.
   *
   * `printed` IS GONE, AND THE TUPLE IS NOW EXACTLY `order_fabrics`' THREE
   * VALUES — which is what makes narrowing it safe rather than a way to lock an
   * operator out of a document they can already open. Three things had to be
   * true at once and were, on 2026-08-31: the ORDER side never had a fourth
   * value (0329's CHECK), so a seeded amendment cannot arrive holding one; the
   * catalog holds 0 rows with `printed` in either amendment table, so no saved
   * document parses differently today; and 0480 tightened both CHECKs, so
   * nothing can write one from here on. Had any live row held it, the honest
   * move would have been `nullableText` and a screen that shows the stale value
   * — the reasoning `RECEIPT_MODES` records — not a schema that refuses to open
   * the record.
   */
  item_sub_type: z
    .enum(["solid", "melange", "yarn_dyed"])
    .nullable()
    .or(z.literal("").transform(() => null))
    .default(null),
});

/**
 * Combos ▸ Detail ▸ a garment part (0408).
 *
 * CAPS on `color_name`: it is a field VALUE stored in capitals (AGENTS.md,
 * STANDING), and the transform belongs in the schema
 * rather than the action because `lib/data-io` parses imports with these same
 * `*Input` schemas and writes straight to Postgres. `color_name` matches
 * `amendmentDyeingInput.color_name`, which it is meant to agree with.
 */
export const amendmentComboComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate_id: uuidN,
  component_id: uuidN,
  color_name: capsTextNullable(),
  print_id: uuidN,
  processed_as_trim: z.boolean().default(false),
});

/**
 * Combos ▸ Detail ▸ a fabric structure (0408 · 0409).
 *
 * NESTED, and the nesting is load-bearing: `structure_id` on a component is a
 * uuid the database assigns during THIS save, so a flat sibling array would
 * have nothing to point at. `writeComboTree` inserts the three levels in order
 * and resolves each level's ids from the one above.
 *
 * The two enums are NOT `z.enum`. Both columns carry a SQL check, and a stored
 * value that stops matching the tuple must render as a stale value the operator
 * can see and re-pick rather than a parse error on a document they are trying
 * to open — the reasoning RECEIPT_MODES records above.
 */
export const amendmentComboStructureInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  structure_id: uuidN,
  fabric_type: nullableText,
  composition_id: uuidN,
  gsm: z.coerce.number().nullable().default(null),
  gsm_tolerance: z.coerce.number().nullable().default(null),
  item_sub_type: nullableText,
  /**
   * "Yarn Color" — the colours of the pre-dyed yarns this cloth is knitted
   * from (client 2026-08-31, 0480). See `AmendmentComboStructure.yarn_colors`
   * for why it is a property of the CLOTH rather than of a part.
   *
   * CAPS IN THE SCHEMA, NOT IN THE ACTION, for the reason `print_name` states
   * above and AGENTS.md states under CAPITALS: `lib/data-io` parses imports
   * with these same `*Input` schemas and writes straight to Postgres, so an
   * action-level `.toUpperCase()` misses every path that does not go through
   * the action.
   *
   * NOT A SHARED `capsList()` IN `lib/validation/formats.ts`, deliberately.
   * That file holds the SCALAR pair `capsName` / `capsTextNullable`, and this
   * is the only array-valued text column in the app today — a shared helper
   * with exactly one caller is a guess at a shape rather than a rule three
   * callers share, which is the test AGENTS.md actually applies. Two of the
   * four steps below are also specific to a TICK LIST rather than to capitals
   * (see the ordering note), so promoting this wholesale would export those
   * decisions to a field that has not made them. The moment a second array
   * column needs it, move these five lines there and let both call it.
   *
   * TRIM → UPPER → DROP BLANKS → DE-DUPE, IN THAT ORDER. The cell is a tick
   * list over `yarnColourOptions`, whose options are already trimmed and
   * upper-cased, so a value that skipped either step would render as an
   * unticked box beside an identical ticked one — the same colour offered
   * twice, which is the near-miss defect one door along. `""` ticks nothing
   * and goes; a repeat is one colour stated twice and goes, because the column
   * is a SET.
   *
   * THE OPERATOR'S ORDER IS KEPT. `yarnColourOptions` offers the colourways in
   * the order the Combos grid lists them, so re-sorting here would make the
   * stored value disagree with the list it was picked from. The diff sorts for
   * its OWN comparison instead (`joinYarnColours` in diff.ts), which is where
   * "re-ordering is not a change" belongs — a store that sorted would make the
   * two indistinguishable and lose the operator's order for nothing.
   */
  yarn_colors: z
    .array(z.string())
    .default([])
    .transform((xs) => {
      const out: string[] = [];
      for (const x of xs) {
        const v = x.trim().toUpperCase();
        if (v && !out.includes(v)) out.push(v);
      }
      return out;
    }),
  components: z.array(amendmentComboComponentInput).default([]),
});

export const amendmentComboInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  combo: capsTextNullable(),
  combo_description: capsTextNullable(),
  structures: z.array(amendmentComboStructureInput).default([]),
});

export const amendmentPriceDetailInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  price_type: nullableText,
  // NOT validated against the mode. "Color-wise implies a combo" is true of a
  // FINISHED row and false of one being filled in, and a schema that enforced
  // it would reject the save instead of letting the grid say what is missing —
  // the same reason 0416 puts no CHECK on the columns. `styleRate` is where the
  // pairing is judged, because the Save button and the Order Sheet both ask it.
  combo: nullableText,
  size_id: uuidN,
  unit: nullableText,
  price: num,
});

export const amendmentApprovalQtyInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  /* The colour breakdown (0413). Not capsed here: `combo` is copied from the
     Combos tab, which is where the value is typed and where the CAPITALS rule
     reaches it — capsing a COPY would let the two disagree if that rule ever
     changed on one side. */
  combo: nullableText,
  combo_description: nullableText,
  /* The size axis (0435). Nullable for the same reason `combo` is: a seeded
     legacy order has neither, and refusing the row would drop a real approval
     quantity rather than carry it. */
  size_id: uuidN,
  qty: num,
  approval_qty: num,
});

/**
 * NOT `z.enum(PACK_TYPE_OPTIONS)`. The column has no CHECK for the reason given
 * above, and a Zod enum here would put the constraint back one layer up — a
 * document saved under an older wording would fail validation on every save,
 * with a message naming a field the operator cannot see is wrong. Same
 * reasoning as `price_type`, which is `nullableText` beside it.
 */
export const amendmentPackTypeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  pack_type: nullableText,
});

/**
 * One line of a pack type's detail grid (0472).
 *
 * `pack_type` IS THE PARENT KEY AND IS PLAIN TEXT, so it is `nullableText` like
 * every other by-value binding here (`style_ref_no`, `combo`). A line whose
 * method has since been renamed is dropped on save by `normalizePackTypeLines`
 * rather than refused by validation — the same call `normalizeStyleSizes`
 * makes for a size whose style line is gone.
 *
 * `qty` is `num`, so a blank box saves as 0 rather than failing. A pack type
 * line the operator started and left unquantified is a row mid-answer, which is
 * the rule every child input on this document follows.
 */
export const amendmentPackTypeLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  pack_type: nullableText,
  style_ref_no: nullableText,
  style: nullableText,
  combo: nullableText,
  qty: num,
});

/**
 * One activity of the order's Time & Action ladder (0481).
 *
 * ## THIS INPUT IS DELIBERATELY NARROWER THAN THE ROW
 *
 * `AmendmentTaActivity` has nine data columns. Four of them are here. The five
 * that are missing are missing ON PURPOSE, and the omission is the safety
 * property rather than an oversight:
 *
 *   * `target_date` is COMPUTED BY THE SERVER, by the same `orderTaLadder()`
 *     the screen renders from. Accepting it on the input would let a client
 *     state an opinion about a value the server also decides — two answers to
 *     one question, which is exactly the failure "BOTH HALVES OR NEITHER" names.
 *     Leaving it off means the client CANNOT disagree, which is a stronger
 *     guarantee than agreeing.
 *
 *   * `actual_date`, `status` and `notes` BELONG TO THE DASHBOARD. They are
 *     entered days or weeks after the order was saved, by someone else, on
 *     another screen. `writeChildren` deletes and reinserts every child row, so
 *     they are carried across a save by `row_uid` — from the DATABASE, never
 *     from the payload. Off the input, a stale form cannot carry a completion
 *     value at all, so the merge has nothing to prefer and no order in which to
 *     prefer it. Accepting them and then ignoring them would work today and
 *     stop working the first time somebody "fixed" the writer to honour them.
 *
 *   * `id` is re-minted by the reinsert. `row_uid` is the identity here.
 *
 * ## `row_uid` IS REQUIRED, AND `mbaProcessInput`'s IS NOT
 *
 * That difference is deliberate. 0446 made its anchor optional so "a payload
 * from an older client cannot fail to save — it produces a visibly
 * un-dispatched row instead", and there the worst case is a findable orphan
 * challan line. Here the worst case is a completion record deleted with nothing
 * on screen to say so. This table is created today, so there is no older client
 * to protect; requiring the anchor turns the dangerous silent case into a loud
 * one-edit failure.
 *
 * `days_required` is `numN`-shaped and NOT bounded here. A negative or absent
 * lead time is refused by `backwardSchedule`, which names the ROW — "Knitting:
 * enter how many days it needs" — where a Zod bound would say "Number must be
 * greater than or equal to 0" against a ladder of ten identical-looking boxes.
 * The whole-number constraint IS enforced here, because the column is `int` and
 * Postgres would silently round 2.5 to 2 rather than complain.
 */
export const amendmentTaActivityInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  row_uid: z
    .string()
    .uuid(
      "Every T&A row needs its anchor — reload the order rather than saving a " +
        "form that has lost one, or the completions already recorded against it " +
        "cannot be matched back.",
    ),
  activity_id: uuidN,
  days_required: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().int("Days must be a whole number of days").nullable(),
  ),
});

/**
 * One attached document (0416).
 *
 * `doc_kind` is nullable because the operator picks it AFTER the file lands —
 * the upload is immediate and the kind is a `<Select>` on the row. A row
 * mid-answer is not an error, which is the rule every child input here follows;
 * `not null` would turn "not chosen yet" into a 23502 on save.
 *
 * The enum is stated as a Zod literal union rather than imported, because
 * `AttachmentKind` is a TYPE and Zod needs values. `satisfies` is what keeps the
 * two from drifting: widen the component's union and this stops compiling.
 */
export const amendmentFileInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  /**
   * The style this document belongs to (0479). `nullableText`, and NOT
   * `capsTextNullable()` — it must match `garment_order_amendment_styles.
   * style_ref_no`, which is `nullableText` too, and a key capsed on one side of
   * a join and not the other is a join that stops matching. `styleKey()` is what
   * folds the case, on both sides, at comparison time.
   */
  style_ref_no: nullableText,
  doc_kind: z
    .enum(["sketch", "order_sheet", "approval"] satisfies readonly AttachmentKind[])
    .nullable()
    .default(null),
  file_name: nullableText,
  storage_path: nullableText,
  mime_type: nullableText,
  size_bytes: z.coerce.number().nullable().default(null),
});

/**
 * Quantities ▸ Assort ▸ one size cell (0414).
 *
 * `qty` is NOT dropped when zero. A ratio saying "no XL in this carton" is a
 * real statement; the normalizer drops a cell with no SIZE, never one with no
 * quantity.
 */
export const amendmentAssortLineSizeInput = z.object({
  size_id: uuidN,
  qty: num,
});

/** Quantities ▸ Assort ▸ one line of the Assortments grid (0414). */
export const amendmentAssortLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  /**
   * Which style this line packs (0433) — NOT capsed, the same call
   * `amendmentStyleSizeInput` above makes and for the same reason: this is a
   * REFERENCE to a ref typed on the Styles Details grid, and the CAPITALS rule
   * reaches a value where it is typed, not where it is named again. All eight
   * other `style_ref_no` inputs in this file are `nullableText`; capsing the
   * ninth would be the odd one out, and the join does not need it — `styleKey()`
   * normalises both sides precisely because rows predating the rule are mixed
   * case.
   */
  style_ref_no: nullableText,
  // CAPS: a colourway name is a field VALUE stored in capitals, and it must
  // match `amendmentComboInput.combo`, which it references by value.
  combo: capsTextNullable(),
  /**
   * THIS LINE HOLDS BOXES (0473). Defaults to false, so every line written by
   * an importer, and every line stored before this column existed, stays a
   * PIECES line — the direction that cannot rewrite a saved quantity.
   */
  is_pack_row: z.boolean().default(false),
  no_of_cartons: num,
  /**
   * DEFAULTS TO 1, NOT 0 (0432) — the one number here that is a MULTIPLIER
   * rather than a term. `num` would default it to zero and zero the line's
   * whole quantity, so a document saved by an importer that never heard of
   * inners would read as an order for nothing. One inner per carton is the
   * plain `cartons x ratio` reading every row written before 0432 has.
   *
   * `.catch(1)` covers the other half `.default()` cannot: a default only fires
   * on `undefined`, while `z.coerce.number()` turns "" into 0 — and an empty box
   * on screen is the likeliest way this arrives.
   */
  inners_per_carton: z.coerce.number().positive().default(1).catch(1),
  sizes: z.array(amendmentAssortLineSizeInput).default([]),
});

export const amendmentQuantityInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  country_id: uuidN,
  style_ref_no: nullableText,
  style_no: nullableText,
  consignee_id: uuidN,
  assortment_type_id: uuidN,
  /** Which pack type(s) method this destination ships (0473). */
  pack_type: nullableText,
  /* CAPSED SINCE 2026-08-31, and the reason it was not is the reason it now is.
     This comment used to say `nullableText`, NOT `capsTextNullable()`, "because
     the HEADER's `po_no` is `nullableText` below — capsing one of the two would
     let the same buyer reference read two ways depending on which switch was on
     when it was typed." That premise is gone: the header's PO No became
     `requiredKind("doc_ref")` in the same change, whose transform is `upper`.
     Leaving this one alone would have created the very divergence the old note
     was written to avoid, one switch the other way.
     It stays OPTIONAL and free-form in SHAPE. Blank on a row is the normal case
     — it inherits the header's PO (`lib/orders/po-no.ts`) — and applying the
     alphanumeric rule here would refuse values already stored in this grid for a
     requirement the client stated about the header field. See the header's own
     `po_no` for the open question that leaves. */
  po_no: capsTextNullable(),
  po_qty: num,
  // Dates are plain ISO strings here, as everywhere in this module — the input
  // is `<input type="date">`, whose value is always ISO regardless of the
  // browser's display locale.
  delivery_date: nullableText,
  earlier_shipment_date: nullableText,
  warehouse_id: uuidN,
  discharge_port_id: uuidN,
  // ---- the Assort overlay (0414) ----
  pack: capsTextNullable(),
  is_ratio_wise_pack: z.boolean().default(false),
  ratio_for: nullableText,
  is_single_style_pack: z.boolean().default(false),
  master_carton_name: capsTextNullable(),
  inner_carton_name: capsTextNullable(),
  pack_description: capsTextNullable(),
  /**
   * NESTED, and the nesting is load-bearing: a line's `quantity_id` is a uuid
   * the database assigns during THIS save, so a flat sibling array would have
   * nothing to point at. `writeAssortTree` inserts the levels in order and
   * resolves each from the one above.
   */
  assort_lines: z.array(amendmentAssortLineInput).default([]),
});

export const amendmentCountrySizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  countrywise: z.boolean().default(false),
});

export const amendmentInput = z.object({
  is_draft: z.boolean().default(false),
  // order header
  /**
   * THE SC NO IS MINTED, NOT PICKED (client 2026-08-11).
   *
   * This was `z.string().uuid("Select the SC No")` while the screen's SCNo was a
   * dropdown of orders that already existed — which is amendment behaviour. It
   * is the garment order ENTRY screen, so its SC No is its own identity and the
   * operator cannot supply it: `createAmendment` creates the `sales_orders` row,
   * the 0395 trigger numbers it, and the id comes back here.
   *
   * Null on CREATE, always set afterwards. `location_id` below carries the
   * requiredness this field used to carry — see its note for why it has to.
   */
  sales_order_id: z.string().uuid().nullable().default(null),
  /**
   * NOT A COLUMN on `garment_order_amendments` — `headerOnly()` strips it. It
   * exists to reach `sales_orders.location_id`, and it is mandatory because
   * 0395 numbers per (location, fiscal year): `assign_order_number()` refuses a
   * blank one rather than invent a shared bucket, so without this the insert
   * fails with a raw `23502` instead of a message the operator can act on.
   *
   * This is where SCNo's old requiredness went. A `readOnly` field never holds
   * the cursor (AGENTS.md, "Mandatory fields"), so an auto SC No cannot carry a
   * `*` — the rule is to require its SOURCES instead, exactly as a composed
   * name does.
   *
   * NULLABLE HERE, REQUIRED WHERE IT IS ACTUALLY NEEDED — inside
   * `createAmendment`, on the branch that mints a number. Typed non-nullable it
   * would cage the operator on an EDIT: a document whose order predates the
   * per-location numbering has `sales_orders.location_id` null, the field is
   * read-only once saved, and the record would fail validation on every save
   * with nothing on screen they could change. Requiring a value that only the
   * create path consumes is the "requiring a hidden field" failure AGENTS.md
   * names, one step removed.
   */
  location_id: z.string().uuid().nullable().default(null),
  amend_date: z.string().min(1, "Date is required"),
  // 0404: points at `customers`, the master the business maintains — not the
  // scaffold's `buyers`, which offered demo rows and could not reach ASMARA /
  // OXBOW at all. Renamed as well as repointed; a `buyer_id` holding a customer
  // uuid is the FK landmine 0355 and 0375/0376 were written to clear up.
  customer_id: z.string().uuid("Customer is required"),
  /**
   * MANDATORY, AND SHAPED LIKE A DOCUMENT REFERENCE (client 2026-08-31: "PO No
   * strictly mandatory … accepts alphanumeric values only"; widened by the user
   * the same day to permit `-` and `/`, which is what a real PO number is built
   * from — `DOC_REF_RE` records that exchange and the evidence that decided it).
   *
   * `requiredKind` and not a hand-rolled `.min(1).regex()`, because the kind
   * carries four things the regex alone does not: the message wording the
   * `<ValidatedInput>` shows, the `transform: "upper"` that makes this the
   * CAPITALS half as well, the same normalise-then-validate order every other
   * format uses, and one place to change the rule. The write-side transform
   * belongs HERE rather than in the action for the standing reason — the action
   * is not the only write path.
   *
   * ## THE SHAPE RULE IS NOT ON THE ROW-LEVEL PO, AND THAT IS NOT AN OVERSIGHT
   *
   * `amendmentQuantityInput.po_no` above is the SAME buyer reference, one grain
   * down, and it stays free text. The client's instruction was about this field;
   * tightening the grid cell would additionally refuse values already stored in
   * it — and a row PO is optional by design (blank inherits the header's), so
   * there is no mandatory half to go with it. The two are capsed alike, so they
   * cannot disagree on case.
   *
   * The widening narrowed that gap rather than closing it: `PO-1000` is now
   * legal at BOTH levels, so the divergence is no longer "the header refuses
   * what the row accepts" for any shape an operator is likely to type. What
   * remains is that the row would still accept a space or a comma. Left as an
   * open question for the client rather than decided here.
   */
  po_no: requiredKind("doc_ref", "PO No is required"),
  po_date: nullableText,
  /**
   * MANDATORY, and an `employees` row rather than a login since 0478.
   *
   * Stated the same way `customer_id` is, three lines up: a `uuid()` whose
   * message is the requirement. `uuidN` would have accepted null, and a field
   * carrying a red `*` that the server then saves empty is the star/hold
   * divergence AGENTS.md's "one declaration, four enforcers" exists to make
   * impossible.
   *
   * This is where the requirement is ENFORCED. The column is deliberately left
   * nullable (0478) so an order that predates the rule fails with this sentence
   * rather than a 23502 naming a column the operator never touched.
   */
  merchandiser_id: z.string().uuid("Merchandiser is required"),
  season: nullableText,
  // `amend_year` WITHDRAWN 2026-08-14 (client): the year is already on the
  // linked Style Master, so the order asked for it twice. Its COLUMN and stored
  // values remain — and it left this input, which is the half that stops an
  // update writing NULL over them. Row type keeps `amend_year` so a saved value
  // still loads and still shows anywhere that reads the record.
  delivery_date: nullableText,
  excess_pct: num,
  pack: z.boolean().default(false),
  /* 0467 — retail SET packs. Independent of `pack`; see the header type. */
  is_set_pack: z.boolean().default(false),
  /** MULTI STYLE. The column name is the legacy one — see the row type. */
  mult_ord: z.boolean().default(false),
  /** MULTI ORDER (0427) — several buyer POs, one per quantity line. */
  multi_order: z.boolean().default(false),
  /**
   * WITHDRAWN FROM THE FORM (client), and therefore from this schema.
   *
   * 2026-08-12 — `contact_id`, `logi_po_date`, `received_date` and the whole
   * `style_prices` child, which restated the Prices tab: the Logistic tab is
   * Ship Mode / Ship Type / Pay Mode / Payment Terms / Days / Currency /
   * Country and nothing else. `AmendmentStylePrice` and the `style_prices`
   * EMBED both stay — the read side keeps showing what is stored, exactly as
   * `charges` does; it is only the write side that withdraws.
   * 2026-08-10 — `department_id`, `agent_id`, `received_mode`, the whole
   * `charges` child and `cd1_pct … cd3_days`. 2026-08-11 — `initiated`, the
   * Order Info "Initiated" dropdown, and `amend_type`, its "Type" dropdown
   * (Garment / Fabric / Made-ups: the company only makes garments, so the field
   * had one answer). Their COLUMNS and their stored values are untouched.
   *
   * Leaving them OUT OF THE SCHEMA is the half that matters: a field left here
   * with a `.default()` is written by `headerOnly(p.data)` on every update, so
   * it would null out what it no longer collects. Same reasoning as
   * `commodity_id` in lib/masters/process-types.ts.
   */
  // logistic scalars
  ship_type_id: uuidN,
  ship_mode: nullableText,
  country_id: uuidN,
  currency_code: nullableText,
  pay_mode: nullableText,
  pay_terms_id: uuidN,
  /* NULL is a real state, not a missing answer: an order with no rule chosen
     has no Projection, and every row predating 0413 is in exactly that state. */
  rejection_rule_id: uuidN,
  /* THE QUOTATION THIS ORDER CAME FROM (0511). `uuidN`, so NULL is a real
     answer rather than a missing one — most orders are booked straight off a
     customer PO and never had a quotation. `headerOnly` spreads whatever is not
     a child array, so declaring it here is the whole of the write. */
  sq_detail_id: uuidN,
  ex_rate: num,
  /* NULLABLE SINCE 0417, and calculated rather than typed. `order-value.ts`
     returns null where a style is priced per colour and the rows carry no
     colour column to weight them by — a partial Gross Value reads exactly like
     a correct one, so it refuses instead. `num` here would coerce that null
     back to 0 and reinstate the lie the migration was written to remove. */
  avg_rate: z.coerce.number().nullable().default(null),
  gross_value: z.coerce.number().nullable().default(null),
  // reason ("Amendment In" panel)
  amend_in_material_bom: z.boolean().default(false),
  amend_in_fabric_bom: z.boolean().default(false),
  amend_in_garment_process_bom: z.boolean().default(false),
  reason_text: nullableText,
  // children
  styles: z.array(amendmentStyleInput).default([]),
  style_sizes: z.array(amendmentStyleSizeInput).default([]),
  /**
   * The per-style Coordinate list (0461) — what a component is a part of.
   * Ordered before the components deliberately: it is what scopes their
   * Coordinate cell, and the same order the Style master reads them in.
   */
  style_coordinates: z.array(amendmentStyleCoordinateInput).default([]),
  /* 0467 — flat and keyed by `style_ref_no`, like the coordinates above. */
  pack_components: z.array(amendmentPackComponentInput).default([]),
  /**
   * The per-style Component list (0457) — the Style master's other child,
   * merged into Order Info beside the sizes. Same flat, `style_ref_no`-keyed
   * shape, nested under the style row on screen and flattened on submit.
   */
  style_components: z.array(amendmentStyleComponentInput).default([]),
  /**
   * The per-style Process list (0411). Flat and keyed by `style_ref_no`, the
   * same shape `style_sizes` takes and for the same reason — the screen nests
   * these under their style row and flattens on submit.
   *
   * The schema is imported rather than restated: `style-processes.ts` is
   * client-safe and the picker's narrowing already reads its `ProcessKind`,
   * so declaring the two values a second time here is how a CHECK and a Zod
   * enum drift apart.
   */
  style_processes: z.array(styleProcessInput).default([]),
  dyeings: z.array(amendmentDyeingInput).default([]),
  prints: z.array(amendmentPrintInput).default([]),
  structures: z.array(amendmentStructureInput).default([]),
  combos: z.array(amendmentComboInput).default([]),
  price_details: z.array(amendmentPriceDetailInput).default([]),
  approval_qtys: z.array(amendmentApprovalQtyInput).default([]),
  pack_types: z.array(amendmentPackTypeInput).default([]),
  pack_type_lines: z.array(amendmentPackTypeLineInput).default([]),
  /**
   * The order's Time & Action ladder (0481). MERGED on save rather than
   * replaced — see `amendmentTaActivityInput` for why this list is narrower
   * than the rows it writes, and `normalizeTaActivities` for the merge.
   */
  ta_activities: z.array(amendmentTaActivityInput).default([]),
  quantities: z.array(amendmentQuantityInput).default([]),
  files: z.array(amendmentFileInput).default([]),
})
  /**
   * DELI.DT · SEASON · REJECTION RULE — MANDATORY ON A REAL SAVE, NOT ON A DRAFT
   * (client 2026-08-31).
   *
   * ## WHY A REFINE RATHER THAN CHANGING THE THREE FIELD TYPES
   *
   * Making `delivery_date` a `z.string().min(1)` the way `amend_date` is would
   * require it on a DRAFT too — and `is_draft` exists precisely so an operator
   * can park an order that is not finished yet. The header's other hard-required
   * fields (`customer_id`, `merchandiser_id`) are order IDENTITY: without them
   * there is no order to be a draft OF. A delivery date, a season and a
   * rejection rule are details of a known order, so requiring them at draft time
   * would make "Save as Draft" mean "save a finished draft" — the same sentence
   * the T&A ladder guard used to carry one file over, for the same reason.
   *
   * ## THIS IS THE THIRD OF THREE ENFORCERS AND THE ONLY ONE THAT IS A GUARD
   *
   * The `*` and the cursor hold come from `<Field required>` on the screen, and
   * the blocked Save from `sectionValidity`. Both are courtesies: they run in a
   * browser. This runs in the action, so it is what actually holds when a stale
   * client, a replayed request or a future writer skips the screen — the split
   * `checkDuplicateName` already states ("the screen check is a courtesy; this
   * one is the guard").
   *
   * The messages are the words ON the fields, because they are read out loud by
   * a failed save: "Deli.Dt", not "Delivery Date".
   */
  .superRefine((v, ctx) => {
    if (v.is_draft) return;
    const missing: [keyof typeof v, string][] = [
      ["delivery_date", "Deli.Dt is required"],
      ["season", "Season is required"],
      ["rejection_rule_id", "Rejection Rule is required"],
    ];
    for (const [key, message] of missing) {
      const value = v[key];
      // Blank and whitespace both count as unanswered — a box the operator
      // cleared is not an answer, which is the same test `purchaseStageOrGreige`
      // makes about its own column.
      if (typeof value === "string" ? !value.trim() : value == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key as string], message });
      }
    }
  });
export type AmendmentInput = z.infer<typeof amendmentInput>;

// ============================================================================
// T&A — THE MERGE (0481)
// ============================================================================
/**
 * The two rules that stop a Save destroying the order's completion records,
 * stated ONCE and as PURE FUNCTIONS so they can be proved.
 *
 * ## WHY THESE ARE NOT IN `actions.ts`
 *
 * `writeChildren` deletes every child row and reinserts. For this one table that
 * is not lossless: `actual_date`, `status` and `notes` are entered on the T&A
 * DASHBOARD, days or weeks after the order was saved, so an operator reopening
 * the order to fix a typo would destroy every completion on it — silently, with
 * no error. AGENTS.md and the Material Attribute post-mortem record that exact
 * bug happening: "12/12 lines + 10 answers destroyed and unrecoverable."
 *
 * A merge that is merely WRITTEN is not a merge that is KNOWN to work, and a
 * server action cannot be vectored — it needs a Supabase client, a session and a
 * database. So the decisions live here, where they are pure, and `actions.ts`
 * supplies the two things only a server can: the saved rows, and the dates.
 * `scripts/check-ta-merge.mts` proves them; `npm run check:ta-merge`.
 *
 * This is the shape `missingRequiredMaterialFields` already uses — one exported
 * function that the screen, the Save button and both actions call, rather than a
 * rule restated at each caller.
 */

/** What identifies and describes a ladder step. The T&A tab owns all of it. */
export type TaRowCore = {
  row_uid: string;
  sno: number;
  activity_id: string | null;
  days_required: number | null;
};

/** What the DASHBOARD owns. Never on `amendmentTaActivityInput`; see its note. */
export type TaCompletion = {
  actual_date: string | null;
  status: string | null;
  notes: string | null;
};

/** A row as it comes back out of the database. */
export type SavedTaRow = TaRowCore & TaCompletion;

/** A row as it goes in, dates resolved and completions carried across. */
export type MergedTaRow = TaRowCore & { target_date: string | null } & {
  actual_date: string | null;
  status: string;
  notes: string | null;
};

/**
 * WHICH LADDER THIS SAVE IS WRITING — the payload's, or the stored one.
 *
 * `ta_activities` defaults to `[]` in the Zod input, so ANY payload that does
 * not know about this tab arrives with an empty list: a stale client, a `curl`,
 * a caller written before today. Under the flat delete-and-reinsert that would
 * empty the table and take every completion with it, which is the disaster the
 * whole anchor exists to prevent.
 *
 * So AN EMPTY LIST MEANS "this save says nothing about the ladder", NOT "delete
 * the ladder": the saved rows are re-emitted and written back.
 *
 * THE PRICE IS REAL AND IS THE CHEAP HALF OF THE TRADE. An operator who deletes
 * every row of the ladder and saves will find it still there on reload — visible,
 * and one edit from being fixed. A payload silently destroying completion
 * records is neither visible nor fixable. The ladder is mandatory on the screen
 * anyway, so "no activities at all" is not a state the operator is heading for.
 *
 * `sno` IS RENUMBERED DENSE from the winning list's own order, on both branches.
 * The saved rows are re-emitted in the order they were given, so the caller has
 * to hand them over sorted — the ladder is the operator's sequence and a
 * function that re-sorted it would move dates nobody edited.
 */
export function taRowsToWrite(
  typed: readonly TaRowCore[],
  saved: readonly SavedTaRow[],
): TaRowCore[] {
  const winner: readonly TaRowCore[] = typed.length ? typed : saved;
  return winner.map((r, i) => ({
    row_uid: r.row_uid,
    sno: i + 1,
    activity_id: r.activity_id,
    days_required: r.days_required,
  }));
}

/**
 * CARRY THE DASHBOARD'S COLUMNS ACROSS THE SAVE, by `row_uid`.
 *
 * NEVER BY `id`, which the reinsert re-mints, and never by `sno`, which
 * `taRowsToWrite` above has just renumbered. `row_uid` is minted client-side,
 * never shown, never edited and round-tripped by the form — it is the only thing
 * about a row that survives a save. Same anchor, same reason, as
 * `material_bom_amendment_processes.row_uid` (0446/0459).
 *
 * A row with no saved counterpart is NEW and starts at `pending` with nothing
 * recorded. A saved row whose anchor is absent from the incoming list has been
 * DELETED by the operator and its completion goes with it — that is a deliberate
 * act on the ladder, not a side effect of saving something else, which is the
 * whole distinction this function draws.
 *
 * `status` IS COALESCED HERE RATHER THAN LEFT TO THE COLUMN DEFAULT — 0475's
 * lesson, inverted. The column is `not null default 'pending'`, and a default
 * applies only when the INSERT OMITS the column; this writer names it on every
 * row, so without the `??` a brand-new step would violate not-null and fail the
 * entire save.
 *
 * `targetDates` is index-for-index with `rows`. An entry is `null` when the
 * ladder refused — which reaches here only on a DRAFT, because a real save
 * returns the refusal instead of writing. An undated row appears on no worklist,
 * which is the honest reading of a plan nobody has finished writing.
 */
export function mergeTaCompletions(
  rows: readonly TaRowCore[],
  saved: readonly SavedTaRow[],
  targetDates: readonly (string | null)[],
): MergedTaRow[] {
  const prior = new Map(saved.map((r) => [r.row_uid, r]));
  return rows.map((r, i) => {
    const was = prior.get(r.row_uid);
    return {
      ...r,
      target_date: targetDates[i] ?? null,
      actual_date: was?.actual_date ?? null,
      status: was?.status ?? "pending",
      notes: was?.notes ?? null,
    };
  });
}

export function amendmentStatusTone(
  a: Pick<GarmentOrderAmendment, "is_draft">,
): "warning" | "success" {
  return a.is_draft ? "warning" : "success";
}
export function amendmentStatusText(
  a: Pick<GarmentOrderAmendment, "is_draft">,
): string {
  return a.is_draft ? "Draft" : "Recorded";
}
