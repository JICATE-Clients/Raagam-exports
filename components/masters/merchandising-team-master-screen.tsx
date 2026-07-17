"use client";

import { useMemo, useState, useTransition } from "react";
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
  createMerchandisingTeam,
  updateMerchandisingTeam,
  deleteMerchandisingTeam,
} from "@/lib/masters/merchandising-team-actions";
import type {
  MerchandisingTeam,
  MerchandisingTeamInput,
} from "@/lib/masters/merchandising-team-types";
import type { EmployeeLocation } from "@/lib/masters/employee-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  code: "",
  name: "",
  inactive: false,
  location_id: "",
};

/**
 * Legacy "Merchandising Team" master (Associates). Flat form: Short Name ·
 * Inactive · Name · Location (→ locations, select-only picker) with
 * Save / Save-As-Drafts (draft persists with `is_draft = true`).
 */
export function MerchandisingTeamMasterScreen({
  rows,
  locations,
  perms,
}: {
  rows: MerchandisingTeam[];
  locations: EmployeeLocation[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const locationLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.name);
    return m;
  }, [locations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.code, r.name].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: MerchandisingTeam) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      location_id: r.location_id ?? "",
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: MerchandisingTeamInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        location_id: form.location_id || null,
        is_draft: asDraft,
      };
      const res = editId
        ? await updateMerchandisingTeam(editId, payload)
        : await createMerchandisingTeam(payload);
      if (res.ok) {
        success(editId ? "Merchandising team updated." : asDraft ? "Saved as draft." : "Merchandising team added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: MerchandisingTeam) {
    startTransition(async () => {
      const res = await deleteMerchandisingTeam(r.id);
      if (res.ok) {
        success("Merchandising team deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: MerchandisingTeam) {
    if (r.is_draft) return <StatusPill tone="warning">Draft</StatusPill>;
    if (r.inactive) return <StatusPill tone="danger">Inactive</StatusPill>;
    return <StatusPill tone="success">Active</StatusPill>;
  }

  const columns: Column<MerchandisingTeam>[] = [
    { header: "Short Name", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Location",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.location?.name ?? (r.location_id ? (locationLabel.get(r.location_id) ?? "—") : "—")}
        </span>
      ),
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
          placeholder="Search team…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Merchandising Team
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No merchandising teams yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No merchandising teams yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.location?.name ? ` · ${r.location.name}` : ""}
                  </div>
                </div>
                {statusPill(r)}
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Merchandising Team" : "New Merchandising Team"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={isPending || !form.name.trim()}
              onClick={() => submit(true)}
            >
              Save as Draft
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mt-code">Short Name</Label>
              <Input
                id="mt-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pt-6">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          </div>
          <div>
            <Label htmlFor="mt-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="mt-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label>Location</Label>
            <LocationPicker
              locations={locations}
              value={form.location_id || null}
              onChange={(id) => set({ location_id: id ?? "" })}
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
