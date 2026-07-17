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
import {
  createDestination,
  updateDestination,
  deleteDestination,
} from "@/lib/masters/destination-actions";
import type { Destination, DestinationInput } from "@/lib/masters/destination-types";
import type { Country } from "@/lib/masters/country-types";
import { CountryPicker } from "@/components/masters/country-picker";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = { short_name: "", country_id: "", name: "", inactive: false };

/**
 * Legacy "Destination" master (Associates). Short Name · Country (required,
 * via the ⓘ CountryPicker with Add/Modify) · Name · Inactive.
 */
export function DestinationMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Destination[];
  countries: Country[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [countries]);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.short_name, countryLabel.get(r.country_id)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, countryLabel]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Destination) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      country_id: r.country_id,
      name: r.name ?? "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: DestinationInput = {
        short_name: form.short_name.trim() || null,
        country_id: form.country_id,
        name: form.name.trim() || null,
        inactive: form.inactive,
      };
      const res = editId ? await updateDestination(editId, payload) : await createDestination(payload);
      if (res.ok) {
        success(editId ? "Destination updated." : "Destination added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Destination) {
    startTransition(async () => {
      const res = await deleteDestination(r.id);
      if (res.ok) {
        success("Destination deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Destination>[] = [
    { header: "Short Name", cell: (r) => <span className="font-mono text-xs">{r.short_name ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
    {
      header: "Country",
      cell: (r) => <span className="text-sm text-muted-foreground">{countryLabel.get(r.country_id) ?? "—"}</span>,
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
          placeholder="Search destination…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Destination
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No destination records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No destination records yet.
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
                    {countryLabel.get(r.country_id) ?? "—"}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
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
        title={editId ? "Edit Destination" : "New Destination"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.country_id} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="de-short">Short Name</Label>
            <Input
              id="de-short"
              value={form.short_name}
              onChange={(e) => set({ short_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="de-name">Name</Label>
            <Input
              id="de-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <CountryPicker
            countries={countries}
            value={form.country_id || null}
            onChange={(id) => set({ country_id: id })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
          />
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => set({ inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
