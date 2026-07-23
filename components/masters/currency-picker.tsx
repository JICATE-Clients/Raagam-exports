"use client";

import { useEffect, useMemo, useState, useTransition, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { createCurrency, updateCurrency } from "@/lib/masters/extras-actions";
import type { Currency } from "@/lib/masters/types";

/**
 * The legacy blue ⓘ Currency popup, over the existing `currencies` master
 * (PK = code): a searchable Code/Name grid with Add / Modify / OK / Cancel.
 * Add/Modify write through create/updateCurrency, so a currency added here is
 * available everywhere. `value` is the currency **code** (currencies has a text
 * PK, not a uuid). On Modify the code is fixed (it is the primary key).
 * Reusable for any currency-code field (Currency 1/2/3, …).
 */
export function CurrencyPicker({
  label,
  currencies,
  value,
  onChange,
  canCreate,
  canEdit,
  compact = false,
}: {
  label: string;
  currencies: Currency[];
  value: string | null;
  onChange: (code: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  /** Trigger-only (no label) for dense rows. */
  compact?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [formEditCode, setFormEditCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  // Currencies created/updated this session, merged + deduped with server rows.
  const [extra, setExtra] = useState<Currency[]>([]);
  const all = useMemo(() => {
    const byCode = new Map<string, Currency>();
    for (const c of currencies) byCode.set(c.code, c);
    for (const c of extra) byCode.set(c.code, c); // session edits win
    return [...byCode.values()];
  }, [currencies, extra]);

  const selected = all.find((c) => c.code === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? all.filter((c) => [c.code, c.name, c.symbol].filter(Boolean).join(" ").toLowerCase().includes(q))
      : all;
    return [...rows].sort((a, b) => a.code.localeCompare(b.code));
  }, [all, query]);

  function openDialog() {
    setHighlight(value);
    setQuery("");
    setMode("list");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setMode("list");
  }
  function confirmSelection() {
    if (highlight) onChange(highlight);
    close();
  }

  function startAdd() {
    setFormEditCode(null);
    setCode("");
    setName("");
    setSymbol("");
    setMode("form");
  }
  function startModify() {
    const c = all.find((x) => x.code === highlight);
    if (!c) return;
    setFormEditCode(c.code);
    setCode(c.code);
    setName(c.name);
    setSymbol(c.symbol ?? "");
    setMode("form");
  }

  function saveForm() {
    start(async () => {
      const cd = code.trim();
      const nm = name.trim();
      const sy = symbol.trim() || null;
      const payload = { code: cd, name: nm, symbol: sy };
      const res = formEditCode
        ? await updateCurrency(formEditCode, payload)
        : await createCurrency(payload);
      if (!res.ok) return error(res.error);
      setExtra((xs) => [...xs.filter((c) => c.code !== cd), { code: cd, name: nm, symbol: sy }]);
      setHighlight(cd);
      success(formEditCode ? `${label} updated.` : `${label} added.`);
      setMode("list");
      router.refresh();
    });
  }

  function onListKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const idx = filtered.findIndex((c) => c.code === highlight);
      const next =
        e.key === "ArrowDown"
          ? filtered[Math.min(idx + 1, filtered.length - 1)]
          : filtered[Math.max(idx <= 0 ? 0 : idx - 1, 0)];
      setHighlight(next.code);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick =
        highlight && filtered.some((c) => c.code === highlight) ? highlight : filtered[0]?.code;
      if (pick) {
        onChange(pick);
        close();
      }
    }
  }

  const selectedLabel = selected
    ? `${selected.code}${selected.name ? ` — ${selected.name}` : ""}`
    : `— Select ${label} —`;

  return (
    <div>
      {!compact && <Label>{label}</Label>}
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

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Select ${label}`}
              className="relative mt-[8vh] flex max-h-[80vh] w-[94%] max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {mode === "list"
                    ? `Select ${label}`
                    : formEditCode
                      ? `Modify ${label}`
                      : `Add ${label}`}
                </h2>
                <button
                  type="button"
                  onClick={close}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {mode === "list" ? (
                <>
                  <div className="border-b border-border p-3">
                    <Input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={onListKeyDown}
                      placeholder="Search code or name…"
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No currencies found.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                          <tr>
                            <th className="w-24 px-4 py-2 text-left font-medium">Code</th>
                            <th className="px-4 py-2 text-left font-medium">Name</th>
                            <th className="w-16 px-4 py-2 text-left font-medium">Symbol</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((c) => (
                            <tr
                              key={c.code}
                              ref={
                                highlight === c.code
                                  ? (el) => el?.scrollIntoView({ block: "nearest" })
                                  : undefined
                              }
                              onClick={() => setHighlight(c.code)}
                              onDoubleClick={() => {
                                onChange(c.code);
                                close();
                              }}
                              className={
                                "cursor-pointer border-t border-border " +
                                (highlight === c.code ? "bg-primary/10" : "hover:bg-surface-muted")
                              }
                            >
                              <td className="px-4 py-2 font-mono text-xs">{c.code}</td>
                              <td className="px-4 py-2">{c.name}</td>
                              <td className="px-4 py-2 text-muted-foreground">{c.symbol ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                    {canCreate && (
                      <Button type="button" variant="outline" size="md" onClick={startAdd}>
                        Add
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        disabled={!highlight}
                        onClick={startModify}
                      >
                        Modify
                      </Button>
                    )}
                    <div className="flex-1" />
                    <Button type="button" variant="outline" size="md" onClick={close}>
                      Cancel
                    </Button>
                    <Button type="button" size="md" disabled={!highlight} onClick={confirmSelection}>
                      OK
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="cur-code">
                          Code <span className="text-danger">*</span>
                        </Label>
                        <Input
                          id="cur-code"
                          uppercase
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          disabled={!!formEditCode}
                          maxLength={8}
                          className="text-base md:text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="cur-symbol">Symbol</Label>
                        <Input
                          id="cur-symbol"
                          value={symbol}
                          onChange={(e) => setSymbol(e.target.value)}
                          className="text-base md:text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="cur-name">
                        Name <span className="text-danger">*</span>
                      </Label>
                      <Input
                        id="cur-name"
                        autoFocus
                        uppercase
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                    <Button type="button" variant="outline" size="md" onClick={() => setMode("list")}>
                      Back
                    </Button>
                    <Button
                      type="button"
                      size="md"
                      disabled={isPending || !code.trim() || !name.trim()}
                      onClick={saveForm}
                    >
                      {isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
