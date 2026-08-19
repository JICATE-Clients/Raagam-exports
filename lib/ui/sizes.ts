/**
 * Layout vocabulary that a DESCRIPTOR is allowed to name.
 *
 * This file exists for one reason: `lib/screens/**` must be importable by plain
 * Node — by `lib/data-io/entities.ts`, by every `"use server"` action file, and
 * by `scripts/check-screens.mts` under type stripping — with no JSX runtime and
 * no client bundle. A descriptor names a field's width, so it needs this type;
 * if it reached for `components/ui/field.tsx` it would pull a `.tsx` module into
 * that import graph and the check script's purity assertion could no longer be
 * proved by reading the graph.
 *
 * `import type` is erased at compile time, so a type-only import from a `.tsx`
 * file would in fact run. That is exactly why the rule is drawn here instead:
 * "no `.tsx` in the graph AT ALL" is checkable by grep; "no .tsx unless the
 * import happens to be type-only" is a rule that decays the first time someone
 * drops the `type` keyword and nothing complains.
 *
 * The SPAN map that turns these into Tailwind classes stays in `field.tsx`,
 * where the container-query reasoning lives. This file is the vocabulary; that
 * file is the rendering. `field.tsx` re-exports the type, so nothing that
 * imports `FieldSize` from there has to move.
 */

/**
 * A form field's width, in twelfths of a `<DetailSection cols={12}>` track.
 *
 * `xs` 2 · `sm` 3 · `md` 4 (default) · `lg` 6 · `xl` 8 · `full` 12.
 *
 * `xl` and `full` are NOT field widths — they are for a child grid or textarea
 * that shares its row or takes it whole. LAYOUT.md §3 fixes a field at ~280px
 * and `xs`–`lg` are how you hit it.
 */
export type FieldSize = "xs" | "sm" | "md" | "lg" | "xl" | "full";

/**
 * A field's width when its value has a KNOWN MAXIMUM — a width, not a share.
 *
 * `FieldSize` above is a FRACTION of whatever section it lands in, and that is the
 * whole reason this exists. `xs` is the floor of that scale and still renders
 * ~182px in an 1180px sheet, ~224px in a 1440px pane and **~282px in the Combos ▸
 * Structure Details overlay** (client screenshot 2354, 2026-08-18) — where the
 * SMALLEST size the system can express came out the same width as LAYOUT.md §3's
 * standard full-size field. A three-digit GSM had twenty digits of room, and there
 * was nothing smaller to ask for.
 *
 * So a value whose width is a property of the DATA rather than of the row takes one
 * of these instead. The test is the one §3 already states: does the value have a
 * hard maximum the schema guarantees? A GSM does. A customer name does not.
 *
 * THIS IS NOT A RETURN TO "SIZE TO THE DATA". There are FIVE widths for the whole
 * application, not one per field — the failure this must never become is a screen
 * measured against its own longest value (`order-tabs.tsx`'s `w-16` GSM box, which
 * §3 correctly refused). One width still governs every field holding TEXT; this adds
 * a small shared set for the values that are demonstrably not text.
 *
 * They replace four unnamed constants each invented separately in ONE day:
 * `CELL = "5rem"` (fabric-bom), `PRICE_W = "w-32"` (amendment), `across="compact"`'s
 * 9rem (child-grid) and the older hand-typed `w-16`. Four workarounds for one gap is
 * what a missing vocabulary looks like.
 *
 * Sizes are measured, not chosen: 4 digits plus the input's own `px-3` padding and
 * 1px borders is ~65px at 14px type and ~70px at 16px, so `num` clears both. `w-16`
 * (64px) does NOT — which is why the 13 fields already hard-coded to it need to get
 * WIDER, and that is a bug fix wearing the costume of a contradiction.
 */
export type FieldWidth =
  /** 4.5rem · 72px — a 3-4 digit number: GSM, tolerance, a count, a percent. */
  | "num"
  /** 7rem · 112px — a derived pair or short code: "195 - 205", an HSN. */
  | "range"
  /** 9rem · 144px — a short enum read as a word: FRONT, BOTTOM, XL. */
  | "code"
  /** 11rem · 176px — a two-word enum: "Circular Knit", "Yarn Dyed". */
  | "term"
  /** 18rem · 288px — LAYOUT.md §3's ~280px, named so a mixed row can state it. */
  | "name";
