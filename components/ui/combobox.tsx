"use client";

import { ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRequiredHold } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { useOverflow } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  /**
   * Shown, greyed, and not choosable — by the mouse, by Enter, or by ↑/↓.
   *
   * This is what `<option disabled>` means, and until now a desktop `<Select>`
   * silently ignored it: `parseOptions` (select.tsx) read the flag only to spot
   * a placeholder prompt and dropped it for every other row, so a disabled
   * option was refused on touch (native `<select>`) and freely selectable on a
   * mouse. Same list, two answers.
   *
   * Its first real use is pick-once — a value already taken by another row of a
   * repeating grid. The equivalent on the master-data side is `usedIds` in
   * components/ui/data-picker.tsx, and the two deliberately look identical.
   */
  disabled?: boolean;
  /** Why it is greyed, in words, e.g. "(already added)". Opacity alone reads as
   *  a rendering glitch rather than a reason. */
  disabledNote?: string;
}

/**
 * Inline type-ahead select (checklist "Dropdown Improvements" / "Smart Auto
 * Complete"): click or focus opens the list, typing filters it, ↑/↓ move the
 * highlight, Enter picks, Esc closes — no separate OK button, auto-closes on
 * select. A lightweight replacement for a long native <select> when the options
 * fit in memory. For FK/lookup fields that also need inline Add/Modify, keep the
 * dialog pickers in components/masters/*-picker.tsx; this is for plain lists.
 *
 * The dropdown is portaled to <body> with fixed positioning measured from the
 * input, so it never clips inside a scrollable Sheet — it repositions on scroll
 * and resize while open. The value stays a controlled string via value/onChange.
 */
export function Combobox({
  options,
  value,
  onChange,
  // AN UNFILLED CONTROL SHOWS NOTHING — not "Select…", and not the "—" this
  // briefly used instead (client 2026-08-17). See the long note at the
  // placeholder in components/ui/data-picker.tsx: a Combobox sits under a
  // `<Field label>` or a grid column header like every other control, so the
  // verb+noun was the label said twice, and a dash is a mark meaning what the
  // box and chevron already mean.
  placeholder = "",
  clearable = false,
  disabled = false,
  id,
  className,
  inputClassName,
  openOnFocus = true,
  required = false,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  /** Wrapper classes — width, margins. The chevron, the clear button and the
   *  popup are all positioned against this element, so width belongs here. */
  className?: string;
  /**
   * Classes for the visible control itself — height, text size, padding.
   *
   * Without this there was no way to resize a `<Select>` from a call site: the
   * classes landed on the wrapper while the input kept its hardcoded `h-9 …
   * px-3 … border`, so `className="h-8 border bg-surface px-2"` rendered a 32px
   * bordered box with a 36px bordered box overflowing it and the text inset
   * twice (8px + 12px). See `select.tsx`, which forwards `className` here as
   * well so a `<Select>` keeps behaving like the native element it replaces.
   */
  inputClassName?: string;
  /**
   * Open the list as soon as the input is focused. Default true. Pass false for
   * a native-select feel: focus alone leaves the list closed (so Enter can
   * advance to the next field), and the list opens only on click / ArrowDown /
   * typing.
   */
  openOnFocus?: boolean;
  /** Mandatory: hold the cursor while nothing is picked. See useRequiredHold. */
  required?: boolean;
}) {
  // Empty is "no value picked" — the typed query is a search, not a value.
  // `required` is threaded from <Select required> on the desktop-enhanced
  // branch, which renders this instead of a native <select>; ORed with an
  // enclosing <Field required>.
  const hold = useRequiredHold(!disabled && !value, { required });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  // Shared with the input's onChange below, which has to know what the list
  // WILL be: `filtered` is still the previous render's when the keystroke fires.
  // Same split as components/ui/data-picker.tsx, for the same reason.
  const matching = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return options;
      return options.filter((o) =>
        `${o.label} ${o.sublabel ?? ""}`.toLowerCase().includes(needle),
      );
    },
    [options],
  );

  const filtered = useMemo(() => matching(query), [matching, query]);

  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  // Reposition while open (inner Sheet scrolling, window resize).
  useEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  // Keep the highlighted option scrolled into view during keyboard navigation
  // (↑/↓) and when opening on a pre-selected value further down the list — a
  // custom listbox must do this itself, unlike a native <select>. Without it the
  // highlighted row (e.g. the last item, YARN) can sit clipped at the list edge.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  // Close on outside click (input root OR the portaled list).
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function openList() {
    if (disabled) return;
    setQuery("");
    // Seed on the current value; failing that, the first CHOOSABLE row rather
    // than index 0, which may be greyed.
    const at = options.findIndex((o) => o.value === value);
    setHighlight(at >= 0 ? at : Math.max(0, options.findIndex((o) => !o.disabled)));
    setOpen(true);
  }
  function commit(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
    // Deliberately NO blur() here. Blurring dropped focus to <body>, so the very
    // next Tab hit the Sheet's trap with `!inside` and got sent back to the top
    // of the form (client 2026-07-24 #1/#5). Focus stays on the field it came
    // from; only the list closes.
  }

  /**
   * The one keyboard contract (.claude/skills/raagam-keyboard-contract):
   *   ↓      open the list when closed, move the highlight down when open
   *   ↑      move the highlight up when open; when CLOSED, bubble untouched so
   *          the keyboard-nav provider moves to the field above. ↑ must not be a
   *          second way to open a list, or a dropdown becomes a one-way door.
   *   Enter  pick the highlight and close — when closed, bubble so the provider
   *          moves to the next field (and saves off the last one)
   *   Tab    close the list without choosing, and let focus move on. Never
   *          preventDefault: the move itself belongs to native order or to
   *          Sheet's focus trap.
   *   Esc    close the list only, never the surrounding editor
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        if (e.key === "ArrowUp") return; // bubbles: "the field above"
        e.preventDefault();
        e.stopPropagation();
        return openList();
      }
      // Arrows are consumed here; without stopPropagation a combobox sitting in
      // a grid cell would move the highlight AND jump the grid a row.
      e.preventDefault();
      e.stopPropagation();
      // A ROW YOU CANNOT PICK IS A ROW YOU CANNOT LAND ON — what a native
      // <select> does with a disabled <option>. Step OVER disabled rows rather
      // than onto them, or ↓ walks the operator onto a dead Enter. Clamped, not
      // wrapping, exactly as before: holding ↓ stops at the end.
      setHighlight((h) => {
        const step = e.key === "ArrowDown" ? 1 : -1;
        for (let i = h + step; i >= 0 && i < filtered.length; i += step) {
          if (!filtered[i].disabled) return i;
        }
        return h; // nothing choosable that way — stay put
      });
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        // Don't let the Sheet's Enter-advance also fire.
        e.preventDefault();
        e.stopPropagation();
        // The mouse refuses a disabled row; so must Enter, and by doing NOTHING
        // rather than falling through to the next choosable one — committing
        // something other than what is visibly highlighted is worse than not
        // moving. Arrow movement no longer lands here; this is the backstop for
        // a highlight seeded on open or by typing.
        if (filtered[highlight].disabled) return;
        commit(filtered[highlight].value);
      }
    } else if (e.key === "Tab") {
      // Tab moves on, always (client 2026-07-28). It used to be swallowed while
      // the list was open, so an operator could not tab past a dropdown without
      // seeing it; that rule went away with "a second Tab opens the list", and
      // Tab is now purely movement.
      //
      // Close WITHOUT committing — "Tab never changes a value" is the rule that
      // survived — and deliberately do NOT preventDefault, or focus would stay
      // put: the move itself belongs to native tab order, or to Sheet's trap.
      //
      // "Tab always moves" has since acquired exactly one exception, and there
      // is nothing to do about it here: a field showing a live duplicate-name
      // error is held by a window-capture listener
      // (components/shell/keyboard-nav-provider.tsx) that stops the event
      // before React dispatches, so this branch never runs for a held field.
      if (open) {
        setOpen(false);
        setQuery("");
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    }
  }

  // The input shows the live query while open, else the selected label.
  const shownValue = open ? query : selected?.label ?? "";

  // An `<input>` clips without an ellipsis, so a label longer than the control
  // simply stopped mid-word and read as the whole value. See data-picker.tsx.
  const { ref: valueRef, overflowing: valueClipped } = useOverflow<HTMLInputElement>(shownValue);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Tooltip
        label={selected?.label ?? ""}
        touch
        disabled={!selected || open || !valueClipped}
        className="block w-full"
      >
      <input
        id={id}
        ref={(el) => {
          inputRef.current = el;
          valueRef.current = el;
        }}
        type="text"
        role="combobox"
        aria-expanded={open}
        // Mandatory and blank holds the cursor, declared by the enclosing
        // `<Field required>`. Safe on a combobox precisely because `role
        // ="combobox"` is one of the two things the hold checks before refusing
        // ↓ — the list still opens, which is the only keyboard way to fill it.
        {...hold}
        // Same pairing as data-picker.tsx: `off` for Chrome's own list, the
        // `data-*` trio for the password managers that ignore it.
        autoComplete="off"
        data-1p-ignore=""
        data-lpignore="true"
        data-form-type="other"
        disabled={disabled}
        value={shownValue}
        placeholder={selected ? selected.label : placeholder}
        onFocus={openOnFocus ? openList : undefined}
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          // The first CHOOSABLE match of the NEW query — not index 0, which may
          // be greyed, and not the stale `filtered`, which is still the previous
          // render's. Either would leave Enter refusing what looks highlighted.
          const next = matching(q).findIndex((o) => !o.disabled);
          setHighlight(next < 0 ? 0 : next);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          // @2xl/editor:h-8 — compact density. This is the control a desktop
          // <Select> actually renders (select.tsx upgrades to Combobox on a fine
          // pointer), so missing it here would leave every dropdown 4px taller
          // than the inputs beside it. See components/ui/input.tsx.
          "h-9 @2xl/editor:h-8 w-full rounded-md border border-border bg-surface px-3 pr-8 text-base md:text-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Makes a clipped label end in "…" instead of stopping mid-word.
          // truncate-reveal: exempt -- the ellipsis half of the rule; the
          // reveal half is the <Tooltip> wrapping this input.
          "text-ellipsis",
          !selected && !open && "text-muted-foreground",
          // LAST, so a caller can override the height, text size and padding
          // above. `className` styles the wrapper (width and the anchor the
          // chevron and the popup are positioned against); this styles the box
          // the operator actually sees.
          inputClassName,
        )}
      />
      </Tooltip>
      {clearable && selected && !open ? (
        <button
          type="button"
          aria-label="Clear"
          // Out of the Tab order, same as DataPicker's clear (data-picker.tsx:755).
          // It renders ONLY once a value is chosen and sits inside the input's pr-8,
          // so leaving it focusable made "Tab after picking" look like it did nothing
          // — focus had moved onto a ✕ drawn on top of the field. `lib/focus.ts`
          // enumerates `button`, so this also keeps it out of the ↑↓←→ spatial walk
          // and the Sheet focus trap, not just native Tab. Clicking still clears.
          tabIndex={-1}
          onClick={() => commit("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4 shrink-0" />
        </button>
      ) : (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          <ChevronDown className="h-4 w-4 shrink-0" />
        </span>
      )}

      {open &&
        rect &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 150 }}
            className="max-h-60 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matches.</li>
            )}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled ? true : undefined}
                // Focus stays in the input, so use mousedown to beat the blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (o.disabled) return;
                  commit(o.value);
                }}
                // Hover does not park the highlight on a row Enter will refuse.
                onMouseEnter={() => { if (!o.disabled) setHighlight(i); }}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  o.disabled && "cursor-not-allowed opacity-40",
                  i === highlight ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-surface-muted",
                )}
              >
                {o.label}
                {o.sublabel && <span className="ml-2 text-xs text-muted-foreground">{o.sublabel}</span>}
                {/* In words. 40% opacity on its own reads as a rendering
                    glitch rather than as a reason. */}
                {o.disabled && o.disabledNote && (
                  <span className="ml-2 text-xs text-muted-foreground">{o.disabledNote}</span>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
