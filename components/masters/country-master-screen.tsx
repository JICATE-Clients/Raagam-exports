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
import { createCountry, updateCountry, deleteCountry } from "@/lib/masters/country-actions";
import { COUNTRY_GROUPS, type Country, type CountryGroup, type CountryInput } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  code: "",
  name: "",
  country_group: "" as "" | CountryGroup,
  ecgc_code: "",
  isd_code: "",
  default_country: false,
  blocked: false,
};

/**
 * Legacy "Country" master (Associates). Flat form with a Country Group enum and
 * Save / Save-As-Drafts — the draft button persists with `is_draft = true`.
 */
export function CountryMasterScreen({ rows, perms }: { rows: Country[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.country_group, r.isd_code, r.ecgc_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Country) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      country_group: r.country_group ?? "",
      ecgc_code: r.ecgc_code ?? "",
      isd_code: r.isd_code ?? "",
      default_country: r.default_country,
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: CountryInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        country_group: form.country_group ? form.country_group : null,
        ecgc_code: form.ecgc_code.trim() || null,
        isd_code: form.isd_code.trim() || null,
        default_country: form.default_country,
        blocked: form.blocked,
        is_draft: asDraft,
      };
      const res = editId ? await updateCountry(editId, payload) : await createCountry(payload);
      if (res.ok) {
        success(editId ? "Country updated." : asDraft ? "Saved as draft." : "Country added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Country) {
    startTransition(async () => {
      const res = await deleteCountry(r.id);
      if (res.ok) {
        success("Country deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: Country) {
    if (r.is_draft) return <StatusPill tone="warning">Draft</StatusPill>;
    if (r.blocked) return <StatusPill tone="danger">Blocked</StatusPill>;
    return <StatusPill tone="success">Active</StatusPill>;
  }

  const columns: Column<Country>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Group", cell: (r) => <span className="text-sm text-muted-foreground">{r.country_group ?? "—"}</span> },
    { header: "ISD", cell: (r) => <span className="text-sm text-muted-foreground">{r.isd_code ?? "—"}</span> },
    {
      header: "Default",
      cell: (r) => (r.default_country ? <span className="text-sm text-primary">✓</span> : <span className="text-sm text-muted-foreground">—</span>),
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
          placeholder="Search country…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Country
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No country records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No country records yet.
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
                    {r.country_group ? ` · ${r.country_group}` : ""}
                    {r.isd_code ? ` · +${r.isd_code}` : ""}
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
        title={editId ? "Edit Country" : "New Country"}
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
              <Label htmlFor="co-code">Code</Label>
              <Input
                id="co-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="co-group">Country Group</Label>
              <Select
                id="co-group"
                value={form.country_group}
                onChange={(e) => set({ country_group: e.target.value as "" | CountryGroup })}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {COUNTRY_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="co-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="co-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="co-ecgc">ECGC Code</Label>
              <Input
                id="co-ecgc"
                value={form.ecgc_code}
                onChange={(e) => set({ ecgc_code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="co-isd">ISD Code</Label>
              <Input
                id="co-isd"
                value={form.isd_code}
                onChange={(e) => set({ isd_code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.default_country}
              onChange={(e) => set({ default_country: e.target.checked })}
            />
            <span className="text-sm text-foreground">Default Country</span>
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
      </Sheet>
    </div>
  );
}
