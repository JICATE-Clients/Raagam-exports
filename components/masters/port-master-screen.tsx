"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { createPort, updatePort, deletePort } from "@/lib/masters/port-actions";
import { PORT_TYPES, type Port, type PortInput, type PortType } from "@/lib/masters/port-types";
import type { Country } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  short_name: "",
  name: "",
  country_id: "",
  port_type: "" as "" | PortType,
};

/**
 * Legacy "Port" master (Associates): Short Name · Name · Country (req, via the
 * ⓘ CountryPicker with Add/Modify) · Type (Air/Sea/Sea-Air).
 */
export function PortMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Port[];
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

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.short_name, r.name, r.country?.name ?? countryLabel.get(r.country_id), r.port_type]
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
  function openEdit(r: Port) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      name: r.name ?? "",
      country_id: r.country_id,
      port_type: r.port_type ?? "",
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: PortInput = {
        // Create derives the short name from the display name; edit keeps the
        // record's original stored short name (held in state, never rendered).
        short_name: editId ? form.short_name.trim() || null : form.name.trim() || null,
        name: form.name.trim() || null,
        country_id: form.country_id,
        port_type: form.port_type ? form.port_type : null,
      };
      const res = editId ? await updatePort(editId, payload) : await createPort(payload);
      if (res.ok) {
        success(editId ? "Port updated." : "Port added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Port) {
    startTransition(async () => {
      const res = await deletePort(r.id);
      if (res.ok) {
        success("Port deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function countryName(r: Port): string {
    return r.country?.name ?? countryLabel.get(r.country_id) ?? "—";
  }

  const columns: Column<Port>[] = [
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name ?? "—"}</span> },
    { header: "Country", cell: (r) => <span className="text-sm">{countryName(r)}</span> },
    {
      header: "Type",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.port_type ?? "—"}</span>,
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
          placeholder="Search port…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Port
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No port records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No port records yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">
                  {r.name ?? r.short_name ?? "—"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {countryName(r)}
                  {r.port_type ? ` · ${r.port_type}` : ""}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Port" : "New Port"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.country_id || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pt-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="pt-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
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
          <div>
            <Label htmlFor="pt-type">Type</Label>
            <Select
              id="pt-type"
              value={form.port_type}
              onChange={(e) => set({ port_type: e.target.value as "" | PortType })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {PORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
