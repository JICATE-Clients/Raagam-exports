"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Info, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { updateLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup, LookupKind } from "@/lib/masters/extras-types";
import { PICKER_TRIGGER_CLASS } from "@/components/masters/picker-classes";
import { pickerKeyDown, usePickerFocusReturn } from "@/components/masters/picker-keys";

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
  canCreate?: boolean;
  canEdit?: boolean;
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
  // Hand the cursor back to this picker's trigger when the dialog closes —
  // removing the focused node strands focus on <body>. See picker-keys.ts.
  usePickerFocusReturn(open);
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
  function commit(id: string) {
    onChange(id);
    close();
  }

  function startAdd() {
    setFormEditId(null);
    setCode("");
    setName("");
    setMode("form");
  }
  function startModify(id: string) {
    const o = all.find((x) => x.id === id);
    if (!o) return;
    setHighlightId(id);
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

  const onListKeyDown = pickerKeyDown({
    items: filtered,
    keyOf: (r) => r.id,
    highlight: highlightId,
    setHighlight: setHighlightId,
    onPick: onChange,
    // One layer per Escape: out of the Add/Modify form back to the list, and
    // only then out of the dialog — so Escape never discards a half-typed new
    // entry AND the picker in one press.
    onClose: () => (mode === "form" ? setMode("list") : close()),
    active: mode === "list",
  });

  const selectedLabel = selected ? selected.name : `— Select ${label} —`;

  const trigger = (
    <button
      type="button"
      onClick={openDialog}

      data-field-trigger
      // Enter on the last row of a child grid adds the next row — but only from
      // a picker that already holds a value, or holding Enter would stack rows
      // nobody has filled in. Stated both ways round because gridKeyNav reads it
      // as opt-in (child-grid.tsx).
      data-field-empty={value ? "false" : "true"}
      className={PICKER_TRIGGER_CLASS}
    >
      <span className={"truncate " + (selected ? "text-foreground" : "text-muted-foreground")}>
        {selectedLabel}
      </span>
      <Info className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
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
              // ↑/↓/Enter/Escape/Tab for the whole dialog — bound here rather
              // than on the search box so the keys still work once focus has
              // moved on to a row or to Cancel. See picker-keys.ts.
              onKeyDown={onListKeyDown}
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
                  <div className="min-h-0 flex-1 overflow-auto">
                    {filtered.length === 0 ? (
                      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No {label.toLowerCase()} found.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((o) => (
                            <tr
                              key={o.id}
                              ref={
                                highlightId === o.id
                                  ? (el) => el?.scrollIntoView({ block: "nearest" })
                                  : undefined
                              }
                              onClick={() => commit(o.id)}
                              onMouseEnter={() => setHighlightId(o.id)}
                              className={
                                "group cursor-pointer border-t border-border " +
                                (highlightId === o.id ? "bg-primary/10" : "hover:bg-surface-muted")
                              }
                            >
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span>{o.name}</span>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      aria-label="Modify"
                                      title="Modify"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startModify(o.id);
                                      }}
                                      className="shrink-0 text-muted-foreground opacity-0 focus-visible:opacity-100 hover:text-foreground group-hover:opacity-100"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
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
                    <div className="flex-1" />
                    <Button type="button" variant="outline" size="md" onClick={close}>
                      Cancel
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
                        uppercase
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
