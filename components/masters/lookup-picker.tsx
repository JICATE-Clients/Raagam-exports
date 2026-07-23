"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import { createCategory, updateCategory, deleteCategory } from "@/lib/masters/category-actions";
import { quickCreateMaterial, renameMaterial, deleteMaterial } from "@/lib/masters/material-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import type { ConfigLookup, LookupKind, AttributeValue } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { Category } from "@/lib/masters/category-types";

// ============================================================================
// Shared "stored-data" picker: mirrors the legacy ⓘ lookup popup — click the
// field, a searchable list opens (in a nested Sheet) with OK/Cancel, and
// (when `manage` is given) inline Add/Modify. Config-list masters get the
// full picker (`LookupDialogPicker`); masters with their own dedicated
// management screen (e.g. Levy) get the select-only variant (`LevyPicker`) —
// search + OK/Cancel/Clear, no inline Add/Modify.
// ============================================================================

export type PickerRow = {
  id: string;
  label: string;
  sublabel?: string | null;
  disabled?: boolean;
};

type PickerDraft = { code: string; name: string; typeCode?: string };
type ManageConfig = {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onCreate: (draft: PickerDraft) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  onUpdate: (id: string, draft: PickerDraft) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDelete: (id: string) => Promise<{ ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string }>;
  onCreated: (id: string, draft: PickerDraft) => void;
  onUpdated: (id: string, draft: PickerDraft) => void;
  onDeleted: (id: string, inactive: boolean) => void;
  draftOf: (row: PickerRow) => PickerDraft;
  /** Show a "Type" field in the Add/Modify form — only meaningful for
   *  kind='item_class' (0287); every other manage config omits this. */
  showTypeField?: boolean;
};

function DialogListPicker({
  label,
  title,
  rows,
  value,
  onChange,
  placeholder = "— None —",
  clearable = true,
  required = false,
  manage,
}: {
  label: string;
  /** Dialog title + toast noun when `label` is blank (e.g. grid cells whose
   *  column header already names the field). Defaults to `label`. */
  title?: string;
  rows: PickerRow[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  required?: boolean;
  manage?: ManageConfig;
}) {
  const noun = title || label;
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "add" | "edit" | "delete">("list");
  const [draftCode, setDraftCode] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState("");

  const selected = rows.find((r) => r.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.label} ${r.sublabel ?? ""}`.toLowerCase().includes(q));
  }, [rows, query]);

  function openPicker() {
    setQuery("");
    setHighlighted(value || null);
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

  /** ↓/↑ walk the filtered list, Enter = OK (client 2026-07-23). The search
   *  input keeps focus the whole time — arrows only move the highlight. */
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const idx = filtered.findIndex((r) => r.id === highlighted);
      const next =
        e.key === "ArrowDown"
          ? filtered[Math.min(idx + 1, filtered.length - 1)]
          : filtered[Math.max(idx <= 0 ? 0 : idx - 1, 0)];
      setHighlighted(next.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = highlighted && filtered.some((r) => r.id === highlighted) ? highlighted : filtered[0]?.id;
      if (pick) commit(pick);
    }
  }

  function startAdd() {
    setDraftCode("");
    setDraftName("");
    setDraftType("");
    setMode("add");
  }
  function startEdit() {
    const row = rows.find((r) => r.id === highlighted);
    if (!row || !manage) return;
    const d = manage.draftOf(row);
    setDraftCode(d.code);
    setDraftName(d.name);
    setDraftType(d.typeCode ?? "");
    setMode("edit");
  }

  function saveAdd() {
    if (!manage) return;
    start(async () => {
      // merged: Code = Name on create (no Code input anymore)
      const draft: PickerDraft = { code: draftName.trim(), name: draftName.trim(), typeCode: draftType.trim() };
      const res = await manage.onCreate(draft);
      if (res.ok) {
        manage.onCreated(res.id, draft);
        success(`${noun} added.`);
        commit(res.id);
      } else {
        error(res.error);
      }
    });
  }
  function saveEdit() {
    if (!manage || !highlighted) return;
    const id = highlighted;
    start(async () => {
      // draftCode is the record's original stored code (set in startEdit, never
      // rendered) — existing codes can be logic keys and must not be overwritten.
      const draft: PickerDraft = { code: draftCode.trim(), name: draftName.trim(), typeCode: draftType.trim() };
      const res = await manage.onUpdate(id, draft);
      if (res.ok) {
        manage.onUpdated(id, draft);
        success(`${noun} updated.`);
        setMode("list");
      } else {
        error(res.error);
      }
    });
  }
  function confirmDelete() {
    if (!manage || !highlighted) return;
    const id = highlighted;
    start(async () => {
      const res = await manage.onDelete(id);
      if (res.ok) {
        manage.onDeleted(id, res.inactive);
        if (!res.inactive && value === id) onChange("");
        success(deletedToast(noun.replace(/s$/, ""), res));
        setHighlighted(res.inactive ? id : null);
        setMode("list");
      } else {
        error(res.error);
      }
    });
  }

  const canManage = !!manage && (manage.canCreate || manage.canEdit || manage.canDelete);

  return (
    <div>
      <Label>
        {label} {required && <span className="text-danger">*</span>}
      </Label>
      <button
        type="button"
        onClick={openPicker}
        className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-left text-base text-foreground md:text-sm"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? `${selected.label}${selected.disabled ? " (inactive)" : ""}` : placeholder}
        </span>
        <span className="ml-2 shrink-0 text-muted-foreground">⌄</span>
      </button>

      <Sheet
        open={open}
        onClose={close}
        title={noun}
        zIndexBase={100}
        size="sm"
        footer={
          mode === "list" ? (
            <>
              <Button type="button" variant="outline" size="md" onClick={close}>
                Cancel
              </Button>
              {clearable && value && (
                <Button type="button" variant="outline" size="md" onClick={() => commit("")}>
                  Clear
                </Button>
              )}
              <Button
                type="button"
                size="md"
                disabled={!highlighted}
                onClick={() => highlighted && commit(highlighted)}
              >
                OK
              </Button>
            </>
          ) : undefined
        }
      >
        {mode === "list" && (
          <div className="space-y-2.5">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKeyDown}
              placeholder="Search…"
              className="sticky top-0 text-base md:text-sm"
            />
            {canManage && (
              <div className="flex gap-2">
                {manage!.canCreate && (
                  <Button type="button" variant="outline" size="sm" onClick={startAdd}>
                    + Add
                  </Button>
                )}
                {manage!.canEdit && (
                  <Button type="button" variant="outline" size="sm" disabled={!highlighted} onClick={startEdit}>
                    Modify
                  </Button>
                )}
                {manage!.canDelete && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-muted-foreground hover:text-danger"
                    disabled={!highlighted}
                    onClick={() => setMode("delete")}
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}
            <div className="max-h-[50vh] space-y-1 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-1 py-4 text-center text-sm text-muted-foreground">No matches.</p>
              )}
              {filtered.map((r) => (
                <div
                  key={r.id}
                  // Ref-callback identity changes with the highlight, so the
                  // newly highlighted row scrolls itself into view on ↓/↑.
                  ref={highlighted === r.id ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                  onClick={() => setHighlighted(r.id)}
                  onDoubleClick={() => commit(r.id)}
                  className={cn(
                    "min-h-11 cursor-pointer rounded-lg border px-3 py-2.5 text-sm",
                    highlighted === r.id
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:bg-surface-muted",
                  )}
                >
                  <div className="text-foreground">
                    {r.label}
                    {r.disabled ? " (inactive)" : ""}
                  </div>
                  {r.sublabel && <div className="text-xs text-muted-foreground">{r.sublabel}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "delete" && (
          <div className="space-y-2.5 rounded-lg border border-danger/40 bg-danger/5 p-3">
            <p className="text-sm text-foreground">
              Delete <span className="font-medium">{rows.find((r) => r.id === highlighted)?.label}</span>? If
              it&apos;s used elsewhere it will be marked <span className="font-medium">inactive</span> instead,
              keeping past records intact. This cannot be undone if it&apos;s unused.
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

        {(mode === "add" || mode === "edit") && (
          <div className="space-y-3">
            <div>
              <Label>
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                autoFocus
                uppercase
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  // Enter = save (client 2026-07-23)
                  if (e.key === "Enter" && !isPending && draftName.trim()) {
                    e.preventDefault();
                    (mode === "edit" ? saveEdit : saveAdd)();
                  }
                }}
                className="text-base md:text-sm"
              />
            </div>
            {manage?.showTypeField && (
              <div>
                <Label>Type</Label>
                <Input
                  uppercase
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value)}
                  placeholder="Functional grouping (e.g. FAB, GEN)"
                  className="text-base md:text-sm"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="md" onClick={() => setMode("list")}>
                Back
              </Button>
              <Button
                type="button"
                size="md"
                disabled={isPending || !draftName.trim()}
                onClick={mode === "edit" ? saveEdit : saveAdd}
              >
                {isPending ? "Saving…" : mode === "edit" ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/**
 * A config_lookups picker with inline **Add**, **Modify** and **Delete** —
 * mirrors the legacy ⓘ lookup popup (search + grid + Add/Modify). Add is
 * gated by `canCreate` (and, when `adminOnly` is set, additionally by
 * `isSuperAdmin` — legacy behavior for masters like Structure that should
 * only be extended on-the-fly by admins). Modify by `canEdit`, Delete by
 * `canDelete`. Delete always confirms first; if the value is referenced
 * elsewhere the server blocks (soft-disables) it instead of deleting, to
 * preserve history.
 */
export function LookupDialogPicker({
  kind,
  label,
  options,
  value,
  onChange,
  canCreate,
  canEdit = false,
  canDelete = false,
  isSuperAdmin = false,
  adminOnly = false,
  required = false,
}: {
  kind: LookupKind;
  label: string;
  options: ConfigLookup[];
  value: string;
  onChange: (v: string) => void;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  isSuperAdmin?: boolean;
  adminOnly?: boolean;
  required?: boolean;
}) {
  const router = useRouter();
  const [extra, setExtra] = useState<ConfigLookup[]>([]);
  const canAdd = canCreate && (!adminOnly || isSuperAdmin);
  // Type is a functional grouping distinct from Code — only meaningful for
  // kind='item_class' (matches the legacy "Itemclass Type" column, 0287).
  const showTypeField = kind === "item_class";

  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...options, ...extra].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  }, [options, extra]);

  const byId = useMemo(() => new Map(all.map((o) => [o.id, o])), [all]);

  // Inactive values must be excluded from new selections but stay resolvable
  // for a record that already references them. Codes are backend-only
  // (client 2026-07-23) — show just the name.
  const rows: PickerRow[] = useMemo(
    () =>
      all
        .filter((o) => o.is_active || o.id === value)
        .map((o) => ({
          id: o.id,
          label: o.name,
          disabled: !o.is_active,
        })),
    [all, value],
  );

  const manage: ManageConfig | undefined =
    canAdd || canEdit || canDelete
      ? {
          canCreate: !!canAdd,
          canEdit: !!canEdit,
          canDelete: !!canDelete,
          showTypeField,
          onCreate: (d) => createLookupValue(kind, d.name, d.code || null, d.typeCode || null),
          onUpdate: (id, d) => {
            const existing = byId.get(id);
            return updateLookup(id, {
              kind,
              code: d.code || null,
              name: d.name,
              type_code: showTypeField ? d.typeCode || null : existing?.type_code ?? null,
              notes: null,
              is_active: existing?.is_active ?? true,
            });
          },
          onDelete: (id) => deleteLookup(id),
          onCreated: (id, d) => {
            setExtra((xs) => [
              ...xs,
              { id, kind, code: d.code || null, name: d.name, type_code: d.typeCode || null, notes: null, is_active: true, created_at: "", updated_at: "" },
            ]);
            router.refresh();
          },
          onUpdated: (id, d) => {
            setExtra((xs) => {
              const has = xs.some((o) => o.id === id);
              if (has) return xs.map((o) => (o.id === id ? { ...o, code: d.code || null, name: d.name, type_code: d.typeCode || null } : o));
              const base = options.find((o) => o.id === id);
              return base ? [...xs, { ...base, code: d.code || null, name: d.name, type_code: d.typeCode || null }] : xs;
            });
            router.refresh();
          },
          onDeleted: (id, inactive) => {
            setExtra((xs) => {
              if (!inactive) return xs.filter((o) => o.id !== id);
              const has = xs.some((o) => o.id === id);
              if (has) return xs.map((o) => (o.id === id ? { ...o, is_active: false } : o));
              const base = options.find((o) => o.id === id);
              return base ? [...xs, { ...base, is_active: false }] : xs;
            });
            router.refresh();
          },
          draftOf: (row) => {
            const o = byId.get(row.id);
            return { code: o?.code ?? "", name: o?.name ?? "", typeCode: o?.type_code ?? "" };
          },
        }
      : undefined;

  return (
    <DialogListPicker label={label} rows={rows} value={value} onChange={onChange} required={required} manage={manage} />
  );
}

/**
 * Select-only picker for masters that already have their own dedicated
 * management screen (e.g. Levy) — search + OK/Cancel/Clear, no inline
 * Add/Modify (mirrors the legacy ApplicantPicker/EmployeePicker pattern).
 */
export function LevyPicker({
  label,
  levies,
  value,
  onChange,
  clearable = true,
}: {
  label: string;
  levies: Levy[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      levies.map((l) => ({
        id: l.id,
        label: l.description || `Entry #${l.entry_no}`,
        sublabel: `Entry #${l.entry_no}`,
      })),
    [levies],
  );
  return <DialogListPicker label={label} rows={rows} value={value} onChange={onChange} clearable={clearable} />;
}

/**
 * Picker over the Materials master (`items`). Select-only by default — used by
 * the "Using (Items)" grid to link a line to a real material regardless of
 * class (0304). When `quickCreateClassId` + manage permissions are given (e.g.
 * the Fabric ▸ Attributes component-yarn list), it also gets inline
 * **Add / Modify / Delete**: quick-create only sets the Name inside that item
 * class (code auto-generated), Modify renames, Delete soft-deactivates when
 * the item is in use — richer fields stay editable from the full Materials
 * master, same as the CategoryPicker precedent.
 */
export function ItemPicker({
  label,
  title,
  items,
  value,
  onChange,
  clearable = true,
  placeholder,
  quickCreateClassId,
  canCreate = false,
  canEdit = false,
  canDelete = false,
}: {
  label: string;
  title?: string;
  items: { id: string; code: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
  placeholder?: string;
  /** Item class new quick-created items belong to — enables the CRUD bar. */
  quickCreateClassId?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  // Quick-created items, visible immediately; the server row (with its real
  // generated code) replaces the stub once router.refresh() lands.
  const [extra, setExtra] = useState<{ id: string; code: string; name: string }[]>([]);
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...items, ...extra].filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  }, [items, extra]);
  // Codes are backend-only (client 2026-07-23) — rows show just the name.
  const rows: PickerRow[] = useMemo(
    () => all.map((it) => ({ id: it.id, label: it.name })),
    [all],
  );

  const manage: ManageConfig | undefined =
    quickCreateClassId && (canCreate || canEdit || canDelete)
      ? {
          canCreate,
          canEdit,
          canDelete,
          onCreate: (d) => quickCreateMaterial(quickCreateClassId, d.name),
          onUpdate: (id, d) => renameMaterial(id, d.name),
          onDelete: (id) => deleteMaterial(id),
          onCreated: (id, d) => {
            setExtra((xs) => [...xs, { id, code: "", name: d.name }]);
            router.refresh();
          },
          onUpdated: (id, d) => {
            setExtra((xs) => {
              const has = xs.some((it) => it.id === id);
              if (has) return xs.map((it) => (it.id === id ? { ...it, name: d.name } : it));
              const base = items.find((it) => it.id === id);
              return base ? [...xs, { ...base, name: d.name }] : xs;
            });
            router.refresh();
          },
          onDeleted: (id, inactive) => {
            if (!inactive) setExtra((xs) => xs.filter((it) => it.id !== id));
            router.refresh();
          },
          // code unused by renameMaterial — the stored code is preserved server-side.
          draftOf: (row) => ({ code: "", name: row.label }),
        }
      : undefined;

  return (
    <DialogListPicker
      label={label}
      title={title}
      rows={rows}
      value={value}
      onChange={onChange}
      clearable={clearable}
      placeholder={placeholder}
      manage={manage}
    />
  );
}

/**
 * Picker over the rich `categories` master (0223) — the caller scopes
 * `categories` to the parent Item Class before passing it in, so this never
 * shows categories from other item classes (cascading-picker rule). When
 * `itemClassId` + a manage permission are given, it also gets inline
 * **Add / Modify / Delete** (quick-create only sets Short Name + Name; richer
 * fields like Made/Levy/Commodity stay editable from the full Category master).
 */
export function CategoryPicker({
  label,
  categories,
  value,
  onChange,
  clearable = true,
  required = false,
  itemClassId,
  canCreate = false,
  canEdit = false,
  canDelete = false,
}: {
  label: string;
  categories: Category[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
  required?: boolean;
  /** Parent Item Class id — new categories are created scoped to it; Add is
   *  disabled until it's set. */
  itemClassId?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [extra, setExtra] = useState<Category[]>([]);

  // extra is scoped to whichever item class it was added under — filter it
  // to the current one so switching Item Class doesn't leak stale additions.
  const all = useMemo(() => {
    const scopedExtra = itemClassId ? extra.filter((c) => c.item_class_id === itemClassId) : extra;
    const seen = new Set<string>();
    return [...categories, ...scopedExtra].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [categories, extra, itemClassId]);

  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);

  const rows: PickerRow[] = useMemo(
    () =>
      all
        .filter((c) => !c.inactive || c.id === value)
        .map((c) => ({
          id: c.id,
          label: c.name || c.short_name || "—",
          sublabel: c.short_spec,
          disabled: c.inactive,
        })),
    [all, value],
  );

  const canAdd = canCreate && !!itemClassId;
  const manage: ManageConfig | undefined =
    canAdd || canEdit || canDelete
      ? {
          canCreate: canAdd,
          canEdit,
          canDelete,
          onCreate: (d) =>
            createCategory({
              item_class_id: itemClassId!,
              short_name: d.code || null,
              name: d.name,
              short_spec: null,
              made: null,
              levy_id: null,
              commodity_id: null,
              fabric_structure_id: null,
              wastage_per: 0,
              profit_per: 0,
              freight_per: 0,
              insurance_per: 0,
              interest_per: 0,
              size_group_id: null,
              status_monitoring_type: null,
              user_defined: false,
              inactive: false,
            }),
          onUpdate: (id, d) => {
            const existing = byId.get(id);
            return updateCategory(id, {
              item_class_id: existing?.item_class_id ?? itemClassId!,
              short_name: d.code || null,
              name: d.name,
              short_spec: existing?.short_spec ?? null,
              made: existing?.made ?? null,
              levy_id: existing?.levy_id ?? null,
              commodity_id: existing?.commodity_id ?? null,
              fabric_structure_id: existing?.fabric_structure_id ?? null,
              wastage_per: existing?.wastage_per ?? 0,
              profit_per: existing?.profit_per ?? 0,
              freight_per: existing?.freight_per ?? 0,
              insurance_per: existing?.insurance_per ?? 0,
              interest_per: existing?.interest_per ?? 0,
              size_group_id: existing?.size_group_id ?? null,
              status_monitoring_type: existing?.status_monitoring_type ?? null,
              user_defined: existing?.user_defined ?? false,
              inactive: existing?.inactive ?? false,
            });
          },
          onDelete: (id) => deleteCategory(id),
          onCreated: (id, d) => {
            setExtra((xs) => [
              ...xs,
              {
                id,
                item_class_id: itemClassId!,
                short_name: d.code || null,
                name: d.name,
                short_spec: null,
                made: null,
                levy_id: null,
                commodity_id: null,
                fabric_structure_id: null,
                wastage_per: null,
                profit_per: null,
                freight_per: null,
                insurance_per: null,
                interest_per: null,
                size_group_id: null,
                status_monitoring_type: null,
                user_defined: false,
                inactive: false,
                created_by: null,
                created_by_name: null,
                created_at: "",
                updated_at: "",
              },
            ]);
            router.refresh();
          },
          onUpdated: (id, d) => {
            setExtra((xs) => {
              const has = xs.some((c) => c.id === id);
              if (has) return xs.map((c) => (c.id === id ? { ...c, short_name: d.code || null, name: d.name } : c));
              const base = categories.find((c) => c.id === id);
              return base ? [...xs, { ...base, short_name: d.code || null, name: d.name }] : xs;
            });
            router.refresh();
          },
          onDeleted: (id, inactive) => {
            setExtra((xs) => {
              if (!inactive) return xs.filter((c) => c.id !== id);
              const has = xs.some((c) => c.id === id);
              if (has) return xs.map((c) => (c.id === id ? { ...c, inactive: true } : c));
              const base = categories.find((c) => c.id === id);
              return base ? [...xs, { ...base, inactive: true }] : xs;
            });
            router.refresh();
          },
          draftOf: (row) => {
            const c = byId.get(row.id);
            return { code: c?.short_name ?? "", name: c?.name ?? "" };
          },
        }
      : undefined;

  return (
    <DialogListPicker
      label={label}
      rows={rows}
      value={value}
      onChange={onChange}
      clearable={clearable}
      required={required}
      manage={manage}
    />
  );
}

/**
 * Select-only picker over an Item Class's Attribute values (0220, merged
 * into Item Class by 0293) — the caller scopes `values` to the parent Item
 * Class before passing it in, so this never shows attributes from other
 * item classes (cascading-picker rule).
 */
export function AttributePicker({
  label,
  values,
  value,
  onChange,
  clearable = true,
  required = false,
}: {
  label: string;
  values: AttributeValue[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
  required?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () => values.map((v) => ({ id: v.id, label: v.value })),
    [values],
  );
  return (
    <DialogListPicker label={label} rows={rows} value={value} onChange={onChange} clearable={clearable} required={required} />
  );
}
