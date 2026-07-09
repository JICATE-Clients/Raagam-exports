"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CostHead } from "@/lib/finance/cost-heads/types";

/**
 * Select-only ⓘ picker over the finance `cost_heads` master — used for the
 * Account Head "Cost head" field. No inline Add/Modify (cost heads are managed
 * in the Finance module), so here we only reference existing ones — mirrors
 * <LocationPicker> / <AccountGroupPicker>.
 */
export function CostHeadPicker({
  costHeads,
  value,
  onChange,
  label = "Cost head",
  compact = false,
}: {
  costHeads: CostHead[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const selected = costHeads.find((c) => c.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? costHeads.filter((c) =>
          [c.code, c.name, c.category].filter(Boolean).join(" ").toLowerCase().includes(q),
        )
      : costHeads;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [costHeads, query]);

  function openDialog() {
    setHighlightId(value);
    setQuery("");
    setOpen(true);
  }
  function confirmSelection() {
    onChange(highlightId);
    setOpen(false);
  }

  const selectedLabel = selected
    ? selected.code
      ? `${selected.code} — ${selected.name}`
      : selected.name
    : `— Select ${label} —`;

  return (
    <div>
      {!compact && <Label>{label}</Label>}
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
                  placeholder="Search code or name…"
                  className="text-base md:text-sm"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No cost heads found.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="w-24 px-4 py-2 text-left font-medium">Code</th>
                        <th className="px-4 py-2 text-left font-medium">Name</th>
                        <th className="w-28 px-4 py-2 text-left font-medium">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => setHighlightId(c.id)}
                          onDoubleClick={() => {
                            onChange(c.id);
                            setOpen(false);
                          }}
                          className={
                            "cursor-pointer border-t border-border " +
                            (highlightId === c.id ? "bg-primary/10" : "hover:bg-surface-muted")
                          }
                        >
                          <td className="px-4 py-2 font-mono text-xs">{c.code ?? "—"}</td>
                          <td className="px-4 py-2">{c.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{c.category ?? "—"}</td>
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
