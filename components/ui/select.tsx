"use client";

import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useRequiredHold } from "@/components/ui/field";
import { holdEmpty } from "@/components/ui/input";

/**
 * Drop-in replacement for a native <select> (same API: <option> children,
 * controlled `value`, `onChange` firing `e.target.value`). On a real mouse
 * (desktop) it renders a browsable, arrow-key-navigable listbox so a keystroke
 * OPENS and filters the list instead of instantly committing a value — the
 * legacy-ERP "list the data, arrow-key to pick" flow. On touch it keeps the
 * native OS picker (familiar spinner), and it stays native for SSR, `multiple`,
 * or uncontrolled selects so nothing regresses. See components/ui/combobox.tsx
 * for the shared list-navigation logic this adapts.
 */

const NATIVE_CLASS = cn(
  // px-3 matches Input/Combobox — this was the lone px-2 control.
  // @2xl/editor:h-8 — compact density; see the note in components/ui/input.tsx.
  "h-9 @2xl/editor:h-8 w-full rounded-md border border-border bg-surface px-3 text-base md:text-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/** Flatten the text content of an <option>'s children into a label string. */
function optionLabel(children: ReactNode): string {
  if (children == null || children === false || children === true) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(optionLabel).join("");
  return "";
}

interface ParsedOptions {
  options: ComboboxOption[];
  placeholder?: string;
  /** true when an explicit empty-value ("") option exists → clearing is allowed. */
  hasEmpty: boolean;
}

/**
 * Turn <option> children into ComboboxOption[]. A leading blank-value option
 * (e.g. <option value="">All</option>) or a disabled first option becomes the
 * placeholder rather than a selectable row — mirroring how a native select
 * shows its blank first choice. Non-<option> nodes (falsy conditionals) skip.
 */
function parseOptions(children: ReactNode): ParsedOptions {
  const options: ComboboxOption[] = [];
  let placeholder: string | undefined;
  let hasEmpty = false;

  for (const child of Children.toArray(children)) {
    if (!isValidElement(child) || child.type !== "option") continue;
    const props = child.props as {
      value?: string | number;
      children?: ReactNode;
      disabled?: boolean;
    };
    const label = optionLabel(props.children);
    const value = props.value != null ? String(props.value) : label;

    if (value === "") {
      hasEmpty = true;
      // `label` IS KEPT WHEN IT IS EMPTY — `<option value="" />` is a
      // deliberately blank placeholder, and `|| undefined` used to erase that
      // distinction so the field fell through to "Select…" below. In a grid cell
      // the column header already names the field, so "Select…" is the same
      // sentence twice and truncates to "S…" (client, 2026-08-18). A caller that
      // wants the generic prompt simply omits the blank option.
      if (placeholder === undefined) placeholder = label;
      continue;
    }
    if (props.disabled && options.length === 0 && placeholder === undefined) {
      // A disabled non-blank first option is a prompt, not a real choice.
      placeholder = label || undefined;
      continue;
    }
    // CARRY `disabled` THROUGH. It used to be read only for the prompt case
    // above and dropped here, so `<option disabled>` anywhere else in the list
    // was honoured by the native <select> on touch and silently selectable on
    // desktop, where this parses into a Combobox — one list, two answers.
    options.push({ value, label, disabled: props.disabled || undefined });
  }

  return { options, placeholder, hasEmpty };
}

/** True on a real mouse/desktop (fine pointer + hover). Touch stays on native. */
function useEnhance(nativeOnly: boolean): boolean {
  const [enhance, setEnhance] = useState(false);
  useEffect(() => {
    if (nativeOnly) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      setEnhance(true);
    }
  }, [nativeOnly]);
  return enhance && !nativeOnly;
}

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & {
    /**
     * A DENSE GRID CELL — forwarded to `Combobox`, which shrinks the chevron and
     * the clear ✕ from 16px to 12px.
     *
     * The same flag `DataPicker` carries, and deliberately the same NAME: a
     * `<Select>` and a picker sit side by side in one grid row, so two rules for
     * one glyph would draw two different chevrons in adjacent cells.
     *
     * It is destructured out of the spread below rather than passed through —
     * `compact` is not a `<select>` attribute, and the touch/SSR branch renders a
     * real one, which would warn about an unknown DOM property.
     */
    compact?: boolean;
  }
>(({ className, children, compact, ...props }, ref) => {
  // Keep native for multi-select and uncontrolled (defaultValue) usage — the
  // listbox is single-select and controlled-only.
  const nativeOnly = Boolean(props.multiple) || props.value == null;
  const enhance = useEnhance(nativeOnly);
  const hold = useRequiredHold(!props.disabled && holdEmpty(props.value), {
    required: props.required,
  });

  const native = (
    // `autoComplete="off"` for a different reason than input.tsx: a <select>
    // has no typing to remember, so there is no pop-up — but Chrome will fill
    // one from the saved address profile, which quietly rewrites a State or
    // Country the operator never touched. The enhanced (desktop) branch below
    // is a Combobox and carries its own `off`.
    <select
      ref={ref}
      autoComplete="off"
      // Mandatory and blank holds the cursor (see input.tsx). The enhanced
      // branch below is a Combobox and stamps its own — this is the touch / SSR
      // / multiple / uncontrolled branch.
      {...hold}
      className={cn(NATIVE_CLASS, className)}
      {...props}
    >
      {children}
    </select>
  );

  // SSR + touch + first client render all render `native` (no hydration mismatch);
  // desktop upgrades to the listbox after mount.
  if (!enhance) return native;

  const { options, placeholder, hasEmpty } = parseOptions(children);
  /**
   * Defensive: nothing PARSEABLE → fall back to the native element.
   *
   * `hasEmpty` is what separates "this is not really a select" from "this is a
   * select with nothing to choose yet", and conflating the two was visible in a
   * grid row (client, 2026-08-18): Fabric BOM's Style and Combo take their
   * options from the picked garment order, so before one is picked they hold
   * only the blank placeholder — `options.length === 0` — and fell through to a
   * native `<select>`. It drew Chrome's own arrow: darker, larger and a
   * different shape from the twelve-pixel chevron in every neighbouring cell.
   *
   * The control changed identity because its DATA was empty, which is the sort
   * of inconsistency nobody can diagnose by looking at the screen.
   *
   * A blank option is a deliberate declaration, so it is enough to know this is
   * a real select; the listbox renders it with an empty list, which says "no
   * choices here yet" rather than silently becoming another control. Only a
   * `<Select>` with no parseable `<option>` at all still falls back.
   */
  if (options.length === 0 && !hasEmpty) return native;

  const value = props.value != null ? String(props.value) : "";
  // Preserve a current value that isn't among the options (don't blank it).
  const opts =
    value && !options.some((o) => o.value === value)
      ? [...options, { value, label: value }]
      : options;

  return (
    <>
      <Combobox
        id={props.id}
        compact={compact}
        options={opts}
        value={value}
        onChange={(v) =>
          props.onChange?.({
            target: { value: v },
            currentTarget: { value: v },
            preventDefault() {},
            stopPropagation() {},
          } as unknown as ChangeEvent<HTMLSelectElement>)
        }
        // Only reached by a `<Select>` with NO empty `<option>` — otherwise
        // `parseOptions` above has already taken that option's own label as the
        // placeholder, and those labels were blanked app-wide on 2026-08-17
        // (209 of them: "— Select —", "Select…", "-- None --", a bare "—").
        // The `All …` ones deliberately survived: on a FILTER that is a real
        // choice, not an empty state. Same default as the picker and the
        // Combobox; see data-picker.tsx.
        placeholder={placeholder ?? ""}
        clearable={hasEmpty}
        disabled={props.disabled}
        // Carry the mandatory declaration across the native → listbox swap, or a
        // `<Select required>` would hold on touch and not on a mouse.
        required={props.required}
        // Deliberately BOTH. On a native <select> — which this claims to be a
        // drop-in for, and which is what the touch/SSR branch above still
        // renders — `className` styles the control. The enhanced branch splits
        // that one element into a wrapper plus an input, so sending it to only
        // one of them makes the same `<Select className="h-8">` render
        // differently on desktop than on touch. The wrapper needs it for width
        // (the chevron and popup anchor to it); the input needs it for height,
        // text size and padding.
        //
        // The one thing a caller must therefore NOT pass is `border` / `bg-*` —
        // the control already draws those, and duplicating them on the wrapper
        // is what produced the double-boxed Location switcher in the topbar.
        className={className}
        inputClassName={className}
        openOnFocus={false}
      />
      {props.name ? <input type="hidden" name={props.name} value={value} /> : null}
    </>
  );
});
Select.displayName = "Select";
