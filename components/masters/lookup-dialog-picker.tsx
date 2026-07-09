"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { updateLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup, LookupKind } from "@/lib/masters/extras-types";

/**
 * The legacy green ⊕ / blue ⓘ lookup popup, generalized over a `config_lookups`
 * kind: a searchable Code/Name grid with Add / Modify / OK / Cancel. Add and
 * Modify write through the shared config_lookups store (createLookupValue /
 * updateLookup), so a value added or edited here is available everywhere that
 * kind is used — exactly like the legacy picker. Reusable for any config-list
 * FK field (City, State, Department, Designation, Internal Department, …).
 */
export function LookupDialogPicker({
  kind,
  label,
  options,
  value,
  onChange,
  canCreate,
  canEdit,
  required = false,
  compact = false,
}: {
  kind: LookupKind;
  label: string;
  options: ConfigLookup[];
  value: string | null;
  onChange: (id: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  /** Show a required asterisk on the label. */
  required?: boolean;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [formEditId, setFormEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  // Values created/updated this session, merged + deduped with server rows.
  const [extra, setExtra] = useState<ConfigLookup[]>([]);
  const all = useMemo(() => {
    const byId = new Map<string, ConfigLookup>();
    for (const o of options) byId.set(o.id, o);
    for (const o of extra) byId.set(o.id, o); // session edits win
    return [...byId.values()];
  }, [options, extra]);

  const selected = all.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? all.filter((o) => [o.code, o.name].filter(Boolean).join(" ").toLowerCase().includes(q))
      : all;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [all, query]);

  function openDialog() {
    setHighlightId(value);
    setQuery("");
    setMode("list");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setMode("list");
  }
  function confirmSelection() {
    if (highlightId) onChange(highlightId);
    close();
  }

  function startAdd() {
    setFormEditId(null);
    setCode("");
    setName("");
    setMode("form");
  }
  function startModify() {
    const o = all.find((x) => x.id === highlightId);
    if (!o) return;
    setFormEditId(o.id);
    setCode(o.code ?? "");
    setName(o.name);
    setMode("form");
  }

  function saveForm() {
    start(async () => {
      const c = code.trim() || null;
      const n = name.trim();
      if (formEditId) {
        const base = all.find((o) => o.id === formEditId);
        const res = await updateLookup(formEditId, {
          kind,
          code: c,
          name: n,
          notes: null,
          is_active: base?.is_active ?? true,
        });
        if (!res.ok) return error(res.error);
        setExtra((xs) => {
          const merged: ConfigLookup = {
            ...(base ?? {
              id: formEditId,
              kind,
              notes: null,
              is_active: true,
              created_at: "",
              updated_at: "",
            }),
            id: formEditId,
            kind,
            code: c,
            name: n,
          };
          return [...xs.filter((o) => o.id !== formEditId), merged];
        });
        setHighlightId(formEditId);
        success(`${label} updated.`);
      } else {
        const res = await createLookupValue(kind, n, c);
        if (!res.ok) return error(res.error);
        setExtra((xs) => [
          ...xs,
          { id: res.id, kind, code: c, name: n, notes: null, is_active: true, created_at: "", updated_at: "" },
        ]);
        setHighlightId(res.id);
        success(`${label} added.`);
      }
      setMode("list");
      router.refresh();
    });
  }

  const selectedLabel = selected
    ? selected.code
      ? `${selected.code} — ${selected.name}`
      : selected.name
    : `— Select ${label} —`;

  const trigger = (
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
  );

  return (
    <div>
      {!compact && (
        <Label>
          {label} {required && <span className="text-danger">*</span>}
        </Label>
      )}
      {trigger}

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
                    : formEditId
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
                      placeholder="Search code or name…"
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No {label.toLowerCase()} found.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                          <tr>
                            <th className="w-28 px-4 py-2 text-left font-medium">Code</th>
                            <th className="px-4 py-2 text-left font-medium">Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((o) => (
                            <tr
                              key={o.id}
                              onClick={() => setHighlightId(o.id)}
                              onDoubleClick={() => {
                                onChange(o.id);
                                close();
                              }}
                              className={
                                "cursor-pointer border-t border-border " +
                                (highlightId === o.id ? "bg-primary/10" : "hover:bg-surface-muted")
                              }
                            >
                              <td className="px-4 py-2 font-mono text-xs">{o.code ?? "—"}</td>
                              <td className="px-4 py-2">{o.name}</td>
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
                        disabled={!highlightId}
                        onClick={startModify}
                      >
                        Modify
                      </Button>
                    )}
                    <div className="flex-1" />
                    <Button type="button" variant="outline" size="md" onClick={close}>
                      Cancel
                    </Button>
                    <Button type="button" size="md" disabled={!highlightId} onClick={confirmSelection}>
                      OK
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    <div className="w-32">
                      <Label htmlFor="ldp-code">Code</Label>
                      <Input
                        id="ldp-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="ldp-name">
                        Name <span className="text-danger">*</span>
                      </Label>
                      <Input
                        id="ldp-name"
                        autoFocus
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
                    <Button type="button" size="md" disabled={isPending || !name.trim()} onClick={saveForm}>
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
