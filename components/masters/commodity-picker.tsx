"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createCommodity, updateCommodity, deleteCommodity } from "@/lib/masters/commodity-actions";
import type { Commodity, CommodityInput } from "@/lib/masters/commodity-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type FormState = { item_class_id: string; short_name: string; name: string; inactive: boolean };
const BLANK_FORM: FormState = { item_class_id: "", short_name: "", name: "", inactive: false };

/**
 * The legacy ⓘ Commodity popup: a searchable Item Class/Name grid
 * with Add / Modify / Delete / OK / Cancel. Add/Modify/Delete write through
 * the shared Commodity master (create/update/deleteCommodity) — so a
 * commodity added or edited here changes everywhere it is referenced (e.g.
 * Category, Process), exactly like the legacy picker. Reusable for any
 * Commodity FK field.
 */
export function CommodityPicker({
  commodities,
  itemClasses,
  value,
  onChange,
  canCreate,
  canEdit,
  canDelete,
  clearable = true,
  compact = false,
}: {
  commodities: Commodity[];
  itemClasses: ConfigLookup[];
  value: string | null;
  onChange: (id: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  clearable?: boolean;
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
  const [mode, setMode] = useState<"list" | "form" | "delete">("list");
  const [formEditId, setFormEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);

  // Commodities created/updated/deleted in this session, merged + deduped with server rows.
  const [extra, setExtra] = useState<Commodity[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const all = useMemo(() => {
    const byId = new Map<string, Commodity>();
    for (const c of commodities) byId.set(c.id, c);
    for (const c of extra) byId.set(c.id, c); // session edits win
    for (const id of removed) byId.delete(id);
    return [...byId.values()];
  }, [commodities, extra, removed]);

  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [itemClasses]);

  const selected = all.find((c) => c.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? all.filter((c) =>
          [c.short_name, c.name, classLabel.get(c.item_class_id)].filter(Boolean).join(" ").toLowerCase().includes(q),
        )
      : all;
    return [...rows].sort((a, b) => (a.name ?? a.short_name ?? "").localeCompare(b.name ?? b.short_name ?? ""));
  }, [all, query, classLabel]);

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
    setForm(BLANK_FORM);
    setMode("form");
  }
  function startModify() {
    const c = all.find((x) => x.id === highlightId);
    if (!c) return;
    setFormEditId(c.id);
    setForm({
      item_class_id: c.item_class_id,
      short_name: c.short_name ?? "",
      name: c.name ?? "",
      inactive: c.inactive,
    });
    setMode("form");
  }

  function saveForm() {
    start(async () => {
      const payload: CommodityInput = {
        item_class_id: form.item_class_id,
        // merged: Short Name = Name on create; edits keep the stored short name
        short_name: formEditId ? form.short_name.trim() || null : form.name.trim() || null,
        name: form.name.trim() || null,
        inactive: form.inactive,
      };
      if (formEditId) {
        const res = await updateCommodity(formEditId, payload);
        if (!res.ok) {
          error(res.error);
          return;
        }
        setExtra((xs) => {
          const base = all.find((c) => c.id === formEditId)!;
          const merged: Commodity = { ...base, ...payload, id: formEditId };
          return [...xs.filter((c) => c.id !== formEditId), merged];
        });
        setHighlightId(formEditId);
        success("Commodity updated.");
      } else {
        const res = await createCommodity(payload);
        if (!res.ok) {
          error(res.error);
          return;
        }
        setExtra((xs) => [
          ...xs,
          {
            id: res.id,
            item_class_id: payload.item_class_id,
            short_name: payload.short_name ?? null,
            name: payload.name ?? null,
            inactive: payload.inactive,
            created_at: "",
            updated_at: "",
          },
        ]);
        setHighlightId(res.id);
        success("Commodity added.");
      }
      setMode("list");
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!highlightId) return;
    const id = highlightId;
    start(async () => {
      const res = await deleteCommodity(id);
      if (!res.ok) {
        error(res.error);
        return;
      }
      setRemoved((rs) => new Set(rs).add(id));
      if (value === id) onChange("");
      setHighlightId(null);
      success("Commodity deleted.");
      setMode("list");
      router.refresh();
    });
  }

  const selectedLabel = selected ? selected.name || selected.short_name || "—" : "— Select Commodity —";

  return (
    <div>
      {!compact && <Label>Commodity</Label>}
      <button
        type="button"
        onClick={openDialog}
        className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-left text-base md:text-sm hover:border-primary"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>{selectedLabel}</span>
        <span className="ml-2 shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">ⓘ</span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Select Commodity"
              className="relative mt-[8vh] flex max-h-[80vh] w-[94%] max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {mode === "list"
                    ? "Select Commodity"
                    : mode === "delete"
                      ? "Delete Commodity"
                      : formEditId
                        ? "Modify Commodity"
                        : "Add Commodity"}
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

              {mode === "list" && (
                <>
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
                      <p className="px-4 py-10 text-center text-sm text-muted-foreground">No commodities found.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">Item Class</th>
                            <th className="px-4 py-2 text-left font-medium">Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((c) => (
                            <tr
                              key={c.id}
                              onClick={() => setHighlightId(c.id)}
                              onDoubleClick={() => {
                                onChange(c.id);
                                close();
                              }}
                              className={
                                "cursor-pointer border-t border-border " +
                                (highlightId === c.id ? "bg-primary/10" : "hover:bg-surface-muted") +
                                (c.inactive ? " opacity-60" : "")
                              }
                            >
                              <td className="px-4 py-2 text-xs text-muted-foreground">
                                {classLabel.get(c.item_class_id) ?? "—"}
                              </td>
                              <td className="px-4 py-2">
                                {c.name ?? "—"}
                                {c.inactive ? " (inactive)" : ""}
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
                    {canEdit && (
                      <Button type="button" variant="outline" size="md" disabled={!highlightId} onClick={startModify}>
                        Modify
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        className="text-muted-foreground hover:text-danger"
                        disabled={!highlightId}
                        onClick={() => setMode("delete")}
                      >
                        Delete
                      </Button>
                    )}
                    <div className="flex-1" />
                    {clearable && value && (
                      <Button type="button" variant="outline" size="md" onClick={() => onChange("")}>
                        Clear
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="md" onClick={close}>
                      Cancel
                    </Button>
                    <Button type="button" size="md" disabled={!highlightId} onClick={confirmSelection}>
                      OK
                    </Button>
                  </div>
                </>
              )}

              {mode === "delete" && (
                <div className="space-y-3 p-4">
                  <p className="text-sm text-foreground">
                    Delete{" "}
                    <span className="font-medium">
                      {all.find((c) => c.id === highlightId)?.name || all.find((c) => c.id === highlightId)?.short_name}
                    </span>
                    ? If it&apos;s referenced elsewhere (e.g. a Category or Process) the delete will be rejected —
                    this cannot be undone otherwise.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setMode("list")}>
                      Cancel
                    </Button>
                    <Button type="button" variant="danger" size="sm" disabled={isPending} onClick={confirmDelete}>
                      {isPending ? "Deleting…" : "Confirm delete"}
                    </Button>
                  </div>
                </div>
              )}

              {mode === "form" && (
                <>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    <div>
                      <Label htmlFor="cop-class">
                        Item Class <span className="text-danger">*</span>
                      </Label>
                      <Select
                        id="cop-class"
                        value={form.item_class_id}
                        onChange={(e) => setForm((f) => ({ ...f, item_class_id: e.target.value }))}
                        className="text-base md:text-sm"
                      >
                        <option value="">— Select —</option>
                        {itemClasses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {classLabel.get(c.id)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="cop-name">
                        Name <span className="text-danger">*</span>
                      </Label>
                      <Input
                        id="cop-name"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        className="text-base md:text-sm"
                      />
                    </div>
                    {formEditId && (
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={form.inactive}
                          onChange={(e) => setForm((f) => ({ ...f, inactive: e.target.checked }))}
                        />
                        <span className="text-sm text-foreground">Inactive</span>
                      </label>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                    <Button type="button" variant="outline" size="md" onClick={() => setMode("list")}>
                      Back
                    </Button>
                    <Button type="button" size="md" disabled={isPending || !form.item_class_id || !form.name.trim()} onClick={saveForm}>
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
