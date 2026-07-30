"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createCommodity, updateCommodity, deleteCommodity } from "@/lib/masters/commodity-actions";
import type { Commodity, CommodityInput } from "@/lib/masters/commodity-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type FormState = { item_class_id: string; short_name: string; name: string; inactive: boolean };
const BLANK_FORM: FormState = { item_class_id: "", short_name: "", name: "", inactive: false };

/**
 * The Commodity field (Category, Process, Material).
 *
 * A `DataPicker` plus a quick-create sheet for Add / Modify: a Commodity must
 * belong to an Item Class, and one created name-only would be unclassified —
 * invisible to every screen that filters by class. Config lists take the
 * picker's inline form; anything with real fields takes this one (client
 * 2026-07-29).
 *
 * Add / Modify / Delete write through the shared Commodity master, so a change
 * made here shows up everywhere the commodity is referenced — the behaviour the
 * legacy ⓘ popup had, kept.
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

  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name);
    return m;
  }, [itemClasses]);

  const [extra, setExtra] = useState<Commodity[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);

  const all = useMemo(() => {
    const byId = new Map<string, Commodity>();
    for (const c of commodities) byId.set(c.id, c);
    for (const c of extra) byId.set(c.id, c);
    for (const id of removed) byId.delete(id);
    return [...byId.values()];
  }, [commodities, extra, removed]);

  const rows: PickerRow[] = useMemo(
    () =>
      [...all]
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map((c) => ({
          id: c.id,
          label: c.name ?? "",
          // The class is what disambiguates two commodities of the same name,
          // and it was a column in the dialog this replaced.
          sublabel: c.item_class_id ? (classLabel.get(c.item_class_id) ?? null) : null,
        })),
    [all, classLabel],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [formEditId, setFormEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const commitRef = useRef<((id: string) => void) | null>(null);

  function openAdd(commit: (id: string) => void) {
    commitRef.current = commit;
    setFormEditId(null);
    setForm(BLANK_FORM);
    setFormOpen(true);
  }
  function openEdit(row: PickerRow, commit: (id: string) => void) {
    const c = all.find((x) => x.id === row.id);
    if (!c) return;
    commitRef.current = commit;
    setFormEditId(c.id);
    setForm({
      item_class_id: c.item_class_id ?? "",
      short_name: c.short_name ?? "",
      name: c.name ?? "",
      inactive: c.inactive,
    });
    setFormOpen(true);
  }

  function saveForm() {
    start(async () => {
      const payload: CommodityInput = {
        item_class_id: form.item_class_id,
        // Short Name = Name on create; an edit keeps the stored short name,
        // which can already be a logic key elsewhere.
        short_name: formEditId ? form.short_name.trim() || null : form.name.trim() || null,
        name: form.name.trim() || null,
        inactive: form.inactive,
      };
      if (formEditId) {
        const res = await updateCommodity(formEditId, payload);
        if (!res.ok) return error(res.error);
        const base = all.find((c) => c.id === formEditId);
        if (base) {
          setExtra((xs) => [
            ...xs.filter((c) => c.id !== formEditId),
            { ...base, ...payload, id: formEditId },
          ]);
        }
        success("Commodity updated.");
      } else {
        const res = await createCommodity(payload);
        if (!res.ok) return error(res.error);
        setExtra((xs) => [
          ...xs,
          { ...payload, id: res.id, created_at: "", updated_at: "" } as unknown as Commodity,
        ]);
        success("Commodity added.");
        commitRef.current?.(res.id);
      }
      setFormOpen(false);
      router.refresh();
    });
  }

  const manage: ManageConfig = {
    canCreate,
    canEdit,
    canDelete,
    // Unreachable — the two overrides below intercept first. Present because
    // ManageConfig is also what decides which row icons render.
    onCreate: async () => ({ ok: false, error: "Use the Commodity form." }),
    onUpdate: async () => ({ ok: false, error: "Use the Commodity form." }),
    onDelete: (id) => deleteCommodity(id),
    onCreated: () => {},
    onUpdated: () => {},
    onDeleted: (id, wasDeactivated) => {
      setRemoved((xs) => [...xs, id]);
      if (!wasDeactivated) setExtra((xs) => xs.filter((c) => c.id !== id));
      router.refresh();
    },
    draftOf: (r) => ({ code: all.find((c) => c.id === r.id)?.short_name ?? "", name: r.label }),
  };

  return (
    <>
      <DataPicker
        label="Commodity"
        rows={rows}
        value={value}
        onChange={(id) => onChange(id ?? "")}
        clearable={clearable}
        compact={compact}
        manage={manage}
        onAddOverride={openAdd}
        onEditOverride={openEdit}
      />

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="sm"
        title={formEditId ? "Modify Commodity" : "Add Commodity"}
        footer={
          <>
            <Button type="button" variant="outline" size="md" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="md"
              disabled={isPending || !form.name.trim() || !form.item_class_id}
              onClick={saveForm}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="cop-class">
              Item Class <span className="text-danger">*</span>
            </Label>
            <Select
              id="cop-class"
              value={form.item_class_id}
              onChange={(e) => setForm((f) => ({ ...f, item_class_id: e.target.value }))}
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
              autoFocus
              uppercase
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
      </Sheet>
    </>
  );
}
