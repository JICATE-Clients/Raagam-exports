"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LocationPicker } from "@/components/masters/location-picker";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/lib/masters/department-actions";
import {
  DEPARTMENT_ITEM_CLASSES,
  type Department,
  type DepartmentInput,
  type DepartmentItemClass,
} from "@/lib/masters/department-types";
import type { EmployeeLocation } from "@/lib/masters/employee-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type LocRow = { key: string; location_id: string | null; all_divisions: boolean };

const blankHeader = () => ({
  short_name: "",
  name: "",
  doc_prefix: "",
  warehouse: false,
  blocked: false,
});

/**
 * Department master (HR). Rich master — header (Short Name · Name · Doc Prefix ·
 * Warehouse · Blocked) + an Item-Class applicability checklist + a Location grid
 * (Location picker + All Divisions). Distinct from the `department`
 * config_lookups kind used by the party pickers.
 */
export function DepartmentMasterScreen({
  rows,
  locations,
  perms,
}: {
  rows: Department[];
  locations: EmployeeLocation[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankHeader());
  const [itemClasses, setItemClasses] = useState<DepartmentItemClass[]>([]);
  const [locs, setLocs] = useState<LocRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const set = (patch: Partial<ReturnType<typeof blankHeader>>) =>
    setForm((f) => ({ ...f, ...patch }));

  const locationLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, `${l.code} — ${l.name}`);
    return m;
  }, [locations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.short_name, r.name, r.doc_prefix].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(blankHeader());
    setItemClasses([]);
    setLocs([{ key: newKey(), location_id: null, all_divisions: false }]);
    setOpen(true);
  }
  function openEdit(r: Department) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name,
      name: r.name ?? "",
      doc_prefix: r.doc_prefix ?? "",
      warehouse: r.warehouse,
      blocked: r.blocked,
    });
    setItemClasses(
      r.item_classes.filter((c): c is DepartmentItemClass =>
        (DEPARTMENT_ITEM_CLASSES as readonly string[]).includes(c),
      ),
    );
    setLocs(
      r.locations.length
        ? r.locations.map((l) => ({
            key: newKey(),
            location_id: l.location_id,
            all_divisions: l.all_divisions,
          }))
        : [{ key: newKey(), location_id: null, all_divisions: false }],
    );
    setOpen(true);
  }

  function toggleItemClass(c: DepartmentItemClass) {
    setItemClasses((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }
  function addLoc() {
    setLocs((ls) => [...ls, { key: newKey(), location_id: null, all_divisions: false }]);
  }
  function setLocPicker(key: string, location_id: string | null) {
    setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, location_id } : l)));
  }
  function toggleLocAllDivisions(key: string, all_divisions: boolean) {
    setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, all_divisions } : l)));
  }
  function removeLoc(key: string) {
    setLocs((ls) => ls.filter((l) => l.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: DepartmentInput = {
        short_name: form.short_name.trim(),
        name: form.name.trim() || null,
        doc_prefix: form.doc_prefix.trim() || null,
        warehouse: form.warehouse,
        blocked: form.blocked,
        item_classes: itemClasses,
        locations: locs
          .filter((l) => l.location_id)
          .map((l, i) => ({ sno: i + 1, location_id: l.location_id, all_divisions: l.all_divisions })),
      };
      const res = editId ? await updateDepartment(editId, payload) : await createDepartment(payload);
      if (res.ok) {
        success(editId ? "Department updated." : "Department added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Department) {
    startTransition(async () => {
      const res = await deleteDepartment(r.id);
      if (res.ok) {
        success("Department deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Department>[] = [
    { header: "Short Name", cell: (r) => <span className="font-medium text-sm">{r.short_name}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
    {
      header: "Doc Prefix",
      cell: (r) => <span className="font-mono text-xs">{r.doc_prefix ?? "—"}</span>,
    },
    {
      header: "Warehouse",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.warehouse ? "Yes" : "No"}</span>,
    },
    {
      header: "Locations",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.locations.length}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill>
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
          placeholder="Search department…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Department
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No departments yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No departments yet.
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
                  <div className="text-[15px] font-semibold text-foreground">{r.short_name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.name ?? "—"} · {r.locations.length} location(s)
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
        title={editId ? `Edit Department — ${form.short_name}` : "New Department"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.short_name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="dep-short">
              Short Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="dep-short"
              value={form.short_name}
              onChange={(e) => set({ short_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="dep-name">Name</Label>
            <Input
              id="dep-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dep-prefix">Doc Prefix</Label>
              <Input
                id="dep-prefix"
                value={form.doc_prefix}
                onChange={(e) => set({ doc_prefix: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div className="flex items-end gap-4 pb-1.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.warehouse}
                  onChange={(e) => set({ warehouse: e.target.checked })}
                />
                <span className="text-sm text-foreground">Warehouse</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.blocked}
                  onChange={(e) => set({ blocked: e.target.checked })}
                />
                <span className="text-sm text-foreground">Blocked</span>
              </label>
            </div>
          </div>

          {/* Item-Class applicability */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Item Classes
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DEPARTMENT_ITEM_CLASSES.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={itemClasses.includes(c)}
                    onChange={() => toggleItemClass(c)}
                  />
                  <span className="text-sm text-foreground">{c}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Location grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Locations
            </div>
            <div className="space-y-3 p-3">
              {locs.length === 0 && <p className="text-xs text-muted-foreground">No locations yet.</p>}
              {locs.map((l, i) => (
                <div key={l.key} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      #{i + 1}
                      {l.location_id && locationLabel.get(l.location_id)
                        ? ` · ${locationLabel.get(l.location_id)}`
                        : ""}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => removeLoc(l.key)}
                      aria-label="Remove location"
                    >
                      ✕
                    </Button>
                  </div>
                  <div>
                    <Label>Location</Label>
                    <LocationPicker
                      locations={locations}
                      value={l.location_id}
                      onChange={(id) => setLocPicker(l.key, id)}
                      compact
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={l.all_divisions}
                      onChange={(e) => toggleLocAllDivisions(l.key, e.target.checked)}
                    />
                    <span className="text-sm text-foreground">All Divisions</span>
                  </label>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLoc}>
                + Add location
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
