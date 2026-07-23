"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Column } from "@/components/ui/data-table";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LocationPicker } from "@/components/masters/location-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createWorkTiming,
  updateWorkTiming,
  deleteWorkTiming,
} from "@/lib/masters/work-timing-actions";
import type { WorkTiming, WorkTimingInput } from "@/lib/masters/work-timing-types";
import type { EmployeeLocation } from "@/lib/masters/employee-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// today as YYYY-MM-DD for the date inputs' default.
function today() {
  return new Date().toISOString().slice(0, 10);
}

type HeaderForm = {
  date: string;
  location_id: string;
  effective_from: string;
};

type LineRow = {
  key: string;
  shift_category_id: string;
  no_of_shifts: string;
  applicable_for_all_categories: boolean;
};
const blankLine = (key: string): LineRow => ({
  key,
  shift_category_id: "",
  no_of_shifts: "",
  applicable_for_all_categories: false,
});

/**
 * Legacy HR "Work Timing" master-detail: header (Entry No auto · Date ·
 * Location → locations · Effective From) + a Shift line grid (Shift Category →
 * config_lookups 'shift_category' · No Of Shifts · Applicable For All
 * Categories). Save / Save-As-Drafts (draft persists with `is_draft = true`).
 */
export function WorkTimingMasterScreen({
  rows,
  locations,
  shiftCategories,
  perms,
}: {
  rows: WorkTiming[];
  locations: EmployeeLocation[];
  shiftCategories: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNo, setEditNo] = useState<number | null>(null);
  const [form, setForm] = useState<HeaderForm>({ date: today(), location_id: "", effective_from: today() });
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setEditId(null);
    setEditNo(null);
    setForm({ date: today(), location_id: "", effective_from: today() });
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: WorkTiming) {
    setEditId(r.id);
    setEditNo(r.entry_no);
    setForm({
      date: r.date?.slice(0, 10) || today(),
      location_id: r.location_id ?? "",
      effective_from: r.effective_from?.slice(0, 10) || today(),
    });
    setLines(
      r.lines.map((l) => ({
        key: newKey(),
        shift_category_id: l.shift_category_id ?? "",
        no_of_shifts: l.no_of_shifts != null ? String(l.no_of_shifts) : "",
        applicable_for_all_categories: l.applicable_for_all_categories,
      })),
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, blankLine(newKey())]);
  }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: WorkTimingInput = {
        date: form.date,
        location_id: form.location_id || null,
        effective_from: form.effective_from,
        is_draft: asDraft,
        lines: lines.map((l, i) => ({
          sno: i + 1,
          shift_category_id: l.shift_category_id || null,
          no_of_shifts: l.no_of_shifts.trim() === "" ? null : Number(l.no_of_shifts),
          applicable_for_all_categories: l.applicable_for_all_categories,
        })),
      };
      const res = editId ? await updateWorkTiming(editId, payload) : await createWorkTiming(payload);
      if (res.ok) {
        success(editId ? "Work timing updated." : asDraft ? "Saved as draft." : "Work timing added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: WorkTiming) {
    startTransition(async () => {
      const res = await deleteWorkTiming(r.id);
      if (res.ok) {
        success("Work timing deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: WorkTiming) {
    return r.is_draft ? (
      <StatusPill tone="warning">Draft</StatusPill>
    ) : (
      <StatusPill tone="success">Active</StatusPill>
    );
  }

  const columns: Column<WorkTiming>[] = [
    { header: "Entry No", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{r.date?.slice(0, 10)}</span> },
    {
      header: "Location",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.location?.name ?? "—"}</span>,
    },
    {
      header: "Effective From",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.effective_from?.slice(0, 10)}</span>,
    },
    {
      header: "Shifts",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.lines.length || "—"}</span>,
    },
    { header: "Status", cell: (r) => statusPill(r) },
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
        searchText={(r) => [String(r.entry_no), r.location?.name].filter(Boolean).join(" ")}
        searchPlaceholder="Search by entry no or location…"
        statusOf={(r) => (r.is_draft ? "draft" : "active")}
        addLabel="+ Add Work Timing"
        onAdd={openAdd}
        columns={columns}
        empty="No work timings yet."
        mobile={{
          title: (r) => `#${r.entry_no}${r.location?.name ? ` · ${r.location.name}` : ""}`,
          meta: (r) =>
            `${r.date?.slice(0, 10) ?? ""} · ${r.lines.length} shift${r.lines.length === 1 ? "" : "s"}`,
          pill: (r) => statusPill(r),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Work Timing #${editNo}` : "New Work Timing"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={isPending || !form.date || !form.effective_from}
              onClick={() => submit(true)}
            >
              Save as Draft
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.date || !form.effective_from}
              onClick={() => submit(false)}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <div>
              <Label>Entry No</Label>
              <Input
                value={editNo != null ? `#${editNo}` : "(auto)"}
                readOnly
                disabled
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="wt-date">Date</Label>
              <Input
                id="wt-date"
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <div>
              <Label>Location</Label>
              <LocationPicker
                locations={locations}
                value={form.location_id || null}
                onChange={(id) => set({ location_id: id ?? "" })}
              />
            </div>
            <div>
              <Label htmlFor="wt-eff">Effective From</Label>
              <Input
                id="wt-eff"
                type="date"
                value={form.effective_from}
                onChange={(e) => set({ effective_from: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>

          {/* Shift line grid */}
          <div className="overflow-hidden rounded-lg border border-border sm:col-span-2">
            <div className="flex items-center justify-between border-b border-border bg-surface-muted px-3.5 py-2.5">
              <h3 className="text-[13px] font-bold text-foreground">Shifts</h3>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + Add shift
              </Button>
            </div>
            <div className="space-y-3 p-3">
              {lines.length === 0 && <p className="text-xs text-muted-foreground">No shifts yet.</p>}
              {lines.map((l, i) => (
                <div key={l.key} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Shift #{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
                      aria-label="Remove shift"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div>
                    <Label>Shift Category</Label>
                    <LookupDialogPicker
                      kind="shift_category"
                      label="Shift Category"
                      options={shiftCategories}
                      value={l.shift_category_id || null}
                      onChange={(id) => setLineAt(l.key, { shift_category_id: id })}
                      canCreate={perms.canCreate}
                      canEdit={perms.canEdit}
                      compact
                    />
                  </div>
                  <div className="grid grid-cols-2 items-end gap-3">
                    <div>
                      <Label htmlFor={`wt-nos-${l.key}`}>No Of Shifts</Label>
                      <Input
                        id={`wt-nos-${l.key}`}
                        type="number"
                        min={0}
                        value={l.no_of_shifts}
                        onChange={(e) => setLineAt(l.key, { no_of_shifts: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <label className="flex h-9 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={l.applicable_for_all_categories}
                        onChange={(e) =>
                          setLineAt(l.key, { applicable_for_all_categories: e.target.checked })
                        }
                      />
                      <span className="text-sm text-foreground">Applicable for all categories</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
