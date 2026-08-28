import { cloneElement, createContext, isValidElement, useContext, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import type { FieldSize, FieldWidth } from "@/lib/ui/sizes";
import { cn } from "@/lib/utils";

/**
 * What a `Field` tells the control inside it. Exactly one thing today, and it
 * exists so that `required` is declared ONCE.
 *
 * The `*` is drawn by `Field`, but the cursor hold has to live on the focusable
 * element — and `Field` cannot reach it: `children` is any ReactNode, and the
 * `skipTab` clone below already documents why touching it is only safe for a
 * single element. Two props (`<Field required>` for the star, `<Input required>`
 * for the hold) would be two declarations free to disagree, and a `*` that does
 * not hold — or a hold with no `*` — is the worst of both.
 *
 * So the control reads it from context. `<Field required>` alone is enough.
 */
type FieldMeta = {
  required: boolean;
  /** The field's label, when it is a plain string, for the hold's message.
   *  A ReactNode label (an icon + text) has no sensible short form, so the
   *  message falls back to "This field". */
  label: string | null;
};

const FieldCtx = createContext<FieldMeta>({ required: false, label: null });

/**
 * Declare "the control inside here is mandatory" for something that is not a
 * `Field` — a child-grid CELL, whose header is its only label and whose content
 * is an arbitrary node the grid cannot reach into.
 *
 * Same context, so a grid cell and a form field hold the cursor by the same
 * mechanism and there is only ever one of these to keep working.
 */
export function RequiredScope({
  required,
  label,
  children,
}: {
  required?: boolean;
  label?: string | null;
  children: ReactNode;
}) {
  return (
    <FieldCtx.Provider value={{ required: !!required, label: label ?? null }}>
      {children}
    </FieldCtx.Provider>
  );
}

/**
 * Read the enclosing `Field`'s declaration. Returns the marker props a control
 * should spread when its value is empty — `{}` when there is nothing to say, so
 * a control outside a `Field`, or one whose field is optional, is untouched.
 *
 * `empty` is the CALLER's judgement because only it knows what empty means: a
 * `<Select>` is its value being "", a picker its id being null.
 */
export function useRequiredHold(
  empty: boolean,
  /**
   * For controls that render their OWN label and therefore own a `required`
   * prop of their own — `DataPicker`, `LookupDialogPicker`. ORed with the
   * context rather than overriding it, so wrapping such a picker in a
   * `<Field required>` cannot silently un-require it.
   */
  own?: { required?: boolean; label?: string | null },
): { "data-required-empty"?: string } {
  const ctx = useContext(FieldCtx);
  const required = ctx.required || !!own?.required;
  // `||`, NOT `??`. `label=""` means "draw no label" — a control wrapped in a
  // `<Field label="Category">` that already draws one passes it to suppress the
  // second copy — and an empty string is not nullish, so `??` let that
  // suppression win over the context and the hold announced " is required." with
  // no field name at all (Material Attributes ▸ Category, 2026-08-11). No
  // VISIBLE label is not no NAME: fall through to the one the field declared,
  // and only then to the generic.
  const label = own?.label || ctx.label || null;
  if (!required || !empty) return {};
  return { "data-required-empty": `${label ?? "This field"} is required.` };
}

/**
 * A labelled form field that owns its own WIDTH.
 *
 * Every control primitive here is `w-full` (input.tsx, select.tsx,
 * combobox.tsx), so a field's width was entirely whatever grid cell it landed
 * in — a 3-character "Mixing %" inherited the same ~490px box as a free-text
 * Name (client 2026-07-24 #3). `Field` makes width a property of the field
 * instead, sized to the data it holds.
 *
 * Spans are of 12 and only apply inside a `<DetailSection cols={12}>`, which
 * establishes the `@container/section` these query. Outside one they simply do
 * not match, and the field takes the full width of whatever grid cell it landed
 * in — a safe fallback, not a broken layout.
 *
 * They are container queries rather than `sm:` breakpoints for two reasons.
 * First, `sm:col-span-2` was already spoken for: ~80 children across the masters
 * use it to mean "full width of a 2-col section", the exact opposite of "one
 * sixth of a 12-col row". That collision is why this file had a single importer
 * — migrating any screen to `cols={12}` would silently shred those 80 fields.
 * Second, a field should size to the SECTION it sits in, not the viewport: the
 * same section is ~560px wide in one column of a `SectionGrid` and ~1150px wide
 * when it spans the row, at an identical viewport width.
 *
 * The classes are a static lookup, never interpolated — Tailwind v4 scans source
 * text, so a computed `@lg/section:col-span-${n}` would produce no CSS at all.
 */
/**
 * Declared in `lib/ui/sizes.ts` and re-exported here, so the ~90 call sites that
 * import it from this file are untouched — and so a DESCRIPTOR can name a width
 * without dragging a `.tsx` module into an import graph that plain Node has to
 * be able to load. The reasoning is in that file; the SPAN map below is the half
 * that stays here.
 */
export type { FieldSize, FieldWidth };

/**
 * The 12-col track that the spans below query. Exported so `DetailSection` and
 * `FieldGrid` cannot drift apart — they are the same track by construction.
 *
 * A literal constant, not a template: Tailwind v4 scans source text, and it
 * reads a plain string fine. Interpolate anything into it and the CSS vanishes.
 */
export const FIELD_TRACK =
  "grid gap-x-3 gap-y-2 @2xl/editor:gap-y-1.5 @lg/section:grid-cols-12";

/**
 * A FOURTEEN-column variant of the track above, for a section the client wants
 * on ONE row that twelve cannot hold.
 *
 * 12 is the house track and stays the default. 14 exists because the smallest
 * span is `xs` (2), so a 12-col row tops out at SIX fields — and Orders ▸ Style
 * ▸ Style Details was asked for SEVEN on one line (client 2026-08-17). 7 x 2 =
 * 14 exactly, which is the whole reason the number is 14 and not 13 or 16: the
 * fields keep the existing `xs` span rather than needing a new size.
 *
 * A SEPARATE LITERAL, never `grid-cols-${n}`. Tailwind v4 scans source text, so
 * an interpolated class produces no CSS at all — the same warning `FIELD_TRACK`
 * carries, and the reason these are two constants instead of one function.
 *
 * REACH FOR IT ONLY WHEN A ROW IS SPECIFIED. A field on this track is ~155px
 * against LAYOUT.md §3's ~280px, so it is narrower than the one-width rule
 * anywhere else in the app — legible for a date, a code or a Select, tight for
 * free text. It is the client's call per section, not a new default.
 */
export const FIELD_TRACK_14 =
  "grid gap-x-3 gap-y-2 @2xl/editor:gap-y-1.5 @lg/section:grid-cols-14";

/**
 * A THIRTY-TWO-column variant, for ELEVEN fields on one row AT THREE WIDTHS.
 *
 * Same mechanism as 14 above — the track widens, the fields keep sizes that
 * already exist — but this one is not a uniform row, and that is the point.
 * Material BOM's item line was asked for all eleven columns on one row (client
 * 2026-08-19), which is legacy's own grid row and twelve columns tops out at
 * six. It shipped as 22 columns of one `xs` each, and the client came straight
 * back: the three Uom cells hold a THREE-LETTER CODE — CONE, DZN, PCS — and were
 * as wide as the Material picker beside them, which was clipping at "BUTTO…".
 *
 * 32 IS WHAT MAKES THE THREE EXISTING SIZES ADD UP. `xs` is 2, `sm` is 3, `md`
 * is 4, so:
 *
 *   4 narrow  (3 Uoms + MOQ)                        xs   4 x 2 =  8
 *   4 medium  (Type, Attribute, Supply Type, Comb.) sm   4 x 3 = 12
 *   3 wide    (Category, Material, Vendor)          md   3 x 4 = 12
 *                                                              -----
 *                                                                32
 *
 * At ~1504px of editor width that is **~83px** narrow, **~130px** medium,
 * **~178px** wide — against LAYOUT.md §3's ~280px everywhere else, and against
 * the flat ~126px that 22 gave every cell. The wide ones gained 41%; the Uoms
 * lost a third they never used.
 *
 * A SEPARATE LITERAL, never `grid-cols-${n}`. Tailwind v4 scans source text, so
 * an interpolated class produces no CSS at all — the warning both constants
 * above carry. (Verified rather than assumed: `repeat(22,minmax(0,1fr))` was
 * confirmed in the emitted CSS before this constant replaced it, because a
 * class that compiles to nothing would silently drop the row back to two.)
 *
 * ## `items-end` IS LOAD-BEARING, NOT TIDINESS
 *
 * At 83px "Consumption Uom" wraps to two lines, and a two-line label pushes its
 * control ~17px BELOW every control beside it (client 2026-08-19, screenshot
 * 2383: "align it clearly"). This is the same fault `label=""` already guards
 * from the other direction — an ABSENT label collapsing its row and lifting the
 * control ~16px above its neighbours (client 2026-08-11) — so it gets the same
 * answer: the row is what aligns, not the label.
 *
 * `items-end` bottom-aligns each cell box, and the control is each box's last
 * child, so the controls line up whatever the labels do. It fixes the wrap
 * rather than forbidding it, which is why no label here has to be abbreviated
 * or truncated to keep the row straight.
 *
 * ## WHAT IT IS NOT is a horizontal scrollbar
 *
 * The operator had those removed on 2026-08-10 ("the row wraps instead") and the
 * layout skill makes it standing; legacy fits twelve columns on a line by
 * scrolling, and this fits eleven by making them narrower. The fields shrink;
 * the row never moves sideways. Nothing overflows either: `Field` sets
 * `min-w-0` on every cell and these are `minmax(0, 1fr)` tracks, so a long value
 * clips inside its cell instead of widening the row — and no control in this app
 * declares a `min-w-*` of its own, checked before the first of these tracks was
 * added, because one that did would push the row back out.
 *
 * A clipped value stays readable: every picker trigger carries `text-ellipsis`
 * plus the hover / press-and-hold bubble (AGENTS.md, "Truncated values"). An
 * ellipsis with no way to read past it would not be acceptable at any width.
 */
/*
 * `gap-x-2`, NOT the `gap-x-3` every other track uses, and the reason is
 * arithmetic rather than taste (2026-08-28).
 *
 * A 32-column track has THIRTY-ONE gaps, and a gap is a fixed px value that
 * does not scale with the pane. At `gap-x-3` that is 372px of every row spent
 * before a single field is drawn, and because the subtraction happens BEFORE
 * the division — a track is `(W - 372) / 32` — a pane that narrows 9% narrows
 * every field in it by about 13%. That is what put the Material BOM row's
 * labels into a ragged two-height band at 110% zoom while every control beneath
 * them stayed level.
 *
 * `gap-x-2` hands back 124px per row. It is NOT sufficient on its own at laptop
 * widths and was never claimed to be — eleven cells in a ~912px pane is ~83px
 * each however the spans are arranged — but it is free, it is in the right
 * direction, and it is the only one of the three available levers that is not a
 * client decision (the other two are the header WORDING and the 268px master
 * list).
 *
 * SCOPE IS TWO SCREENS, checked rather than assumed: `cols={32}` has exactly two
 * consumers repo-wide — the Material BOM items grid and the Order Amendment
 * screen. Both are crowded Orders grids that want the width. The 12- and
 * 14-column tracks keep `gap-x-3`, where 11 or 13 gaps cost little and the
 * looser rhythm is what the masters forms were signed off on.
 */
export const FIELD_TRACK_32 =
  "grid items-end gap-x-2 gap-y-2 @2xl/editor:gap-y-1.5 @lg/section:grid-cols-32";

/**
 * A `FieldSize`'s span on the track above. Exported for the same reason
 * `FIELD_TRACK` is — so nothing has to retype `col-span-2` and mean "xs".
 *
 * `ChildGrid`'s `across` mode is the consumer: it lays one record per grid cell
 * along `FIELD_TRACK`, so it needs a span per item, and a hand-written 2 there
 * would be a second opinion about what "xs" is. Aliased below as `SPAN` because
 * that is what every reference in this file already calls it.
 */
export const FIELD_SPAN: Record<FieldSize, string> = {
  xs: "@lg/section:col-span-2", // 2-4 chars — %, qty, a small count
  sm: "@lg/section:col-span-3", // short codes — HSN, count, shade
  md: "@lg/section:col-span-4", // the default — most pickers and lookups
  lg: "@lg/section:col-span-6", // long free text — names, addresses
  /**
   * NOT a field width — the same category as `full` below, for the case where
   * the wide thing SHARES its row instead of standing alone.
   *
   * `full` covers a child grid or textarea that takes the row; there was
   * nothing for a child grid sitting BESIDE a field, because the map jumped
   * 6 → 12. Material ▸ Fabric ▸ Composition is the case that asked for it: a
   * stacked Using / Direct Purchase cell at `md` (181px) with the mixing grid
   * next to it. At `lg` the grid got 278px and its Yarn picker ~150px, which
   * the client read as squeezed (2026-08-05); 4 + 8 gives it 374px and the
   * picker ~250px, and still sums to 12.
   *
   * Do not reach for this to make a FIELD wider. LAYOUT.md §3 fixes a field at
   * ~280px and the sizes above are how you hit it; this one exists because a
   * table is not a field.
   */
  xl: "@lg/section:col-span-8",
  full: "@lg/section:col-span-12", // stands alone on its row — grids, textareas
};

/**
 * A `FieldWidth`'s class. The vocabulary and its reasoning live in
 * `lib/ui/sizes.ts`; this is the rendering half, split exactly as
 * `FieldSize`/`FIELD_SPAN` are and for the same reason.
 *
 * STATIC LITERALS, never `w-[${n}]`. Tailwind v4 scans source text, so an
 * interpolated width compiles to no CSS at all — the identical warning
 * `FIELD_TRACK` and `FIELD_TRACK_14` both carry.
 *
 * These are NOT container queries. A span has to be one, because it means "a
 * share of this section" and the section's width varies; a width means the same
 * 72px in a 1180px sheet, a 1440px pane and a 440px picker dialog. That
 * invariance IS the point — it is what a fraction could never give.
 */
export const FIELD_WIDTH: Record<FieldWidth, string> = {
  num: "w-[4.5rem]", // 72px
  range: "w-28", //     112px
  code: "w-36", //      144px — the width `across="compact"` already settled on
  term: "w-44", //      176px
  name: "w-72", //      288px
};

/**
 * A row of fields laid out by their WIDTHS instead of by twelfths.
 *
 * `FieldGrid` divides the row into 12 equal columns, so shrinking the control
 * inside a cell leaves the CELL at its old width and the value floating in dead
 * space — the "surplus reads as a HOLE rather than as room" failure
 * `amendment-screen.tsx` already recorded when it tried a wider track. Nothing
 * short of leaving the fractional track can make a row genuinely compact.
 *
 * So this is `flex-wrap`, left-aligned: each field takes the width its data
 * needs, the row ends where its content ends, and a row too long for the pane
 * wraps rather than scrolling sideways (the operator's rule 4). It is the same
 * shape `ChildGrid`'s `across="compact"` uses — `repeat(auto-fill, 9rem)`,
 * client-approved 2026-08-18, screenshot 2335 — generalised so the next screen
 * does not invent a fifth constant.
 *
 * **The sums-to-12 rule does not apply here and is not being broken.** "A row is
 * settled when it sums to 12" (LAYOUT.md §3, 2026-08-17) is a statement about a
 * FRACTIONAL track, where leftover columns read as page padding because every
 * field visibly shares one ruler. A content-width row has no twelfths to leave
 * over: it simply ends. Do not "settle" one by stretching a field.
 *
 * Use `FieldGrid` for a row of text fields — that is still the house layout and
 * the one-width rule still governs it. Use this where the row is mostly values
 * with known maxima and the fractional track has nothing narrow enough to offer.
 */
/**
 * A ROW OF FIELDS ALIGNS ON ITS CONTROLS, NOT ON ITS LABELS
 * (`items-end`, client 2026-08-19, screenshot 2374).
 *
 * `items-start` looks equivalent right up to the first label that does not fit
 * its box. `FieldRow` sizes each field by `w`, so a `w="num"` cell is 72px wide
 * and its LABEL is stuck with the same 72px: "NoOf Cartons" has a space, wraps
 * to two lines, and pushes its input a line lower than the nine boxes beside it.
 * On the Assortments grid that was one box sitting visibly below the row.
 *
 * Bottom-aligning moves the slack to where nobody reads for alignment. A
 * two-line label now starts higher and every control still sits on one line —
 * which is what an operator means by "aligned", because the boxes are what the
 * eye tracks along a row.
 *
 * The trade is real and narrow: a field carrying a `hint` bottom-aligns on the
 * HINT, so its control would ride high. No `FieldRow` in the app uses one, and a
 * row of width-sized controls is the wrong place for helper text anyway — but if
 * one ever needs it, that is the case to handle rather than a reason to go back
 * to top alignment, which misaligns on the far more common long label.
 */
export const FIELD_ROW =
  "flex flex-wrap items-end gap-x-3 gap-y-2 @2xl/editor:gap-y-1.5";

export function FieldRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  // Two elements, not one, for the reason `FieldGrid` documents below: a size
  // container query does not apply to its own container, so any `@lg/section:`
  // class on this div would resolve against an ANCESTOR named `section`.
  return (
    <div className={cn("@container/section", className)}>
      <div className={FIELD_ROW}>{children}</div>
    </div>
  );
}

/** See `FIELD_SPAN` above — this is the name the rest of this file uses. */
const SPAN = FIELD_SPAN;

export function Field({
  label,
  size = "md",
  w,
  required,
  hint,
  htmlFor,
  skipTab,
  className,
  children,
}: {
  /**
   * Omit for an unlabelled cell that still participates in the span grid.
   *
   * Pass `""` for an unlabelled cell that also KEEPS THE LABEL ROW, so its
   * control lines up with the labelled fields beside it. The two are different
   * on purpose: a row where nothing is labelled wants the space back, and a
   * lone button beside a labelled field wants to line up with it.
   */
  label?: ReactNode;
  size?: FieldSize;
  /**
   * A fixed WIDTH instead of a share of the track — for a value with a known
   * maximum (a GSM, a count, a size label). Wins over `size` when both are set.
   *
   * Only meaningful inside a `FieldRow`: in a `FieldGrid` the surrounding CELL
   * still takes its column, so the control would shrink and leave a hole beside
   * it. Vocabulary and reasoning: `lib/ui/sizes.ts`.
   */
  w?: FieldWidth;
  required?: boolean;
  /** Small helper text under the control. */
  hint?: ReactNode;
  htmlFor?: string;
  /**
   * Auto-generated or derived value (a computed Age, an auto-built name) — Tab
   * skips it, a click still reaches it. LAYOUT.md §8 states this as a global
   * rule, but until now the only implementation was `SimpleField.skipTab` in the
   * descriptor engine, so the ~60 bespoke screens each hand-typed
   * `tabIndex={-1}` — or forgot to.
   *
   * It has to be a real `tabIndex` on the CONTROL, which is why this clones the
   * child rather than marking the wrapper.
   *
   * IT TAKES THE FIELD OFF EVERY KEY, not just Tab: `FOCUSABLE_SELECTOR`
   * (lib/focus.ts) excludes `[tabindex="-1"]` on every branch, so the field also
   * leaves ↑↓←→, Enter-advance and the focus trap. Right for a value the operator
   * cannot type into — wrong for one they must still be able to reach. For a live
   * control that should merely be OFF THE TYPING PATH, the marker is
   * `data-focus-optional`, which Tab and Enter step over while the arrows and the
   * mouse still land on it.
   *
   * (This note used to say Tab was native and that nothing in `lib/focus.ts`
   * could take a control out of the Tab order. That was true under the v3
   * contract and has not been since 2026-08-04 — `cycleTab` claims Tab on any
   * `isEditorScope` surface, and `tabAlongRow` claims it inside a child grid.)
   * See `.claude/skills/raagam-keyboard-contract`.
   */
  skipTab?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // Only a single element can carry the attribute. A caller passing a fragment
  // or several controls is doing something this prop can't express, so it is
  // left untouched rather than silently half-applied to the first child; an
  // explicit `tabIndex={-1}` at the call site is the escape hatch. An existing
  // tabIndex always wins — the caller is being more specific than we are.
  const control =
    skipTab && isValidElement<{ tabIndex?: number }>(children) && children.props.tabIndex == null
      ? cloneElement(children, { tabIndex: -1 })
      : children;

  return (
    /**
     * `w` WINS OVER `size`, which is what this prop has always claimed and had
     * never done (found 2026-08-19).
     *
     * `FieldWidth` and `FIELD_WIDTH` were added on 2026-08-18 for the client's
     * "quantity fields usually only require three or four digits", the prop was
     * threaded through this signature and documented as winning over `size` —
     * and the render never read it. Six call sites on the Combos ▸ Structure
     * Details row passed `w="num"` / `w="name"` and got `SPAN["md"]`, the
     * DEFAULT size, because `size` was left unset beside them. So the narrowing
     * that request asked for shipped as a no-op, and it looked deliberate: the
     * vocabulary existed, the call sites used it, the audit had nothing to say.
     *
     * A dead prop is worse than a missing one. A missing prop makes a call site
     * fail to compile; this one accepted the instruction and dropped it.
     */
    <div className={cn(w ? FIELD_WIDTH[w] : SPAN[size], "min-w-0", className)}>
      {label != null && (
        <Label
          htmlFor={htmlFor}
          // Nothing to announce when there is no label text, and a screen
          // reader reading out a blank one is worse than silence.
          aria-hidden={label === "" || undefined}
        >
          {/* `label=""` RESERVES THE ROW — it does not draw an empty one.
              `Label` is a `block`, so with no children it has no line box at
              all: it collapses to 0 and its control rises ~16px above the
              labelled fields beside it. That is what put "Fill sizes" a row
              above the Size Group select it belongs to (client 2026-08-11).

              The spacer is a non-breaking space THROUGH THE REAL `Label`, so
              the reserved row carries that component's exact metrics —
              including the `@2xl/editor` line-height and margin it swaps in on
              a desktop editor. A hand-built spacer div would be a second copy
              of those numbers and would drift the first time they changed. */}
          {label === "" ? "\u00A0" : label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </Label>
      )}
      {/* The same `required` that draws the star above reaches the control
          through here, so the two can never disagree. See FieldCtx. */}
      <RequiredScope required={required} label={typeof label === "string" ? label : null}>
        {control}
      </RequiredScope>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The field track WITHOUT the bordered, titled card — everything
 * `<DetailSection cols={12}>` gives you except the chrome.
 *
 * `Field`'s spans only resolve inside `@container/section`, and until this
 * existed `DetailSection` was the only thing that established one. So a
 * `ChildGrid` card body — which already sits inside a card and must not draw a
 * second one — had no way to use `Field` at all, and hand-rolled its own
 * `grid-cols-2 sm:grid-cols-4` instead. That is how the Material Attribute
 * cards ended up laid out by VIEWPORT breakpoints while the sections around
 * them responded to their own width.
 *
 * The container and the track are deliberately two elements. A size container
 * query does not apply to its own container, so `@lg/section:grid-cols-12` on
 * the same div would resolve against the nearest ANCESTOR named `section` —
 * silently, and wrongly. `DetailSection` splits them the same way.
 */
export function FieldGrid({
  children,
  className,
  cols = 12,
}: {
  children: ReactNode;
  className?: string;
  /**
   * How many columns the track has. `12` is the house default and every existing
   * caller takes it.
   *
   * `14` and `32` are the wider tracks — see `FIELD_TRACK_14` / `FIELD_TRACK_32`
   * for what earns one. Both exist so a row SPECIFIED BY THE CLIENT can hold
   * seven or eleven fields without inventing a new `FieldSize`; the track is
   * what widens, and on 32 the fields then take THREE of the existing sizes so
   * a Uom code and a Material name are not the same width. `DetailSection`
   * takes the same numbers for the same reason, so a section and a card body
   * cannot lay fields out differently.
   */
  cols?: 12 | 14 | 32;
}) {
  return (
    <div className={cn("@container/section", className)}>
      <div
        className={
          cols === 32 ? FIELD_TRACK_32 : cols === 14 ? FIELD_TRACK_14 : FIELD_TRACK
        }
      >
        {children}
      </div>
    </div>
  );
}
