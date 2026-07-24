"use client";

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
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
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
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openList();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        // Don't let the Sheet's Enter-advance also fire.
        e.preventDefault();
        e.stopPropagation();
        commit(filtered[highlight].value);
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
        onFocus={openList}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-surface px-3 pr-8 text-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !selected && !open && "text-muted-foreground",
        )}
      />
      {clearable && selected && !open ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => commit("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      ) : (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          ⌄
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
