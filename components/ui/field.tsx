import { cloneElement, isValidElement, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
export type FieldSize = "xs" | "sm" | "md" | "lg" | "full";

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
  /** Omit for an unlabelled cell that still participates in the span grid. */
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
   * child rather than marking the wrapper. Under the v3 contract Tab is native
   * — the provider deliberately stopped claiming it — so no `data-` attribute
   * and nothing in `lib/focus.ts` can take a control out of the Tab order. See
   * `.claude/skills/raagam-keyboard-contract`.
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
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </Label>
      )}
      {control}
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
