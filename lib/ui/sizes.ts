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
