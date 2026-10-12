"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * AN ORDERED LIST OF SHORT VALUES AS CHIPS IN ONE BOX (user 2026-10-12, Size
 * Group's table row, option B of the "Size Group Row Options" artifact: "B
 * apply pannidu"). The sizes stacked one input per line, so every size made the
 * row a line taller; here they sit as chips in a single box that wraps only
 * when it runs out of width.
 *
 * - **Enter or comma adds** what is typed; Backspace in an empty box removes
 *   the last chip; the ✕ on a chip removes that one. Enter is `preventDefault`ed
 *   only when it adds, so Enter in an empty box still advances like any field.
 * - **The typed text is the caller's state (`draft`)**, not this component's —
 *   Save and Ctrl+S read it, so a size typed and not yet Entered is not lost.
 *   `onBlur` also folds it into a chip.
 * - **A value already in the list is refused** (`same` decides what "already"
 *   means — the screen's own normaliser), with a line saying so.
 * - **The inner box is the `Input` primitive**, so capitals, the autofill
 *   opt-outs and the keyboard contract come with it. Its own border is removed;
 *   the outer box draws one, and lights up while the caret is inside.
 * - The chip ✕ is off the Tab path (`tabIndex={-1}`): Tab lands on fields only.
 */
export function ChipListInput({
  id,
  values,
  onChange,
  draft,
  onDraftChange,
  placeholder,
  same = (a, b) => a.trim().toUpperCase() === b.trim().toUpperCase(),
  label = "value",
  className,
}: {
  id?: string;
  values: string[];
  onChange: (next: string[]) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  placeholder?: string;
  /** Are two values the same entry? Defaults to a trimmed, case-blind match. */
  same?: (a: string, b: string) => boolean;
  /** What one value is called, for the remove label and the refusal ("size"). */
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);

  /** Fold the typed text into a chip. Returns whether anything was typed. */
  function commit(): boolean {
    const v = draft.trim().toUpperCase();
    if (!v) return false;
    if (values.some((x) => same(x, v))) {
      setRefused(v);
      return true;
    }
    onChange([...values, v]);
    onDraftChange("");
    setRefused(null);
    return true;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      // An empty box lets Enter through to advance; comma never types a comma.
      if (commit() || e.key === ",") e.preventDefault();
    } else if (e.key === "Backspace" && !draft && values.length > 0) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className={cn("w-fit max-w-full", className)}>
      <div
        className="flex min-h-8 flex-wrap items-center gap-1 rounded-control border border-border bg-surface px-1.5 py-1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
        // A click anywhere in the box puts the caret in it.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {values.map((v, i) => (
          <span
            key={`${i}:${v}`}
            className="inline-flex h-6 items-center gap-0.5 rounded-md bg-primary-soft pl-2 pr-0.5 text-xs font-semibold text-foreground"
          >
            {v}
            {/* button-shape: exempt -- a 16px ✕ inside a chip, an icon not a worded button */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove ${label} ${v}`}
              onClick={() => {
                onChange(values.filter((_, j) => j !== i));
                inputRef.current?.focus();
              }}
              className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-danger-soft hover:text-danger"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <Input
          ref={inputRef}
          id={id}
          value={draft}
          placeholder={values.length === 0 ? placeholder : undefined}
          aria-label={`Add a ${label}`}
          onChange={(e) => {
            onDraftChange(e.target.value);
            if (refused) setRefused(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            commit();
          }}
          className="h-6 w-16 min-w-16 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 md:text-sm"
        />
      </div>
      {refused && <p className="mt-1 text-xs text-danger">{refused} is already listed.</p>}
    </div>
  );
}
