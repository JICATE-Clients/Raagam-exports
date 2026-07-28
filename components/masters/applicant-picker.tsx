"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Applicant } from "@/lib/masters/applicant-types";
import { PICKER_TRIGGER_CLASS, PICKER_CLEAR_CLASS } from "@/components/masters/picker-classes";
import { pickerKeyDown, usePickerFocusReturn } from "@/components/masters/picker-keys";

/**
 * A select-only version of the legacy ⓘ picker over the `applicants` master:
 * a searchable Short-Name/Name grid with OK / Cancel (double-click to pick).
 * Unlike <LookupDialogPicker> there is NO inline Add/Modify — an Applicant is a
 * rich master (header + Address + contacts) edited on its own screen, so here we
 * only reference existing ones. Used for the Customer form's 5 applicant slots.
 */
export function ApplicantPicker({
  applicants,
  value,
  onChange,
  compact = false,
  label = "Applicant",
  variant = "field",
  addLabel = "+ Add applicant",
}: {
  applicants: Applicant[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
  label?: string;
  /** "field" = a select box; "add" = a dashed pill that appends on pick. */
  variant?: "field" | "add";
  addLabel?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  // Hand the cursor back to this picker's trigger when the dialog closes —
  // removing the focused node strands focus on <body>. See picker-keys.ts.
  usePickerFocusReturn(open);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const selected = applicants.find((a) => a.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? applicants.filter((a) =>
          [a.code, a.name].filter(Boolean).join(" ").toLowerCase().includes(q),
        )
      : applicants;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [applicants, query]);

  function openDialog() {
    setHighlightId(value);
    setQuery("");
    setOpen(true);
  }

  const onListKeyDown = pickerKeyDown({
    items: filtered,
    keyOf: (r) => r.id,
    highlight: highlightId,
    setHighlight: setHighlightId,
    onPick: onChange,
    onClose: () => setOpen(false),
  });

  const selectedLabel = selected ? selected.name : `— Select ${label} —`;

  const trigger =
    variant === "add" ? (
      <button
        type="button"
        onClick={openDialog}

        data-field-trigger
        className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-sm font-medium text-primary hover:border-primary hover:bg-surface-muted"
      >
        {addLabel}
      </button>
    ) : (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openDialog}

          data-field-trigger
          className={PICKER_TRIGGER_CLASS}
        >
          <span className={"truncate " + (selected ? "text-foreground" : "text-muted-foreground")}>
            {selectedLabel}
          </span>
          <Info className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className={PICKER_CLEAR_CLASS}
            aria-label="Clear"
          >
            <X className="h-4 w-4 shrink-0" />
          </button>
        )}
      </div>
    );

  return (
    <div>
      {!compact && variant === "field" && <Label>{label}</Label>}
      {trigger}

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Select ${label}`}
              // ↑/↓/Enter/Escape/Tab for the whole dialog — bound here rather than
              // on the search box so the keys still work once focus has moved on
              // to a row or to Cancel. See picker-keys.ts.
              onKeyDown={onListKeyDown}
              className="relative mt-[8vh] flex max-h-[80vh] w-[94%] max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">Select {label}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-border p-3">
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search short name or name…"
                  className="text-base md:text-sm"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {filtered.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No applicants found.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((a) => (
                        <tr
                          key={a.id}
                          ref={
                            highlightId === a.id
                              ? (el) => el?.scrollIntoView({ block: "nearest" })
                              : undefined
                          }
                          onMouseEnter={() => setHighlightId(a.id)}
                          onClick={() => {
                            onChange(a.id);
                            setOpen(false);
                          }}
                          onDoubleClick={() => {
                            onChange(a.id);
                            setOpen(false);
                          }}
                          className={
                            "cursor-pointer border-t border-border " +
                            (highlightId === a.id ? "bg-primary/10" : "hover:bg-surface-muted")
                          }
                        >
                          <td className="px-4 py-2">{a.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                <div className="flex-1" />
                <Button type="button" variant="outline" size="md" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
