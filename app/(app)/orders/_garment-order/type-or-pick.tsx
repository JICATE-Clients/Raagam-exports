"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useOverflow } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * TYPE **OR** PICK — a field whose value may be a master row OR whatever the
 * operator typed.
 *
 * ## Why this exists
 *
 * The client's 2026-08-17 list asks for two fields to accept a typed value:
 *
 *   "Allow users to manually type/input color names or numbers (e.g. 0001)
 *    rather than forcing a selection strictly from the master list."
 *   "Change the Reference field to allow manual user input instead of
 *    automatically listing the style number."
 *
 * Neither is a request to DELETE the list. The colour master is 0415, which
 * reversed 0403's free-text colour precisely so that "Navy Blue" and "Dark
 * Blue" stop being two names for one shade — and a third flip back to a plain
 * `<Input>` would throw that away for a buyer code like "0001" that has no
 * business being a master row at all. So the field keeps the list, keeps the
 * FK when a list row is chosen, and additionally accepts a value that is not
 * one. Picking writes `{ id, name }`; typing writes `{ id: null, name }`.
 *
 * ## Why it is LOCAL and not a mode on a shared picker
 *
 * The precedent is `CreatableSubCategoryField` in
 * `components/masters/material-master-screen.tsx`, and its reasoning holds
 * word for word: `Combobox` is what EVERY desktop `<Select>` in the app renders
 * as (`select.tsx` upgrades to it on a fine pointer), so a "free text is a
 * value" branch there would put ~every dropdown in the ERP at risk for the sake
 * of two cells. `DataPicker` is the other candidate and is worse — it is the
 * one shape all stored-data fields share, and "the typed query is a search, not
 * a value" is the invariant that makes it predictable.
 *
 * Local control, SHARED CONTRACT. `role="combobox"` + `aria-expanded` is what
 * `lib/focus.ts` reads to decide whether ↑/↓ belong to the field or to the
 * surface (`ownsArrowKeys`), so browsing, picking and Esc behave here exactly
 * as they do on a Combobox without touching the shared file.
 * `data-field-trigger` is deliberately ABSENT: on an input it would make
 * `arrowOpensPicker` re-click the field on ↓, fighting this component's own
 * handler.
 *
 * ## The list is still a master list
 *
 * `onCreate` keeps the ⓘ/⊕ half of the icon-field convention alive — the row
 * offering to add what is being typed TO the master. Without it, free text
 * would quietly become the only path anyone ever takes and the master would
 * stop growing, which is the failure 0415 was written to prevent. It is offered
 * only when the typed value matches no existing row, because an exact hit is
 * the row the duplicate guard would reject.
 *
 * The dropdown is portaled to `<body>` with fixed positioning measured from the
 * input, like `Combobox`, because these cells sit inside a rail pane and an
 * overlay sheet, both of which are scroll containers that would clip it.
 */
export function TypeOrPick({
  label,
  id,
  options,
  valueId = null,
  text,
  onChange,
  placeholder = "—",
  uppercase = false,
  disabled = false,
  className,
  inputClassName,
  onCreate,
  createNoun = "value",
}: {
  /** Names the field for screen readers; the `<Field>` above draws the label. */
  label: string;
  id?: string;
  options: { id: string; name: string; note?: string }[];
  /** The master row the record holds, or null when the value was typed. */
  valueId?: string | null;
  /** The value itself — always text, whether it was picked or typed. */
  text: string;
  onChange: (next: { id: string | null; name: string }) => void;
  placeholder?: string;
  uppercase?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  /** Add the typed value to the master. Returns its new id, or null on failure
   *  (the caller toasts). Omit to leave the field type-or-pick only. */
  onCreate?: (name: string) => Promise<string | null>;
  /** The word in "+ Add … as a new colour". */
  createNoun?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [creating, setCreating] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /* `useOverflow` owns its own ref — the two are joined on the element below,
     the same way `Combobox` joins them. */
  const { ref: valueRef, overflowing: clipped } = useOverflow<HTMLInputElement>(text);

  const typed = text.trim();
  /*
   * FILTERED BY THE TEXT, EXCEPT WHEN THE TEXT IS THE PICKED ROW.
   *
   * This field's input holds the VALUE, not a search box's query — so after
   * picking NAVY BLUE the text is "NAVY BLUE", and filtering by it would leave
   * the list showing one row: the row already chosen. Re-opening a field to
   * change your mind has to show the alternatives, so an exact hit means "show
   * everything".
   */
  const exact = options.find((o) => o.name.trim().toUpperCase() === typed.toUpperCase()) ?? null;
  const matches =
    !typed || exact ? options : options.filter((o) => o.name.toUpperCase().includes(typed.toUpperCase()));

  type Row =
    | { kind: "option"; option: { id: string; name: string; note?: string } }
    | { kind: "create" };
  const rows: Row[] = [
    ...matches.map((option) => ({ kind: "option", option }) as Row),
    ...(onCreate && typed && !exact ? [{ kind: "create" } as Row] : []),
  ];

  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);
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
  // Close on a click outside the input or the portaled list.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function openList() {
    setHighlight(Math.max(0, rows.findIndex((r) => r.kind === "option" && r.option.id === valueId)));
    setOpen(true);
  }

  /* No `blur()` on commit — dropping focus to `<body>` is what sends the next
     Tab back to the top of the surface (the same note stands in
     components/ui/combobox.tsx). */
  async function commit(row: Row | undefined) {
    if (!row || creating) return;
    if (row.kind === "option") {
      onChange({ id: row.option.id, name: row.option.name });
      setOpen(false);
      return;
    }
    setCreating(true);
    const created = await onCreate?.(typed);
    setCreating(false);
    if (created) {
      onChange({ id: created, name: typed });
      setOpen(false);
    }
    // Failed create: the list stays open with the typed value intact, so the
    // toast's reason (duplicate name, forbidden) can be acted on. The value is
    // NOT lost either way — it is already the field's value, typed.
  }

  /**
   * The keyboard contract, unchanged from `Combobox` and the skill
   * `raagam-keyboard-contract`: ↓ opens / moves down, ↑ moves up but BUBBLES
   * while the list is closed (so it means "the field above" and a dropdown is
   * never a one-way door), Enter picks the highlight and otherwise bubbles to
   * advance, Tab closes without choosing and lets focus move on, Esc closes the
   * list only — one layer per press.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        if (e.key === "ArrowUp") return; // bubbles: "the field above"
        e.preventDefault();
        e.stopPropagation();
        openList();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setHighlight((h) => {
        const n = rows.length;
        if (!n) return 0;
        return e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n;
      });
      return;
    }
    if (e.key === "Enter") {
      if (!open || !rows.length) return; // bubbles: Enter advances
      e.preventDefault();
      e.stopPropagation();
      void commit(rows[highlight]);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return; // bubbles: Esc unwinds the surface
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    /* TAB IS NOT HANDLED HERE, and that is deliberate rather than an omission.
       Tab is delivered by the ONE listener in keyboard-nav-provider.tsx and
       lands on fields; a local handler is how a surface opts itself out of the
       app-wide contract. Closing the list is done on `onBlur` below instead,
       which covers Tab, Shift+Tab and a click elsewhere with one rule — and
       leaving an open list behind is exactly the "escape hatch" the contract
       forbids. (`components/ui/combobox.tsx` keys off Tab directly; it is one of
       the files `audit_keyboard.py` allowlists as a Tab OWNER. This one is
       not, and does not need to be.) */
  }

  return (
    <div className={cn("relative", className)}>
      {/* THE REVEAL HALF of the truncate rule. `text-ellipsis` below makes the
          clipping VISIBLE (a native input has no `text-overflow` of its own, so
          a long value used to stop mid-word with no `…` at all); this makes it
          readable. `touch` is left on — unlike a picker option row, this control
          does not commit on `mousedown`, so a long press reveals without
          choosing anything. */}
      <Tooltip
        label={text}
        touch
        disabled={!text || open || !clipped}
        className="block w-full"
      >
        <Input
          id={id}
          ref={(el) => {
            inputRef.current = el;
            valueRef.current = el;
          }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={label}
          uppercase={uppercase}
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          className={cn(
            // truncate-reveal: exempt -- the ellipsis half of the rule; the
            // reveal half is the <Tooltip> wrapping this input, exactly as in
            // components/ui/combobox.tsx.
            "text-ellipsis",
            inputClassName,
          )}
          onChange={(e) => {
            /* THE TYPED VALUE IS THE VALUE, LIVE — not on blur, not on Enter.
               A commit-on-blur would lose the last thing typed whenever the
               operator saved with Ctrl+S from inside the field, and this screen
               saves that way. Picking a row later overwrites both halves. */
            onChange({ id: null, name: e.target.value });
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => openList()}
          /* Closes on the way out, whichever key or click did it. Picking is
             unaffected: the list's rows commit on `mousedown` with
             `preventDefault`, so focus never leaves the input to reach here. */
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </Tooltip>
      {open &&
        rect &&
        rows.length > 0 &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            aria-label={label}
            className="fixed z-[70] max-h-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {rows.map((row, i) => (
              <li
                key={row.kind === "create" ? "__create" : row.option.id}
                role="option"
                aria-selected={row.kind === "option" && row.option.id === valueId}
                onMouseEnter={() => setHighlight(i)}
                /* `onMouseDown` and not `onClick`: the click would land after
                   the input's blur, by which time the outside-click handler has
                   already closed the list. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  void commit(row);
                }}
                className={cn(
                  "cursor-pointer px-3 py-1.5 text-sm",
                  i === highlight ? "bg-surface-muted" : "",
                )}
              >
                {row.kind === "create" ? (
                  <span className="text-primary">
                    + Add &ldquo;{typed}&rdquo; as a new {createNoun}
                    {creating ? " …" : ""}
                  </span>
                ) : (
                  <>
                    <span>{row.option.name}</span>
                    {row.option.note && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.option.note}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
