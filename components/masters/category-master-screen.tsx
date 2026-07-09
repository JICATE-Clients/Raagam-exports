"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  createItemClass,
} from "@/lib/masters/category-actions";
import { MADE_TYPES, type Category, type CategoryInput, type MadeType } from "@/lib/masters/category-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  item_class_id: "",
  short_name: "",
  name: "",
  short_spec: "",
  made: "" as "" | MadeType,
  levy_id: "",
  commodity_id: "",
  blocked: false,
};

/**
 * Rich CRUD for the legacy "Category" master. Item Class is a required picker of
 * the `item_class` reference list (with an inline "+ New" add mirroring the
 * legacy Add button); Levy and Commodity pick from their own masters.
 */
export function CategoryMasterScreen({
  rows,
  itemClasses,
  levies,
  commodities,
  perms,
}: {
  rows: Category[];
  itemClasses: ConfigLookup[];
  levies: Levy[];
  commodities: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  // Item classes added inline this session, merged with server props (deduped).
  const [extraClasses, setExtraClasses] = useState<ConfigLookup[]>([]);
  const [showNewClass, setShowNewClass] = useState(false);
  const [newClassCode, setNewClassCode] = useState("");
  const [newClassName, setNewClassName] = useState("");

  const allClasses = useMemo(() => {
    const seen = new Set<string>();
    return [...itemClasses, ...extraClasses].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [itemClasses, extraClasses]);

  // display maps
  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allClasses) m.set(c.id, c.name);
    return m;
  }, [allClasses]);
  const levyLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of levies) m.set(l.id, l.description || `Entry #${l.entry_no}`);
    return m;
  }, [levies]);
  const commodityLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of commodities) m.set(c.id, c.name);
    return m;
  }, [commodities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.name,
        r.short_name,
        r.short_spec,
        r.made,
        classLabel.get(r.item_class_id),
        r.levy_id ? levyLabel.get(r.levy_id) : "",
        r.commodity_id ? commodityLabel.get(r.commodity_id) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, classLabel, levyLabel, commodityLabel]);

  function resetNewClass() {
    setShowNewClass(false);
    setNewClassCode("");
    setNewClassName("");
  }
  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    resetNewClass();
    setOpen(true);
  }
  function openEdit(r: Category) {
    setEditId(r.id);
    setForm({
      item_class_id: r.item_class_id,
      short_name: r.short_name ?? "",
      name: r.name ?? "",
      short_spec: r.short_spec ?? "",
      made: r.made ?? "",
      levy_id: r.levy_id ?? "",
      commodity_id: r.commodity_id ?? "",
      blocked: r.blocked,
    });
    resetNewClass();
    setOpen(true);
  }

  function addItemClass() {
    startTransition(async () => {
      const res = await createItemClass({ code: newClassCode.trim() || null, name: newClassName });
      if (res.ok) {
        setExtraClasses((xs) => [
          ...xs,
          {
            id: res.id,
            kind: "item_class",
            code: newClassCode.trim() || null,
            name: newClassName.trim(),
            notes: null,
            is_active: true,
            created_at: "",
            updated_at: "",
          },
        ]);
        setForm((f) => ({ ...f, item_class_id: res.id }));
        resetNewClass();
        success("Item Class added.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function submit() {
    startTransition(async () => {
      const payload: CategoryInput = {
        item_class_id: form.item_class_id,
        short_name: form.short_name.trim() || null,
        name: form.name.trim() || null,
        short_spec: form.short_spec.trim() || null,
        made: form.made ? form.made : null,
        levy_id: form.levy_id || null,
        commodity_id: form.commodity_id || null,
        blocked: form.blocked,
      };
      const res = editId ? await updateCategory(editId, payload) : await createCategory(payload);
      if (res.ok) {
        success(editId ? "Category updated." : "Category added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Category) {
    startTransition(async () => {
      const res = await deleteCategory(r.id);
      if (res.ok) {
        success("Category deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Category>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{classLabel.get(r.item_class_id) ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
    { header: "Made", cell: (r) => <span className="text-sm text-muted-foreground">{r.made ?? "—"}</span> },
    {
      header: "Levy",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.levy_id ? levyLabel.get(r.levy_id) ?? "—" : "—"}
        </span>
      ),
    },
    {
      header: "Commodity",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.commodity_id ? commodityLabel.get(r.commodity_id) ?? "—" : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>
          {r.blocked ? "Blocked" : "Active"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search category…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Category
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No category records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No category records yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.name ?? classLabel.get(r.item_class_id) ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {classLabel.get(r.item_class_id) ?? "—"}
                    {r.made ? ` · ${r.made}` : ""}
                  </div>
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Blocked" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Category" : "New Category"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.item_class_id} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Item Class (required) + inline add */}
          <div>
            <Label htmlFor="cat-class">
              Item Class <span className="text-danger">*</span>
            </Label>
            <div className="flex gap-2">
              <Select
                id="cat-class"
                value={form.item_class_id}
                onChange={(e) => setForm({ ...form, item_class_id: e.target.value })}
                className="flex-1 text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {allClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} — ${c.name}` : c.name}
                  </option>
                ))}
              </Select>
              {perms.canCreate && (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => setShowNewClass((v) => !v)}
                >
                  {showNewClass ? "Cancel" : "+ New"}
                </Button>
              )}
            </div>
            {showNewClass && (
              <div className="mt-2 flex items-end gap-2 rounded-lg border border-border p-2.5">
                <div className="w-24">
                  <Label htmlFor="cat-class-code">Code</Label>
                  <Input
                    id="cat-class-code"
                    value={newClassCode}
                    onChange={(e) => setNewClassCode(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="cat-class-name">Name</Label>
                  <Input
                    id="cat-class-name"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </div>
                <Button
                  type="button"
                  size="md"
                  disabled={isPending || !newClassName.trim()}
                  onClick={addItemClass}
                >
                  Add
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="cat-short-name">Short Name</Label>
            <Input
              id="cat-short-name"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cat-spec">Short Spec</Label>
            <Input
              id="cat-spec"
              value={form.short_spec}
              onChange={(e) => setForm({ ...form, short_spec: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cat-made">Made</Label>
            <Select
              id="cat-made"
              value={form.made}
              onChange={(e) => setForm({ ...form, made: e.target.value as "" | MadeType })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {MADE_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cat-levy">Levy Description</Label>
            <Select
              id="cat-levy"
              value={form.levy_id}
              onChange={(e) => setForm({ ...form, levy_id: e.target.value })}
              className="text-base md:text-sm"
            >
              <option value="">— None —</option>
              {levies.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.description || `Entry #${l.entry_no}`}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cat-commodity">Commodity</Label>
            <Select
              id="cat-commodity"
              value={form.commodity_id}
              onChange={(e) => setForm({ ...form, commodity_id: e.target.value })}
              className="text-base md:text-sm"
            >
              <option value="">— None —</option>
              {commodities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} — ${c.name}` : c.name}
                </option>
              ))}
            </Select>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => setForm({ ...form, blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Blocked</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
