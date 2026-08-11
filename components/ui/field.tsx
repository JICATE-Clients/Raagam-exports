import { cloneElement, createContext, isValidElement, useContext, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import type { FieldSize } from "@/lib/ui/sizes";
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
export type { FieldSize };

/**
 * The 12-col track that the spans below query. Exported so `DetailSection` and
 * `FieldGrid` cannot drift apart — they are the same track by construction.
 *
 * A literal constant, not a template: Tailwind v4 scans source text, and it
 * reads a plain string fine. Interpolate anything into it and the CSS vanishes.
 */
export const FIELD_TRACK =
  "grid gap-x-3 gap-y-2 @2xl/editor:gap-y-1.5 @lg/section:grid-cols-12";

const SPAN: Record<FieldSize, string> = {
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

export function Field({
  label,
  size = "md",
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
    <div className={cn(SPAN[size], "min-w-0", className)}>
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
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("@container/section", className)}>
      <div className={FIELD_TRACK}>{children}</div>
    </div>
  );
}
