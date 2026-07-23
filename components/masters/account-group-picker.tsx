"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountGroup } from "@/lib/masters/account-group-types";

/**
 * The legacy ⓘ "Under" picker over the `account_groups` master itself — a
 * searchable Short-Name/Name grid with OK / Cancel (double-click to pick).
 * Select-only (an Account Group is edited on this same screen), and `excludeId`
 * drops the row being edited so a group can't be placed under itself.
 */
export function AccountGroupPicker({
  groups,
  value,
  onChange,
  excludeId = null,
  label = "Under",
}: {
  groups: AccountGroup[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** The group currently being edited — excluded from the list (no self-parent). */
  excludeId?: string | null;
  label?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const selectable = useMemo(
    () => groups.filter((g) => g.id !== excludeId),
    [groups, excludeId],
  );
  const selected = groups.find((g) => g.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? selectable.filter((g) =>
          [g.short_name, g.name].filter(Boolean).join(" ").toLowerCase().includes(q),
        )
      : selectable;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [selectable, query]);

  function openDialog() {
    setHighlightId(value);
    setQuery("");
    setOpen(true);
  }
  function confirmSelection() {
    onChange(highlightId);
    setOpen(false);
  }

  const selectedLabel = selected ? selected.name : `— Select ${label} —`;

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openDialog}
          className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-left text-base md:text-sm hover:border-primary"
        >
          <span className={"truncate " + (selected ? "text-foreground" : "text-muted-foreground")}>
            {selectedLabel}
          </span>
          <span className="ml-2 shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">
            ⓘ
          </span>
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-danger"
            aria-label="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Select ${label}`}
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
                  placeholder="Search name…"
                  className="text-base md:text-sm"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No account groups found.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((g) => (
                        <tr
                          key={g.id}
                          onClick={() => setHighlightId(g.id)}
                          onDoubleClick={() => {
                            onChange(g.id);
                            setOpen(false);
                          }}
                          className={
                            "cursor-pointer border-t border-border " +
                            (highlightId === g.id ? "bg-primary/10" : "hover:bg-surface-muted")
                          }
                        >
                          <td className="px-4 py-2">{g.name}</td>
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
                <Button type="button" size="md" disabled={!highlightId} onClick={confirmSelection}>
                  OK
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
