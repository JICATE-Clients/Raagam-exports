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
  createDestination,
  updateDestination,
  deleteDestination,
} from "@/lib/masters/destination-actions";
import { createCountryQuick } from "@/lib/masters/country-actions";
import type { Destination, DestinationInput } from "@/lib/masters/destination-types";
import type { Country } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type CountryOption = Pick<Country, "id" | "code" | "name">;

const BLANK = { short_name: "", country_id: "", name: "", blocked: false };

/**
 * Legacy "Destination" master (Associates). Short Name · Country (required, a
 * picker into the Country master with an inline "+ New" add) · Name · Blocked.
 */
export function DestinationMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Destination[];
  countries: CountryOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  // Countries added inline this session, merged with server props (deduped).
  const [extraCountries, setExtraCountries] = useState<CountryOption[]>([]);
  const [showNewCountry, setShowNewCountry] = useState(false);
  const [newCountryCode, setNewCountryCode] = useState("");
  const [newCountryName, setNewCountryName] = useState("");

  const allCountries = useMemo(() => {
    const seen = new Set<string>();
    return [...countries, ...extraCountries].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [countries, extraCountries]);
  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allCountries) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [allCountries]);

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

  function resetNewCountry() {
    setShowNewCountry(false);
    setNewCountryCode("");
    setNewCountryName("");
  }
  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    resetNewCountry();
    setOpen(true);
  }
  function openEdit(r: Destination) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      country_id: r.country_id,
      name: r.name ?? "",
      blocked: r.blocked,
    });
    resetNewCountry();
    setOpen(true);
  }

  function addCountry() {
    startTransition(async () => {
      const res = await createCountryQuick({ code: newCountryCode.trim() || null, name: newCountryName });
      if (res.ok) {
        setExtraCountries((xs) => [
          ...xs,
          { id: res.id, code: newCountryCode.trim() || null, name: newCountryName.trim() },
        ]);
        set({ country_id: res.id });
        resetNewCountry();
        success("Country added.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function submit() {
    startTransition(async () => {
      const payload: DestinationInput = {
        short_name: form.short_name.trim() || null,
        country_id: form.country_id,
        name: form.name.trim() || null,
        blocked: form.blocked,
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
          {/* Country (required) + inline add */}
          <div>
            <Label htmlFor="de-country">
              Country <span className="text-danger">*</span>
            </Label>
            <div className="flex gap-2">
              <Select
                id="de-country"
                value={form.country_id}
                onChange={(e) => set({ country_id: e.target.value })}
                className="flex-1 text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {allCountries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} — ${c.name}` : c.name}
                  </option>
                ))}
              </Select>
              {perms.canCreate && (
                <Button type="button" variant="outline" size="md" onClick={() => setShowNewCountry((v) => !v)}>
                  {showNewCountry ? "Cancel" : "+ New"}
                </Button>
              )}
            </div>
            {showNewCountry && (
              <div className="mt-2 flex items-end gap-2 rounded-lg border border-border p-2.5">
                <div className="w-24">
                  <Label htmlFor="de-country-code">Code</Label>
                  <Input
                    id="de-country-code"
                    value={newCountryCode}
                    onChange={(e) => setNewCountryCode(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="de-country-name">Name</Label>
                  <Input
                    id="de-country-name"
                    value={newCountryName}
                    onChange={(e) => setNewCountryName(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </div>
                <Button
                  type="button"
                  size="md"
                  disabled={isPending || !newCountryName.trim()}
                  onClick={addCountry}
                >
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
              onChange={(e) => set({ blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Blocked</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
