"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { DetailSection } from "@/components/masters/detail-section";
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
type DivisionOption = { id: string; division_id: string; division_name: string };
type LocRow = { key: string; location_id: string | null; all_divisions: boolean; division_ids: string[] };

const blankHeader = () => ({
  short_name: "",
  name: "",
  doc_prefix: "",
  warehouse: false,
  inactive: false,
  is_outsourcing: false,
  sequence_no: "" as string | number,
  staff_sequence_no: "" as string | number,
  is_fabric: false,
  is_yarn: false,
  is_sewing: false,
  is_packing: false,
  is_general: false,
  is_garment: false,
});

/**
 * Department master (HR). Rich master — header (Short Name · Name · Doc Prefix ·
 * Warehouse · Inactive) + an Item-Class applicability checklist + a Location grid
 * (Location picker + All Divisions). Distinct from the `department`
 * config_lookups kind used by the party pickers.
 */
export function DepartmentMasterScreen({
  rows,
  locations,
  divisions,
  perms,
}: {
  rows: Department[];
  locations: EmployeeLocation[];
  divisions: DivisionOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
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

  function openAdd() {
    setEditId(null);
    setForm(blankHeader());
    setItemClasses([]);
    setLocs([{ key: newKey(), location_id: null, all_divisions: false, division_ids: [] }]);
    setOpen(true);
  }
  function openEdit(r: Department) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name,
      name: r.name ?? "",
      doc_prefix: r.doc_prefix ?? "",
      warehouse: r.warehouse,
      inactive: r.inactive,
      is_outsourcing: r.is_outsourcing,
      sequence_no: r.sequence_no ?? "",
      staff_sequence_no: r.staff_sequence_no ?? "",
      is_fabric: r.is_fabric,
      is_yarn: r.is_yarn,
      is_sewing: r.is_sewing,
      is_packing: r.is_packing,
      is_general: r.is_general,
      is_garment: r.is_garment,
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
            division_ids: (l.divisions ?? []).map((d) => d.division_id),
          }))
        : [{ key: newKey(), location_id: null, all_divisions: false, division_ids: [] }],
    );
    setOpen(true);
  }

  function toggleItemClass(c: DepartmentItemClass) {
    setItemClasses((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }
  function addLoc() {
    setLocs((ls) => [...ls, { key: newKey(), location_id: null, all_divisions: false, division_ids: [] }]);
  }
  function setLocPicker(key: string, location_id: string | null) {
    setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, location_id } : l)));
  }
  function toggleLocAllDivisions(key: string, all_divisions: boolean) {
    setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, all_divisions, division_ids: all_divisions ? [] : l.division_ids } : l)));
  }
  function toggleLocDivision(key: string, divId: string) {
    setLocs((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const has = l.division_ids.includes(divId);
      return { ...l, division_ids: has ? l.division_ids.filter((d) => d !== divId) : [...l.division_ids, divId] };
    }));
  }
  function removeLoc(key: string) {
    setLocs((ls) => ls.filter((l) => l.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: DepartmentInput = {
        // Create derives the code from Name; edit keeps the record's original
        // stored short_name (it can be a logic key referenced elsewhere).
        short_name: editId ? form.short_name : form.name.trim(),
        name: form.name.trim() || null,
        doc_prefix: form.doc_prefix.trim() || null,
        warehouse: form.warehouse,
        inactive: form.inactive,
        is_outsourcing: form.is_outsourcing,
        sequence_no: form.sequence_no === "" ? null : Number(form.sequence_no),
        staff_sequence_no: form.staff_sequence_no === "" ? null : Number(form.staff_sequence_no),
        is_fabric: form.is_fabric,
        is_yarn: form.is_yarn,
        is_sewing: form.is_sewing,
        is_packing: form.is_packing,
        is_general: form.is_general,
        is_garment: form.is_garment,
        item_classes: itemClasses,
        locations: locs
          .filter((l) => l.location_id)
          .map((l, i) => ({
            sno: i + 1,
            location_id: l.location_id,
            all_divisions: l.all_divisions,
            divisions: l.all_divisions ? [] : l.division_ids.map((did, di) => ({ division_id: did, sno: di + 1 })),
          })),
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
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
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
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.short_name, r.name, r.doc_prefix].filter(Boolean).join(" ")}
        searchPlaceholder="Search department…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Department"
        onAdd={openAdd}
        columns={columns}
        empty="No departments yet."
        mobile={{
          title: (r) => r.short_name,
          meta: (r) => `${r.name ?? "—"} · ${r.locations.length} location(s)`,
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : "success"}>
              {r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

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
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="dep-name">
              Name <span className="text-danger">*</span>
            </Label>
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
              {editId && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.inactive}
                    onChange={(e) => set({ inactive: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              )}
            </div>
          </div>

          {/* Sequence numbers + outsourcing */}
          <DetailSection label="Sequence & Outsourcing">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dep-seq">Sequence No</Label>
                <Input
                  id="dep-seq"
                  type="number"
                  value={form.sequence_no}
                  onChange={(e) => set({ sequence_no: e.target.value === "" ? "" : Number(e.target.value) })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="dep-staff-seq">Staff Sequence No</Label>
                <Input
                  id="dep-staff-seq"
                  type="number"
                  value={form.staff_sequence_no}
                  onChange={(e) => set({ staff_sequence_no: e.target.value === "" ? "" : Number(e.target.value) })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_outsourcing}
                onChange={(e) => set({ is_outsourcing: e.target.checked })}
              />
              <span className="text-sm text-foreground">Outsourcing</span>
            </label>
          </DetailSection>

          {/* Item-Class applicability */}
          <DetailSection label="Item Classes">
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
          </DetailSection>

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
                  {!l.all_divisions && divisions.length > 0 && (
                    <div className="ml-6 flex flex-wrap gap-2">
                      {divisions.map((d) => (
                        <label key={d.id} className="flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 cursor-pointer accent-primary"
                            checked={l.division_ids.includes(d.id)}
                            onChange={() => toggleLocDivision(l.key, d.id)}
                          />
                          <span className="text-xs text-foreground">{d.division_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
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
