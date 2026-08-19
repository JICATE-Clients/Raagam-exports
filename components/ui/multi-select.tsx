"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { useRequiredHold } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { GRID_FRAME } from "@/components/masters/child-grid";
import { cn } from "@/lib/utils";

/**
 * PICK SEVERAL FROM ONE LIST — the app's first multi-select.
 *
 * WHY A NEW PRIMITIVE RATHER THAN A MODE ON `DataPicker`. Multi-select is a
 * genuinely different control: the list stays open across picks, Enter toggles
 * instead of committing, and the chosen values need somewhere to live that is
 * not the trigger. Threading that through `DataPicker` means a second behaviour
 * for `value`, `onChange`, `usedIds`, `blockedReason` and the whole Enter path,
 * across ~160 call sites that all want the single-select one. This owes those
 * call sites nothing and can be read on its own.
 *
 * WHAT IT STILL OWES THE CONTRACTS, because a hand-rolled control inherits none
 * of it (AGENTS.md, "A raw lowercase element is where this rule leaks"):
 *
 *   - **The keyboard contract.** The trigger is a real `<input>` carrying
 *     `data-field-trigger`, so `isFieldLike` counts it as a field and Tab, the
 *     arrows and Enter-advance route off the marker exactly as they do for a
 *     picker. Closed: ↓ opens. Open: ↑/↓ move the highlight, Enter and Space
 *     toggle, Esc closes — the `keyFills` branches, which is what lets this sit
 *     in a mandatory field without caging the operator.
 *   - **Escape calls preventDefault.** Anything consuming Escape must, or the
 *     page-level handler in `keyboard-nav-provider.tsx` navigates away behind it.
 *   - **Browser autofill is off**, with the password-manager opt-outs beside it:
 *     the managers ignore `autocomplete` and read only their own markers, and a
 *     remembered-values popup would eat the ↓ that opens this list.
 *   - **Disabled rows are gone, not greyed** — except one the record already
 *     holds, which stays visible and tagged so a stored value never silently
 *     disappears from a field that is showing it.
 *
 * `data-field-empty` is declared, so a `ChildGrid` row ending in an empty one of
 * these declines Enter instead of spawning a blank row.
 */
/** The synthetic "+ Add" row's id — never a real option id. */
const CREATE_ID = "__multiselect_create__";

export type MultiSelectOption = {
  id: string;
  label: string;
  /** Read through `isInactive()` at the call site; a disabled master row. */
  inactive?: boolean;
};

export function MultiSelect({
  id: idProp,
  label,
  options,
  values,
  onChange,
  /* BLANK BY DEFAULT. An unfilled field shows NOTHING (the de-clutter rule) —
     a "Choose…" here would restate the label above it on every call site at
     once, which is how 352 placeholders survived the sweep that was supposed to
     remove them. A caller may still pass one, but only for a STATE of the
     record ("Pick a Style first"), never a description of the box. */
  placeholder = "",
  emptyLabel = "Nothing to choose from",
  required,
  disabled,
  compact,
  className,
  triggerClassName,
  framed,
  onCreate,
}: {
  id?: string;
  label: string;
  options: MultiSelectOption[];
  /** Selected ids, in the order the caller wants them shown. */
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  /** Trigger-only, for a dense row: drops the label above the control. */
  compact?: boolean;
  className?: string;
  /**
   * Caps the TRIGGER and its popup, leaving the chip line free to use the whole
   * cell.
   *
   * A field's width normally comes from its `<Field size>` span and nothing
   * else — that is the one-width rule, and this does not weaken it. It exists
   * for the case where the CELL is deliberately wider than the control: a
   * dropdown holding "S" / "XL" stretched across half a section reads as broken,
   * while the chips beneath it genuinely want that width to wrap into. Two
   * different measurements in one cell, which a span alone cannot express.
   */
  triggerClassName?: string;
  /**
   * Draw the SAME frame a `ChildGrid` draws, for the case where this control
   * stands beside one.
   *
   * Off by default: a field in a row of fields must not grow a box of its own —
   * that is the over-framing the client cut back on 2026-08-18 ("too much
   * frames"). It is for the opposite fault, one row over: a bare control sharing
   * a row with a framed grid reads as floating, because the asymmetry looks like
   * something failed to render rather than like a deliberate difference.
   *
   * `GRID_FRAME` is imported rather than restated, so the two halves cannot
   * drift a pixel apart.
   */
  framed?: boolean;
  /**
   * TYPE A VALUE THAT DOES NOT EXIST YET AND STORE IT IN THE MASTER.
   *
   * Omit and the control is select-only. Supplied, a typed name that matches
   * nothing offers a "+ Add" row at the foot of the list — the same inline-CRUD
   * affordance every other dropdown in this app carries (the standing icon-field
   * rule: a field over stored data is a searchable dropdown WITH create, never a
   * plain text box that invents an unstored value).
   *
   * The call site owns the write, because only it knows which master this is.
   * It must return the stored label, not the typed one: the master's schema
   * applies `capsName()`, so what lands in the table is not always what was
   * typed.
   */
  onCreate?: (name: string) => Promise<{ id: string; label: string } | { error: string }>;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  /**
   * Values created in THIS session, merged over the server's list. The options
   * arrive as a prop from a server component, so without this a size the
   * operator just added is invisible until the next `router.refresh()` lands —
   * and it is already selected, which would read as the pick doing nothing.
   * Same device `LookupDialogPicker` uses, for the same reason.
   */
  const [extra, setExtra] = useState<MultiSelectOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const chosen = useMemo(() => new Set(values), [values]);

  const all = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    for (const o of extra) byId.set(o.id, o); // a session create wins
    return [...byId.values()];
  }, [options, extra]);

  /**
   * An inactive row is dropped from the list — but never one the record already
   * holds. Dropping that would show a filled field as empty and blank the value
   * on the next save, which is the "Disabled rows" rule's whole point.
   */
  const selectable = useMemo(
    () => all.filter((o) => !o.inactive || chosen.has(o.id)),
    [all, chosen],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? selectable.filter((o) => o.label.toLowerCase().includes(q)) : selectable;
  }, [selectable, query]);

  /** The chips, in the caller's stored order, resolved to their labels. */
  const picked = useMemo(() => {
    const byId = new Map(all.map((o) => [o.id, o]));
    return values.map((v) => byId.get(v)).filter(Boolean) as MultiSelectOption[];
  }, [all, values]);

  /**
   * THE STAR HAS TO HAVE SOMETHING BEHIND IT.
   *
   * This control draws its own label, so it owns a `required` prop the way
   * `DataPicker` and `LookupDialogPicker` do — and a `required` that only drew a
   * red `*` would be decoration, letting Tab, Enter and ↓ walk straight out of a
   * field the record cannot be saved without. That exact bug shipped on every
   * picker in the app until 2026-08-10.
   *
   * ORed with the surrounding `<Field required>` inside the hook, so wrapping
   * this in one cannot silently un-require it. Empty means NOTHING CHOSEN — a
   * search query half-typed into the trigger is not a value.
   */
  const hold = useRequiredHold(!disabled && picked.length === 0, { required, label });

  // Close on a click outside. Pointerdown, not click, so a pick inside the panel
  // is never raced by the close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && rootRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  /**
   * CLOSE WHEN THE CURSOR LEAVES — the keyboard's half of the rule above
   * (client 2026-08-19: "after choosing size, if I move to the next field the
   * size dropdown should close automatically").
   *
   * Closing on pointerdown-outside covers the MOUSE and nothing else, so an
   * operator who picked their sizes and pressed Tab left a full-height panel
   * hanging over the form while the caret blinked in Description behind it.
   * That is also what the contract already asks of any list: "Tab / Shift+Tab —
   * in an open list: close without choosing, then move."
   *
   * `focusout` ON THE ROOT, not a Tab handler on the trigger, because leaving is
   * leaving however it happens: Tab and Shift+Tab, an arrow off the edge of the
   * section, the blocked-Save reveal jumping to another field, the duplicate
   * catch-up pulling the cursor back. One listener answers all of them; a Tab
   * handler would answer one and leave the rest.
   *
   * `relatedTarget` inside the root means focus moved WITHIN the control — the
   * trigger to a checkbox row, a row to the "+ Add" — which must not close it.
   * A null `relatedTarget` (focus going nowhere) does close, which is right: a
   * panel with no cursor anywhere near it is exactly the one in the screenshot.
   *
   * Deliberately NOT preventing Tab. The skill is explicit that a list must
   * close without committing and let the key travel; claiming it here would trap
   * the operator in the field they just finished with.
   */
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Node && root.contains(to)) return;
      setOpen(false);
      setQuery("");
    };
    root.addEventListener("focusout", onFocusOut);
    return () => root.removeEventListener("focusout", onFocusOut);
  }, [open]);

  /**
   * OFFER "+ Add" ONLY FOR A NAME THAT IS NOT ALREADY A ROW.
   *
   * A candidate that already exists is one the master's unique constraint is
   * about to reject, so offering it is offering a click that lands on "already
   * exists" — the same rule the near-miss chips follow. The comparison is
   * trimmed and case-insensitive because the master stores CAPS: typing "xl"
   * beside a stored "XL" is the duplicate, not a new size.
   */
  const typed = query.trim();
  const offerCreate =
    !!onCreate &&
    typed !== "" &&
    !all.some((o) => o.label.trim().toLowerCase() === typed.toLowerCase());

  /** What ↑/↓ walk and Enter picks — the options, then the create row if shown. */
  const navIds = useMemo(
    () => [...filtered.map((o) => o.id), ...(offerCreate ? [CREATE_ID] : [])],
    [filtered, offerCreate],
  );

  const create = async () => {
    if (!onCreate || creating || !typed) return;
    setCreating(true);
    setCreateError(null);
    const res = await onCreate(typed);
    setCreating(false);
    if ("error" in res) {
      // Said in place rather than thrown away: the unique constraint is the real
      // guard, so this is where "already exists" arrives if two operators race.
      setCreateError(res.error);
      return;
    }
    setExtra((xs) => [...xs, { id: res.id, label: res.label }]);
    onChange([...values, res.id]);
    setQuery(""); // the list reopens whole, with the new value ticked
    setHighlight(res.id);
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setHighlight((h) => h ?? navIds[0] ?? null);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const toggle = (optId: string) => {
    onChange(chosen.has(optId) ? values.filter((v) => v !== optId) : [...values, optId]);
  };

  const step = (dir: 1 | -1) => {
    if (!navIds.length) return;
    const i = navIds.indexOf(highlight ?? "");
    const next = i === -1 ? (dir === 1 ? 0 : navIds.length - 1) : i + dir;
    setHighlight(navIds[Math.max(0, Math.min(navIds.length - 1, next))]);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      // A CLOSED LIST OPENS ON ↓ — the only keyboard route to a value, and the
      // reason a hold on this field is still satisfiable (`keyFills`).
      e.preventDefault();
      if (!open) openList();
      else step(1);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      // An OPEN list owns Enter: toggling IS filling, so this must never fall
      // through to Enter-advance or the save ladder. The list deliberately
      // stays open — picking several is the whole job.
      if (!highlight) return;
      e.preventDefault();
      e.stopPropagation();
      if (highlight === CREATE_ID) void create();
      else toggle(highlight);
      return;
    }
    if (e.key === "Escape") {
      // MUST preventDefault: the page-level Escape handler sits on `window` and
      // fires after `document`, so an unclaimed Escape navigates back.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const summary = picked.length
    ? `${picked.length} selected`
    : options.length
      ? placeholder
      : emptyLabel;

  return (
    <div ref={rootRef} className={cn("relative", framed && GRID_FRAME, className)}>
      {!compact && (
        <Label htmlFor={id}>
          {/* required-star: exempt -- this control renders its OWN label, so it
              owns `required` the way DataPicker does, and the star is BACKED:
              `useRequiredHold` above spreads `data-required-empty` onto the
              trigger from the same prop. Wrapping it in a <Field required>
              instead would draw a second label above this one. */}
          {label} {required && <span className="text-danger">*</span>}
        </Label>
      )}
      <div className={cn("relative", triggerClassName)}>
        <input
          id={id}
          ref={triggerRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={compact ? label : undefined}
          {...hold}
          data-field-trigger
          data-field-empty={picked.length ? "false" : "true"}
          disabled={disabled}
          // caps-input: exempt -- this box holds a SEARCH QUERY while the list
          // is open and a read-back summary while it is closed; neither is a
          // stored value, and the sizes themselves are never typed here. Same
          // carve-out data-picker.tsx's search field carries.
          // Chrome's remembered-values popup would sit on top of the list and
          // eat the ↓ that opens it; the managers read only their own markers.
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={open ? query : summary}
          placeholder={placeholder}
          onClick={() => (open ? close() : openList())}
          onChange={(e) => {
            setQuery(e.target.value);
            setCreateError(null);
            if (!open) setOpen(true);
          }}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            // Same metrics as Input / DataPicker — these share rows with both.
            "h-9 @2xl/editor:h-8 w-full rounded-md border bg-surface pl-3 pr-9 text-base md:text-sm",
            // truncate-reveal: exempt -- the full selection is rendered in the
            // chip line below, so nothing here is the only copy of a value.
            "text-ellipsis placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "border-border hover:border-primary",
          )}
        />
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable
            className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
          >
            {filtered.length === 0 && !offerCreate && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {options.length ? "No match" : emptyLabel}
              </li>
            )}
            {filtered.map((o) => {
              const on = chosen.has(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    tabIndex={-1}
                    // mousedown, not click: the trigger keeps focus, so the
                    // operator can carry straight on with the keyboard.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      toggle(o.id);
                      setHighlight(o.id);
                    }}
                    onMouseEnter={() => setHighlight(o.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                      highlight === o.id ? "bg-surface-muted" : "",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    {/* `touch={false}`: this row commits on mousedown, so a
                        press-and-hold would reveal the value AND pick it. */}
                    <Truncated touch={false}>{o.label}</Truncated>
                    {o.inactive && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        (inactive)
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {offerCreate && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  tabIndex={-1}
                  disabled={creating}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                  onMouseEnter={() => setHighlight(CREATE_ID)}
                  className={cn(
                    "flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-sm font-medium text-primary",
                    highlight === CREATE_ID ? "bg-surface-muted" : "",
                    creating ? "opacity-60" : "",
                  )}
                >
                  <Plus aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  {/* truncate-reveal: exempt -- this echoes what the operator
                      is typing THIS MOMENT, and the full text is in the box
                      directly above it. A press-and-hold bubble would also
                      reveal and CREATE in one gesture, since this row commits
                      on mousedown. */}
                  <span className="truncate">
                    {creating ? "Adding…" : `Add “${typed}”`}
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {createError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {createError}
        </p>
      )}

      {/* THE CHOSEN VALUES, ON ONE LINE. This is the control's display half, not
          decoration: the trigger only ever says how many, so removing this would
          leave the selection unreadable without opening the list. The ✕ is the
          only way to drop one, and it is a real button so the mouse and a screen
          reader both reach it — but `tabIndex={-1}` keeps it off the typing path,
          the same treatment a ChildGrid row's Remove gets. */}
      {picked.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {picked.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted px-2 py-0.5 text-sm font-medium"
            >
              {o.label}
              {!disabled && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove ${o.label}`}
                  onClick={() => toggle(o.id)}
                  className="text-muted-foreground hover:text-danger"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
