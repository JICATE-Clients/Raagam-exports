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
  createCommodity,
  updateCommodity,
  deleteCommodity,
} from "@/lib/masters/commodity-actions";
import { createItemClass } from "@/lib/masters/category-actions";
import type { Commodity, CommodityInput } from "@/lib/masters/commodity-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = { item_class_id: "", short_name: "", name: "", blocked: false };

/**
 * Legacy "Commodity" master — a header-only record (Short Name · Name ·
 * Item Class req · Blocked). Item Class is a picker into the `item_class`
 * config_lookups master, with an inline "+ New" creator. Dense table on
 * desktop, cards on mobile, shared <Sheet> editor.
 */
export function CommodityMasterScreen({
  rows,
  itemClasses,
  perms,
}: {
  rows: Commodity[];
  itemClasses: ConfigLookup[];
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
  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allClasses) m.set(c.id, c.name);
    return m;
  }, [allClasses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.short_name, classLabel.get(r.item_class_id)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, classLabel]);

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
  function openEdit(r: Commodity) {
    setEditId(r.id);
    setForm({
      item_class_id: r.item_class_id,
      short_name: r.short_name ?? "",
      name: r.name ?? "",
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
      const payload: CommodityInput = {
        item_class_id: form.item_class_id,
        short_name: form.short_name.trim() || null,
        name: form.name.trim() || null,
        blocked: form.blocked,
      };
      const res = editId ? await updateCommodity(editId, payload) : await createCommodity(payload);
      if (res.ok) {
        success(editId ? "Commodity updated." : "Commodity added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Commodity) {
    startTransition(async () => {
      const res = await deleteCommodity(r.id);
      if (res.ok) {
        success("Commodity deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Commodity>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{classLabel.get(r.item_class_id) ?? "—"}</span>,
    },
    { header: "Short Name", cell: (r) => <span className="text-sm">{r.short_name ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
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
          placeholder="Search commodity…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Commodity
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No commodity records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No commodity records yet.
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
                    {r.name ?? r.short_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {classLabel.get(r.item_class_id) ?? "—"}
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
        title={editId ? "Edit Commodity" : "New Commodity"}
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
          <div>
            <Label htmlFor="cmd-short">Short Name</Label>
            <Input
              id="cmd-short"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cmd-name">Name</Label>
            <Input
              id="cmd-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          {/* Item Class (required) + inline add */}
          <div>
            <Label htmlFor="cmd-class">
              Item Class <span className="text-danger">*</span>
            </Label>
            <div className="flex gap-2">
              <Select
                id="cmd-class"
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
                <Button type="button" variant="outline" size="md" onClick={() => setShowNewClass((v) => !v)}>
                  {showNewClass ? "Cancel" : "+ New"}
                </Button>
              )}
            </div>
            {showNewClass && (
              <div className="mt-2 flex items-end gap-2 rounded-lg border border-border p-2.5">
                <div className="w-24">
                  <Label htmlFor="cmd-class-code">Code</Label>
                  <Input
                    id="cmd-class-code"
                    value={newClassCode}
                    onChange={(e) => setNewClassCode(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="cmd-class-name">Name</Label>
                  <Input
                    id="cmd-class-name"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </div>
                <Button type="button" size="md" disabled={isPending || !newClassName.trim()} onClick={addItemClass}>
                  Add
                </Button>
              </div>
            )}
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
