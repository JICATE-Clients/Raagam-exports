"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { PORT_NAMES } from "@/lib/masters/geo-names";
import { createPort, updatePort, deletePort } from "@/lib/masters/port-actions";
import { PORT_TYPES, type Port, type PortInput, type PortType } from "@/lib/masters/port-types";
import type { Country } from "@/lib/masters/country-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

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

  /**
   * Scoped by country, because a port name is only unique WITHIN one — there is
   * a Victoria in Canada, Hong Kong and the Seychelles, and refusing the second
   * would be wrong. `rowInScope` mirrors the server `scope` against the rows
   * already on screen so the synchronous half narrows the same way.
   *
   * Gated on a country being picked: unscoped, the check would be asking a
   * different question than the one the save guard answers. Save already
   * requires the country, so nothing is lost by waiting for it.
   *
   * Checks `name`, the box the operator types; `short_name` is derived from it
   * on create (see submit) and preserved on edit.
   */
  const dupError = useDuplicateName({
    table: "ports",
    name: form.name,
    scope: { country_id: form.country_id || null },
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim() && !!form.country_id,
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
    rowInScope: (r) => (r.country_id ?? "") === (form.country_id ?? ""),
  });

  // "Did you mean TUTICORIN?" — a misspelled port is the expensive typo here:
  // it splits every Customer's port of loading across two rows that mean the
  // same berth. Vocabulary is the ports already saved plus the curated export
  // list, and it is NOT scoped to the selected country (the Name is usually
  // typed before the country is picked, and nothing is auto-applied).
  //
  // Exact matches are skipped by design — this hint is for NEAR misses. The
  // exact case is `dupError` above, which now covers it (it did not when this
  // comment was first written, and a duplicated port name saved silently).
  const nameSuggest = useSpellSuggest({
    name: form.name,
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? ""),
    seed: PORT_NAMES,
    enabled: open,
    // Enter applies the highlighted chip; see the hook.
    onApply: (v) => set({ name: v }),
  });

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
        // Mandatory in the schema — see port-types.ts.
        name: form.name.trim(),
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
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No port records yet." />
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
                <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
            <Button size="md" disabled={isPending || !!dupError || !form.country_id || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/* Three fields — one flat section (LAYOUT.md §4), and the whole form is
            one row: name 6 + country 3 + type 3 = 12. It was 6 + 4 + 4 = 14,
            which does not shrink — Type wrapped onto a line of its own with the
            rest of that line empty. Three fields IS the row here; there is no
            fourth to reach for, so the job was sizing each to its data rather
            than hitting a count (client 2026-07-29). */}
        <DetailSection label="Details" cols={12}>
          {/* `sm` like every other field in the masters, not the `lg` a port
              name would earn on its own — one width across the module, small
              form or not (client 2026-07-29). */}
          <Field label="Name" size="sm" required htmlFor="pt-name">
            <Input
              id="pt-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              required
              {...dupFieldProps(dupError, "pt-name")}
            />
            <DuplicateError error={dupError} id="pt-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => set({ name: v })}
            />
          </Field>
          {/* No `label` on the Field: CountryPicker renders its own, and two
              labels misalign the asterisk and break click-to-focus. */}
          <Field size="sm">
            <CountryPicker
              countries={countries}
              value={form.country_id || null}
              onChange={(id) => set({ country_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              // `portInput.country_id` is a bare `.uuid()` — mandatory. This
              // already held (CountryPicker defaults `required` to true); stating
              // it changes nothing at runtime and everything about whether the
              // screen can be SEEN to be correct. Destination looked balanced
              // for the same reason and had its `*` on the wrong field.
              required
            />
          </Field>
          {/* Air / Sea / Sea-Air — `sm` is already generous for it. */}
          <Field label="Type" size="sm" htmlFor="pt-type">
            <Select
              id="pt-type"
              value={form.port_type}
              onChange={(e) => set({ port_type: e.target.value as "" | PortType })}
            >
              <option value="">— Select —</option>
              {PORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </DetailSection>
      </Sheet>
    </div>
  );
}
