"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createDestination,
  updateDestination,
  deleteDestination,
} from "@/lib/masters/destination-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import type { Destination, DestinationInput } from "@/lib/masters/destination-types";
import type { Country } from "@/lib/masters/country-types";
import { CountryPicker } from "@/components/masters/country-picker";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { COUNTRY_NAMES } from "@/lib/masters/geo-names";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

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
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  // Real-time duplicate check on Name, per country — mirrors the DB's unique
  // index on (country_id, lower(trim(short_name))) (0335); creates derive
  // short_name from Name, so a clash would otherwise surface as a raw
  // constraint error on save.
  const dupError = useDuplicateName({
    table: "destinations",
    name: form.name,
    nameColumn: "short_name",
    scope: { country_id: form.country_id || null },
    excludeId: editId ?? undefined,
    enabled: !!(form.name.trim() && form.country_id),
    // The synchronous half. `rowValue` follows `nameColumn`, not the label —
    // this master's identity is the short name, within one country.
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.short_name,
    rowInScope: (r) => r.country_id === form.country_id,
  });

  // "Did you mean…?" on Name. The vocabulary is the destinations already saved
  // PLUS country names — a final destination in this trade is overwhelmingly a
  // country, and `countries` is already on this screen for the picker, so that
  // half of the dictionary costs nothing to maintain. Deliberately NOT scoped
  // to the selected country: the operator usually types the Name before picking
  // one, and a hint that misses is free to ignore — nothing is auto-applied.
  const nameSuggest = useSpellSuggest({
    name: form.name,
    names: [
      ...rows.filter((r) => r.id !== editId).map((r) => r.name ?? ""),
      ...countries.map((c) => c.name),
    ],
    seed: COUNTRY_NAMES,
    enabled: open,
    // Enter applies the highlighted chip; see the hook.
    onApply: (v) => set({ name: v }),
  });

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
        // Create derives the short name from the display name; edit keeps the
        // record's original stored short name (held in state, never rendered).
        short_name: editId ? form.short_name.trim() || null : form.name.trim() || null,
        country_id: form.country_id,
        // Mandatory in the schema — see destination-types.ts.
        name: form.name.trim(),
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
        success(deletedToast("Destination", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Destination>[] = [
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
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
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
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No destination records yet." />
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
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
            <Button size="md" disabled={isPending || !form.country_id || !form.name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/* Two fields plus a flag — one flat section (LAYOUT.md §4), all on one
            row: 3 + 3 + 3 = 9. Every field is the same `sm` box as everywhere
            else in the masters, small form or not — the client asked for one
            width across the whole module rather than each field sized to its
            data (client 2026-07-29). The flag was `full`, which put a single
            tick on a 12-col row of its own. */}
        <DetailSection label="Details" cols={12}>
          <Field label="Name" size="sm" required htmlFor="de-name">
            <Input
              id="de-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              {...dupFieldProps(dupError, "de-name")}
            />
            <DuplicateError error={dupError} id="de-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => set({ name: v })}
            />
          </Field>
          {/* CountryPicker renders its own label — see the note on port. */}
          <Field size="sm">
            <CountryPicker
              countries={countries}
              value={form.country_id || null}
              onChange={(id) => set({ country_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              // `destinationInput.country_id` has ALWAYS been mandatory, and the
              // file header has said "Country (required)" since it was written —
              // the picker just never carried the prop, so nothing held. It hid
              // behind the audit's count comparison too: one `required` declared
              // against one mandatory field looked balanced, while the
              // declaration sat on Name and the mandatory field was this one.
              required
            />
          </Field>
          {editId && (
            <Field size="sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.inactive}
                  onChange={(e) => set({ inactive: e.target.checked })}
                />
                <span className="text-sm text-foreground">Inactive</span>
              </label>
            </Field>
          )}
        </DetailSection>
      </Sheet>
    </div>
  );
}
