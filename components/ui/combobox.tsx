"use client";

import { ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
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
  placeholder = "Select…",
  clearable = false,
  disabled = false,
  id,
  className,
  inputClassName,
  openOnFocus = true,
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
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.sublabel ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

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
    setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
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
   *          saves the record
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
      setHighlight((h) =>
        e.key === "ArrowDown" ? Math.min(h + 1, filtered.length - 1) : Math.max(h - 1, 0),
      );
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        // Don't let the Sheet's Enter-advance also fire.
        e.preventDefault();
        e.stopPropagation();
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

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        disabled={disabled}
        value={shownValue}
        placeholder={selected ? selected.label : placeholder}
        onFocus={openOnFocus ? openList : undefined}
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
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
          !selected && !open && "text-muted-foreground",
          // LAST, so a caller can override the height, text size and padding
          // above. `className` styles the wrapper (width and the anchor the
          // chevron and the popup are positioned against); this styles the box
          // the operator actually sees.
          inputClassName,
        )}
      />
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
                // Focus stays in the input, so use mousedown to beat the blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(o.value);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === highlight ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-surface-muted",
                )}
              >
                {o.label}
                {o.sublabel && <span className="ml-2 text-xs text-muted-foreground">{o.sublabel}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
