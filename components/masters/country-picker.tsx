"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { createCountryQuick, updateCountry, deleteCountry } from "@/lib/masters/country-actions";
import {
  COUNTRY_GROUPS,
  type Country,
  type CountryGroup,
  type CountryInput,
} from "@/lib/masters/country-types";
import { isInactive } from "@/lib/masters/inactive";

type FormState = {
  code: string;
  name: string;
  country_group: "" | CountryGroup;
  ecgc_code: string;
  isd_code: string;
  default_country: boolean;
  inactive: boolean;
};
const BLANK_FORM: FormState = {
  code: "",
  name: "",
  country_group: "",
  ecgc_code: "",
  isd_code: "",
  default_country: false,
  inactive: false,
};

/**
 * The Country field, everywhere one appears (12 screens).
 *
 * A `DataPicker` — the list drops down under the field and searches as you type
 * — plus a **quick-create sheet** for Add and Modify, because a Country is not
 * just a name: the ISD code it carries is read by the contact fields on half a
 * dozen masters, and the ECGC code by export documents. `onAddOverride` and
 * `onEditOverride` are exactly the seam for that (client 2026-07-29); a config
 * list like City uses the picker's own inline name form instead.
 *
 * Add and Modify write through the shared Country master, so a country created
 * or corrected here changes everywhere it is referenced — the behaviour the
 * legacy ⓘ popup had, kept.
 */
export function CountryPicker({
  countries,
  value,
  onChange,
  canCreate,
  canEdit,
  canDelete,
  compact = false,
  required = true,
  id,
}: {
  countries: Country[];
  value: string | null;
  onChange: (id: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  /**
   * Defaults to TRUE, which is what this picker has always done — the inner
   * `LookupDialogPicker` hard-coded `required`, so every Country field in the app
   * already holds a blank cursor. Exposing it changes no behaviour; it lets the
   * call site SAY so, which is the difference between a screen that is correct
   * and a screen that can be seen to be correct.
   *
   * `audit_layout.py --check required-hold` counts `required` in the screen, and
   * requiredness buried in a shared picker is invisible to it: Destination
   * declared one `required` against two mandatory fields and looked balanced,
   * with the declaration on Name and the mandatory field being Country.
   */
  required?: boolean;
  /** Defaults to `canEdit` — see the note in `lookup-dialog-picker.tsx`. The
   *  delete itself is guarded: a country any record references is deactivated,
   *  not removed. */
  canDelete?: boolean;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
  /**
   * Anchors the field for `goToSection(..., { fieldId })` — a blocked Save jumps
   * to the section AND focuses the offending control, and that lookup is a plain
   * `querySelector("#id")`, so an id that never reaches the DOM makes the jump
   * silently do nothing. Straight through to `DataPicker`.
   */
  id?: string;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();

  // Countries created / edited in this session, merged over the server rows —
  // the list arrives as a prop from a server component, so without this a
  // country the operator just added is invisible until the refresh lands.
  const [extra, setExtra] = useState<Country[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);

  const all = useMemo(() => {
    const byId = new Map<string, Country>();
    for (const c of countries) byId.set(c.id, c);
    for (const c of extra) byId.set(c.id, c); // session edits win
    for (const id of removed) byId.delete(id);
    return [...byId.values()];
  }, [countries, extra, removed]);

  const rows: PickerRow[] = useMemo(
    () =>
      [...all]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, label: c.name, inactive: isInactive(c) })),
    [all],
  );

  // ---- the quick-create / modify sheet ----
  const [formOpen, setFormOpen] = useState(false);
  const [formEditId, setFormEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  // The picker hands us its `commit` so a save can select the row and close the
  // list in one step. Held in a ref because the sheet outlives the callback.
  const commitRef = useRef<((id: string) => void) | null>(null);

  function openAdd(commit: (id: string) => void) {
    commitRef.current = commit;
    setFormEditId(null);
    setForm(BLANK_FORM);
    setFormOpen(true);
  }
  function openEdit(row: PickerRow, commit: (id: string) => void) {
    const c = all.find((x) => x.id === row.id);
    if (!c) return;
    commitRef.current = commit;
    setFormEditId(c.id);
    setForm({
      code: c.code ?? "",
      name: c.name,
      country_group: c.country_group ?? "",
      ecgc_code: c.ecgc_code ?? "",
      isd_code: c.isd_code ?? "",
      default_country: c.default_country,
      inactive: c.inactive,
    });
    setFormOpen(true);
  }

  // The "+ Add" on any of the 12 Country fields is the path that duplicated
  // "INDIA" most: the operator cannot see the master list from here, so nothing
  // told them the country already existed. `enabled` keeps the round trip off
  // the keystroke while the sheet is shut. Unscoped, like `uq_countries_name` —
  // a DEACTIVATED country keeps its name reserved.
  const dupError = useDuplicateName({
    table: "countries",
    name: form.name,
    excludeId: formEditId ?? undefined,
    enabled: formOpen,
    // `all`, not `countries` — a country added earlier in this same session is
    // in the merge above and not yet in the server prop, and typing it a second
    // time is precisely the mistake this check was added for.
    rows: all,
    rowId: (c) => c.id,
    rowValue: (c) => c.name,
  });

  function saveForm() {
    if (dupError) return; // the server rejects it too; don't spend the round trip
    start(async () => {
      const payload: CountryInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        country_group: form.country_group ? form.country_group : null,
        ecgc_code: form.ecgc_code.trim() || null,
        isd_code: form.isd_code.trim() || null,
        default_country: form.default_country,
        inactive: form.inactive,
        is_draft: false,
      };
      if (formEditId) {
        const res = await updateCountry(formEditId, payload);
        if (!res.ok) return error(res.error);
        const base = all.find((c) => c.id === formEditId);
        if (base) {
          setExtra((xs) => [
            ...xs.filter((c) => c.id !== formEditId),
            { ...base, ...payload, id: formEditId },
          ]);
        }
        success("Country updated.");
      } else {
        const res = await createCountryQuick(payload);
        if (!res.ok) return error(res.error);
        // A synthetic row so the new country is selectable before the server
        // round trip returns; `router.refresh()` replaces it with the real one.
        setExtra((xs) => [
          ...xs,
          { ...payload, id: res.id, created_at: "", updated_at: "" } as unknown as Country,
        ]);
        success("Country added.");
        commitRef.current?.(res.id);
      }
      setFormOpen(false);
      router.refresh();
    });
  }

  const manage: ManageConfig = {
    canCreate,
    canEdit,
    canDelete: canDelete ?? canEdit,
    // Never reached: `onAddOverride` / `onEditOverride` take both paths before
    // the inline name-only form can open. Present because ManageConfig is the
    // shape that also drives which icons render.
    onCreate: async () => ({ ok: false, error: "Use the Country form." }),
    onUpdate: async () => ({ ok: false, error: "Use the Country form." }),
    onDelete: (id) => deleteCountry(id),
    onCreated: () => {},
    onUpdated: () => {},
    onDeleted: (id, inactive) => {
      setRemoved((xs) => [...xs, id]);
      if (!inactive) setExtra((xs) => xs.filter((c) => c.id !== id));
      router.refresh();
    },
    draftOf: (r) => ({ code: all.find((c) => c.id === r.id)?.code ?? "", name: r.label }),
  };

  return (
    <>
      <DataPicker
        id={id}
        label="Country"
        rows={rows}
        value={value}
        // The legacy contract is "a picked id", never null.
        onChange={(id) => onChange(id ?? "")}
        clearable={false}
        required={required}
        compact={compact}
        manage={manage}
        onAddOverride={openAdd}
        onEditOverride={openEdit}
      />

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="sm"
        title={formEditId ? "Modify Country" : "Add Country"}
        footer={
          <>
            <Button type="button" variant="outline" size="md" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="md"
              disabled={isPending || !form.name.trim() || !!dupError}
              onClick={saveForm}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required htmlFor="cp-name">
            <Input
              id="cp-name"
              autoFocus
              uppercase
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              {...dupFieldProps(dupError, "cp-name")}
            />
            <DuplicateError error={dupError} id="cp-name" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cp-code">Code</Label>
              <Input
                id="cp-code"
                uppercase
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="cp-group">Country Group</Label>
              <Select
                id="cp-group"
                value={form.country_group}
                onChange={(e) =>
                  setForm((f) => ({ ...f, country_group: e.target.value as "" | CountryGroup }))
                }
              >
                <option value=""></option>
                {COUNTRY_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cp-ecgc">ECGC Code</Label>
              <Input
                id="cp-ecgc"
                uppercase
                value={form.ecgc_code}
                onChange={(e) => setForm((f) => ({ ...f, ecgc_code: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="cp-isd">ISD Code</Label>
              <Input
                id="cp-isd"
                uppercase
                value={form.isd_code}
                onChange={(e) => setForm((f) => ({ ...f, isd_code: e.target.value }))}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.default_country}
              onChange={(e) => setForm((f) => ({ ...f, default_country: e.target.checked }))}
            />
            <span className="text-sm text-foreground">Default Country</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => setForm((f) => ({ ...f, inactive: e.target.checked }))}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </>
  );
}
