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
 * THIS IS NOT A RETURN TO "SIZE TO THE DATA". There are SEVEN widths for the whole
 * application, not one per field — the failure this must never become is a screen
 * measured against its own longest value (`order-tabs.tsx`'s `w-16` GSM box, which
 * §3 correctly refused). One width still governs every field holding TEXT; this adds
 * a small shared set for the values that are demonstrably not text.
 *
 * THE COUNT IS THE RULE, so it is stated here and has to be edited when it moves:
 * it was FIVE when this was written, six on 2026-09-09 (`party`) and seven on
 * 2026-09-10 (`hug`). Each addition argues for itself in its own step's note and
 * neither was a value wanting a bit more room — that is still refused. A reader
 * who finds "five" quoted elsewhere in the repo is holding a stale count, not a
 * rule this file has abandoned.
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
  /**
   * 5.5rem · 88px — THE FLOOR: the narrowest a labelled field can be and still
   * show its own label on one line. The only step here that is not a statement
   * about the VALUE.
   *
   * A `Field`'s label is Inter 600 at 12px — `components/ui/label.tsx` refuses
   * 11px in writing — and it wraps rather than clipping. Two words is ~86px,
   * measured from the font this app actually ships (`next/font/google`'s Inter,
   * instanced at wght 600): "Account Name" is 85.9px, "Branch Name" 78.2px,
   * "In-house Unit ID" and "Business Entity" the same order. Below that the
   * label goes to two lines, and on an `align="start"` row that drops its
   * control a line under every other control on the row — the hazard
   * `FIELD_ROW_NOWRAP_TOP` documents from the other side. So 88px is not a
   * preference; it is where a labelled cell stops working.
   *
   * `num` (72px) sits below it and stays, because a `num` field is the one case
   * with no such floor: "GSM", "Days", "Qty", "Loss %" are one short word by
   * construction, which is why the 13 fields it replaced could be that narrow at
   * all. Give a two-word label a `num` and the wrap is silent.
   *
   * IT IS THE SECOND TIME THIS EXACT NUMBER WAS NEEDED, which is what makes it a
   * step rather than a screen's opinion. Customer ▸ Identity hand-typed 85px
   * TWICE and named the reason — "Two of the others are label-bound rather than
   * value-bound: 'In-house Unit ID' and 'Business Entity' are longer than
   * anything typed into them" — and its own map instructs the next screen with
   * that need to widen the vocabulary rather than copy it. Our Bank ▸ Details is
   * that screen (client 2026-09-10: Account Name and Branch Name "compact",
   * tight to the text). 85 here and 88 there would be two numbers for one fact,
   * and a third screen would invent 86.
   *
   * WHAT IT IS NOT: a licence to shrink a text field to its own longest value.
   * It says nothing about the value — a field takes it when the ROW needs every
   * pixel and the field's own LABEL is what stops it going further. The value
   * still scrolls inside the box, as it does at every step.
   */
  | "hug"
  /** 7rem · 112px — a derived pair or short code: "195 - 205", an HSN. */
  | "range"
  /** 9rem · 144px — a short enum read as a word: FRONT, BOTTOM, XL. */
  | "code"
  /** 11rem · 176px — a two-word enum: "Circular Knit", "Yarn Dyed". */
  | "term"
  /**
   * 12.5rem · 200px — A SHORT PROPER NOUN THAT `term` CLIPS AND `name` OVERSIZES:
   * a bank, an agent, a branch, a zone, an area.
   *
   * THE SIXTH WIDTH, added 2026-09-09 for Consignee ▸ General ▸ Bank, and added
   * to the vocabulary rather than as a `w-[200px]` in that screen's own map
   * because `erp-form-compact` names this exact case: "if a screen genuinely
   * needs the top of a band, that is the case for a SIXTH vocabulary width, not
   * for a local map". The client asked for 200px there by measuring an actual
   * clipped value, not by preference.
   *
   * IT IS THE ONE STEP THAT IS NOT BOUNDED BY THE SCHEMA, and that is the line
   * to hold. Every step above answers "does the value have a hard maximum?" with
   * yes; a bank name does not, so by that test it is `name` (288px) and always
   * was. What this step says instead is narrower and checkable: the value is a
   * name, and `name` would break the row it sits in.
   *
   * IT SAID "IN A PICKER TRIGGER, NOT A TYPING SURFACE" FOR ONE DAY, and the
   * client's next instruction went straight through that clause: Zone ▸ Edit's
   * Zone Name and Area are both plain `<Input>`s and were asked for at 200px
   * outright (2026-09-10, "the exact same width (w-[200px])"). The clause is
   * withdrawn rather than exempted around, because it was never the thing doing
   * the work — it was one screen's incidental detail promoted to a rule on the
   * day that screen was written.
   *
   * WHAT ACTUALLY GUARDS THE LINE IS THE QUESTION, NOT THE CONTROL: is the width
   * a decision about the ROW, or a measurement of this screen's longest value?
   * "These two boxes are the same size and both fit a place name" is the first.
   * "Our longest zone is CENTRAL EAST, so make it that wide" is the second, and
   * that is what §3 refuses and this file's header calls the failure it must
   * never become. A picker trigger passes that test easily, which is why the two
   * looked like one rule; a typing surface can pass it too.
   *
   * The gap it fills is real: `term` 176 → `name` 288 is a 112px jump, and a
   * short proper noun lands in the middle of it. It is the last step that will
   * be added on this argument; a seventh means the vocabulary has become one
   * width per field.
   *
   * `hug` BELOW IS A SEVENTH, ADDED THE NEXT DAY, and it is deliberately not on
   * this argument — it is not a value width at all. Read its note before reaching
   * for it: the sentence above still refuses an eighth step for a value that
   * "needs a bit more room", which is the only thing it was ever guarding.
   */
  | "party"
  /** 18rem · 288px — LAYOUT.md §3's ~280px, named so a mixed row can state it. */
  | "name";
