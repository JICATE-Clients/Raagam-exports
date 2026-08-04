"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Select } from "@/components/ui/select";
import { Field, type FieldSize } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { COUNTRY_NAMES } from "@/lib/masters/geo-names";
import { createCountry, updateCountry, deleteCountry } from "@/lib/masters/country-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { COUNTRY_GROUPS, type Country, type CountryGroup, type CountryInput } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  code: "",
  name: "",
  country_group: "" as "" | CountryGroup,
  ecgc_code: "",
  isd_code: "",
  default_country: false,
  inactive: false,
};

/**
 * How wide each field is on the 12-col track. Sized to the data, not to the
 * cell: everything here except the name is two to four characters or a tick.
 *
 * THE SPANS OF A ROW MUST SUM TO 12. Nothing in the build catches a row that
 * goes past it — the last field simply wraps onto a line of its own with the
 * rest of that line left empty.
 *
 *   row 1 — name 6 + country_group 2 + ecgc_code 2 + isd_code 2 = 12
 *   row 2 — default_country 2 + inactive 2 = 4  (the flags; inactive is edit-only)
 *
 * Four per row is the target (client 2026-07-29). It lands here because the
 * three codes stopped taking a third of the row each — they were md/xs/xs, so
 * row 1 was 6+4+2 = 12 with only THREE fields on it and ISD pushed down.
 */
/**
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row (client 2026-07-29) —
 * the City / State / Pin / Country shape, applied across the masters instead of
 * sizing each field to its own data. Rows here are 3+3+3+3 = 12 then 3+3 = 6.
 * See applicant-master-screen for the rule and what it trades away.
 */
const FIELD_SIZE = {
  name: "sm", // "UNITED ARAB EMIRATES" scrolls inside the box
  country_group: "sm",
  ecgc_code: "sm",
  isd_code: "sm",
  default_country: "sm",
  inactive: "sm",
} satisfies Record<string, FieldSize>;

/**
 * The stored `code` for a NEW country, derived from its name.
 *
 * It used to be the trimmed name and nothing more, so two countries typed the
 * same way carried the same code as well as the same name. The name is now
 * unique at all three layers (`uq_countries_name`, migration 0373), but a code
 * an operator typed by hand in the picker's Add sheet can still sit on the one
 * a later name would derive — so suffix `-2`, `-3` … until the code is free
 * among the rows we hold.
 *
 * Best-effort by construction: it can only see the rows on this page, and the
 * name index is what actually makes two identical countries impossible.
 */
function deriveCode(name: string, existing: Country[]): string | null {
  const base = name.trim();
  if (!base) return null;
  const taken = new Set(
    existing.map((c) => (c.code ?? "").trim().toUpperCase()).filter(Boolean),
  );
  if (!taken.has(base.toUpperCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate.toUpperCase())) return candidate;
  }
  return base;
}

/**
 * Legacy "Country" master (Associates). Flat form with a Country Group enum and
 * Save / Save-As-Drafts — the draft button persists with `is_draft = true`.
 * List chrome via MasterListShell (search + status facet + pagination + mobile
 * delete + two-step delete + ?new=1 create intent).
 */
export function CountryMasterScreen({ rows, perms }: { rows: Country[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  // Told as they type, not on Save. `excludeId` stops an edit reporting the
  // record as colliding with itself; `enabled` keeps the round trip off the
  // keystroke while the sheet is closed. Unscoped, matching the on-save guard
  // in country-actions.ts and `uq_countries_name` — a DEACTIVATED country
  // keeps its name reserved.
  const dupError = useDuplicateName({
    table: "countries",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: open,
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  // "Did you mean GERMANY?" — the duplicate check above only fires on an EXACT
  // collision, so GERMNY sails past it and becomes a second country nobody
  // meant to create. Suppressed while dupError is showing: one line under the
  // input, and the red error is the more urgent of the two.
  const nameSuggest = useSpellSuggest({
    name: form.name,
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name),
    seed: COUNTRY_NAMES,
    enabled: open,
    // Enter applies the highlighted chip; see the hook.
    onApply: (v) => set({ name: v }),
  });

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
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    if (dupError) return; // the server rejects it too; don't spend the round trip
    startTransition(async () => {
      const payload: CountryInput = {
        // Create derives the code from Name (deduped — see deriveCode); edit
        // keeps the record's original stored code (it can be a logic key
        // referenced elsewhere).
        code: editId ? form.code || null : deriveCode(form.name, rows),
        name: form.name.trim(),
        country_group: form.country_group ? form.country_group : null,
        ecgc_code: form.ecgc_code.trim() || null,
        isd_code: form.isd_code.trim() || null,
        default_country: form.default_country,
        inactive: form.inactive,
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
        success(deletedToast("Country", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: Country) {
    if (r.is_draft) return <StatusPill tone="warning">Draft</StatusPill>;
    if (r.inactive) return <StatusPill tone="danger">Inactive</StatusPill>;
    return <StatusPill tone="success">Active</StatusPill>;
  }

  const columns: Column<Country>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Group", cell: (r) => <span className="text-sm text-muted-foreground">{r.country_group ?? "—"}</span> },
    { header: "ISD", cell: (r) => <span className="text-sm text-muted-foreground">{r.isd_code ?? "—"}</span> },
    {
      header: "Default",
      cell: (r) => (r.default_country ? <span className="text-sm text-primary">✓</span> : <span className="text-sm text-muted-foreground">—</span>),
    },
    { header: "Status", cell: (r) => statusPill(r) },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [r.code, r.name, r.country_group, r.isd_code, r.ecgc_code].filter(Boolean).join(" ")
        }
        searchPlaceholder="Search country…"
        statusOf={(r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active")}
        addLabel="+ Add Country"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No country records yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            [r.country_group, r.isd_code ? `+${r.isd_code}` : null].filter(Boolean).join(" · ") || null,
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
        title={editId ? "Edit Country" : "New Country"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={isPending || !form.name.trim() || !!dupError}
              onClick={() => submit(true)}
            >
              Save as Draft
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.name.trim() || !!dupError}
              onClick={() => submit(false)}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/* Six fields — under the 7 that would call for grouping (LAYOUT.md §4),
            so one flat section. Widths come from FIELD_SIZE at the top of this
            file, which carries the row arithmetic. */}
        <DetailSection label="Details" cols={12}>
          <Field label="Name" size={FIELD_SIZE.name} required htmlFor="co-name">
            <Input
              id="co-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              required
              {...dupFieldProps(dupError, "co-name")}
            />
            <DuplicateError error={dupError} id="co-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => set({ name: v })}
            />
          </Field>
          <Field label="Country Group" size={FIELD_SIZE.country_group} htmlFor="co-group">
            <Select
              id="co-group"
              value={form.country_group}
              onChange={(e) => set({ country_group: e.target.value as "" | CountryGroup })}
            >
              <option value="">— Select —</option>
              {COUNTRY_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ECGC Code" size={FIELD_SIZE.ecgc_code} htmlFor="co-ecgc">
            <Input
              uppercase
              id="co-ecgc"
              value={form.ecgc_code}
              onChange={(e) => set({ ecgc_code: e.target.value })}
            />
          </Field>
          <Field label="ISD Code" size={FIELD_SIZE.isd_code} htmlFor="co-isd">
            <ValidatedInput
              id="co-isd"
              format="isd"
              value={form.isd_code}
              onChange={(e) => set({ isd_code: e.target.value })}
            />
          </Field>
          {/* Each flag gets its own cell rather than a hand-rolled flex row, so
              the checkboxes sit on the same 12-col track as everything else.
              A tick is a Yes/No, which is `xs` — at `md` the two of them ate a
              two-thirds row on their own. */}
          <Field size={FIELD_SIZE.default_country}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.default_country}
                onChange={(e) => set({ default_country: e.target.checked })}
              />
              <span className="text-sm text-foreground">Default Country</span>
            </label>
          </Field>
          {editId && (
            <Field size={FIELD_SIZE.inactive}>
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
