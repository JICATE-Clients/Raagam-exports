"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { MultiSelect } from "@/components/ui/multi-select";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { LocationPicker } from "@/components/masters/location-picker";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/lib/masters/department-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  DEPARTMENT_ITEM_CLASSES,
  type Department,
  type DepartmentInput,
  type DepartmentItemClass,
} from "@/lib/masters/department-types";
import type { EmployeeLocation } from "@/lib/masters/employee-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { DEPARTMENT_NAMES } from "@/lib/masters/name-vocabularies";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type DivisionOption = { id: string; division_id: string; division_name: string };
type LocRow = { key: string; location_id: string | null; all_divisions: boolean; division_ids: string[] };

const blankHeader = () => ({
  short_name: "",
  name: "",
  doc_prefix: "",
  warehouse: false,
  inactive: false,
  is_outsourcing: false,
  sequence_no: "" as string | number,
  staff_sequence_no: "" as string | number,
  is_fabric: false,
  is_yarn: false,
  is_sewing: false,
  is_packing: false,
  is_general: false,
  is_garment: false,
});

/**
 * Department master (HR). Rich master — header (Short Name · Name · Doc Prefix ·
 * Warehouse · Inactive) + an Item-Class applicability checklist + a Location grid
 * (Location picker + All Divisions). Distinct from the `department`
 * config_lookups kind used by the party pickers.
 */
export function DepartmentMasterScreen({
  rows,
  locations,
  divisions,
  perms,
}: {
  rows: Department[];
  locations: EmployeeLocation[];
  divisions: DivisionOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankHeader());
  const [itemClasses, setItemClasses] = useState<DepartmentItemClass[]>([]);
  const [locs, setLocs] = useState<LocRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const set = (patch: Partial<ReturnType<typeof blankHeader>>) =>
    setForm((f) => ({ ...f, ...patch }));

  // Checks `name`, the box the operator actually types, even though the payload
  // also derives `short_name` from it on create. The message quotes what they
  // typed; pointing it at short_name would name a column the form never shows.
  //
  // required-hold: exempt -- `departmentInput.short_name` is `.min(1)`, but this
  // screen DERIVES it from the name rather than asking for it. There is no field
  // to carry `required` and none to hold a cursor on; the schema is satisfied by
  // the derivation, and the name that feeds it is the field the operator sees.
  const dupError = useDuplicateName({
    table: "departments",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    seed: DEPARTMENT_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  function openAdd() {
    setEditId(null);
    setForm(blankHeader());
    setItemClasses([]);
    setLocs([{ key: newKey(), location_id: null, all_divisions: false, division_ids: [] }]);
    setOpen(true);
  }
  function openEdit(r: Department) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name,
      name: r.name ?? "",
      doc_prefix: r.doc_prefix ?? "",
      warehouse: r.warehouse,
      inactive: r.inactive,
      is_outsourcing: r.is_outsourcing,
      sequence_no: r.sequence_no ?? "",
      staff_sequence_no: r.staff_sequence_no ?? "",
      is_fabric: r.is_fabric,
      is_yarn: r.is_yarn,
      is_sewing: r.is_sewing,
      is_packing: r.is_packing,
      is_general: r.is_general,
      is_garment: r.is_garment,
    });
    setItemClasses(
      r.item_classes.filter((c): c is DepartmentItemClass =>
        (DEPARTMENT_ITEM_CLASSES as readonly string[]).includes(c),
      ),
    );
    setLocs(
      r.locations.length
        ? r.locations.map((l) => ({
            key: newKey(),
            location_id: l.location_id,
            all_divisions: l.all_divisions,
            division_ids: (l.divisions ?? []).map((d) => d.division_id),
          }))
        : [{ key: newKey(), location_id: null, all_divisions: false, division_ids: [] }],
    );
    setOpen(true);
  }

  function toggleItemClass(c: DepartmentItemClass) {
    setItemClasses((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }
  function addLoc() {
    setLocs((ls) => [...ls, { key: newKey(), location_id: null, all_divisions: false, division_ids: [] }]);
  }
  function setLocPicker(key: string, location_id: string | null) {
    setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, location_id } : l)));
  }
  function toggleLocAllDivisions(key: string, all_divisions: boolean) {
    setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, all_divisions, division_ids: all_divisions ? [] : l.division_ids } : l)));
  }

  /**
   * `MultiSelect` hands back the WHOLE next selection, where the bordered
   * checkbox chips it replaced flipped one id at a time — so the old
   * `toggleLocDivision` went with them rather than being kept "just in case".
   * The picker owns its own keyboard and reports the finished list; a
   * single-id toggle beside it would be a second way to write one field, with
   * nothing calling it.
   */
  function setLocDivisions(key: string, division_ids: string[]) {
    setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, division_ids } : l)));
  }
  function removeLoc(key: string) {
    setLocs((ls) => ls.filter((l) => l.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: DepartmentInput = {
        // Create derives the code from Name; edit keeps the record's original
        // stored short_name (it can be a logic key referenced elsewhere).
        short_name: editId ? form.short_name : form.name.trim(),
        name: form.name.trim() || null,
        doc_prefix: form.doc_prefix.trim() || null,
        warehouse: form.warehouse,
        inactive: form.inactive,
        is_outsourcing: form.is_outsourcing,
        sequence_no: form.sequence_no === "" ? null : Number(form.sequence_no),
        staff_sequence_no: form.staff_sequence_no === "" ? null : Number(form.staff_sequence_no),
        is_fabric: form.is_fabric,
        is_yarn: form.is_yarn,
        is_sewing: form.is_sewing,
        is_packing: form.is_packing,
        is_general: form.is_general,
        is_garment: form.is_garment,
        item_classes: itemClasses,
        locations: locs
          .filter((l) => l.location_id)
          .map((l, i) => ({
            sno: i + 1,
            location_id: l.location_id,
            all_divisions: l.all_divisions,
            divisions: l.all_divisions ? [] : l.division_ids.map((did, di) => ({ division_id: did, sno: di + 1 })),
          })),
      };
      const res = editId ? await updateDepartment(editId, payload) : await createDepartment(payload);
      if (res.ok) {
        success(editId ? "Department updated." : "Department added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Department) {
    startTransition(async () => {
      const res = await deleteDepartment(r.id);
      if (res.ok) {
        success(deletedToast("Department", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  /**
   * ONE DECLARATION for the location lines — `ChildGrid` renders the header and
   * every cell from this array, so a column cannot be added to one and
   * forgotten in the other. The markup this replaces wrote both by hand.
   *
   * `ariaLabel` on the switch is required, not optional: `Toggle`'s `label` is
   * omitted because the column header says it on screen, but a header is not
   * associated with the control programmatically — without it the grid ships an
   * unnamed checkbox.
   */
  const locColumns: ChildGridColumn<LocRow>[] = [
    {
      header: "Location",
      cell: (l) => (
        <LocationPicker
          locations={locations}
          value={l.location_id}
          onChange={(id) => setLocPicker(l.key, id)}
          compact
        />
      ),
    },
    {
      header: "All Divisions",
      width: "auto",
      align: "center",
      cell: (l) => (
        <Toggle
          checked={l.all_divisions}
          onChange={(v) => toggleLocAllDivisions(l.key, v)}
          ariaLabel="Applies to every division at this location"
        />
      ),
    },
    {
      header: "Divisions",
      width: "20rem",
      cell: (l) =>
        l.all_divisions ? (
          /* NOT an empty cell. With the switch on, the picker would be a live
             control whose value is ignored — so say what is stored instead. */
          <span className="text-sm text-muted-foreground">All</span>
        ) : (
          <MultiSelect
            label="Divisions"
            compact
            options={divisions.map((d) => ({ id: d.id, label: d.division_name }))}
            values={l.division_ids}
            onChange={(next) => setLocDivisions(l.key, next)}
          />
        ),
    },
  ];

  const columns: Column<Department>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
    {
      header: "Doc Prefix",
      cell: (r) => <span className="font-mono text-xs">{r.doc_prefix ?? "—"}</span>,
    },
    {
      header: "Warehouse",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.warehouse ? "Yes" : "No"}</span>,
    },
    {
      header: "Locations",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.locations.length}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.short_name, r.name, r.doc_prefix].filter(Boolean).join(" ")}
        searchPlaceholder="Search department…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Department"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No departments yet."
        mobile={{
          title: (r) => r.short_name,
          meta: (r) => `${r.name ?? "—"} · ${r.locations.length} location(s)`,
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : "success"}>
              {r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Department — ${form.short_name}` : "New Department"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !!dupError || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
            {/*
              Header first, locations under it. What this replaces put the
              location grid BESIDE the header in a hand-written two-column
              split, which squeezed the grid into a narrow pane and the pane
              into a card with a title band of its own.

              THE TWO `DetailSection`s WENT WITH IT. "Sequence & Outsourcing"
              and "Item Classes" were bordered cards captioned with what their
              fields already said — Sequence No and Staff Sequence No name
              themselves, and the class list is one field. That is a frame and a
              caption describing the box rather than the record, inside a dialog
              that is already a frame (client 2026-09-04: "there are so many
              extra boxes and lines remove them").
            */}
            <FieldGrid className="max-w-3xl">
              {/* Row 1 — Name · Doc Prefix */}
              <Field label="Name" size="lg" required htmlFor="dep-name">
                <Input
                  id="dep-name"
                  uppercase
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                  onKeyDown={nameSuggest.onKeyDown}
                  {...dupFieldProps(dupError, "dep-name")}
                />
                <DuplicateError error={dupError} id="dep-name" />
                <SpellSuggestHint
                  suggestions={nameSuggest.suggestions}
                  existing={nameSuggest.existing}
                  activeIndex={nameSuggest.activeIndex}
                  duplicate={!!dupError}
                  onApply={(v) => setForm((f) => ({ ...f, name: v }))}
                />
              </Field>

              <Field label="Doc Prefix" size="lg" htmlFor="dep-prefix">
                <Input
                  uppercase
                  id="dep-prefix"
                  value={form.doc_prefix}
                  onChange={(e) => set({ doc_prefix: e.target.value })}
                />
              </Field>

              {/* Row 2 — the two sequence numbers */}
              <Field label="Sequence No" size="lg" htmlFor="dep-seq">
                <Input
                  id="dep-seq"
                  type="number"
                  value={form.sequence_no}
                  onChange={(e) =>
                    set({ sequence_no: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                />
              </Field>

              <Field label="Staff Sequence No" size="lg" htmlFor="dep-staff-seq">
                <Input
                  id="dep-staff-seq"
                  type="number"
                  value={form.staff_sequence_no}
                  onChange={(e) =>
                    set({ staff_sequence_no: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                />
              </Field>

              {/*
                Row 3 — the two flags that were bare checkboxes bottom-aligned
                with `pb-1.5` against no label, so nothing lined up with the
                fields beside them. Switches now, like every other boolean here.
              */}
              <Field label="Warehouse" size="lg">
                <div className="flex h-8 items-center">
                  <Toggle
                    checked={form.warehouse}
                    onChange={(v) => set({ warehouse: v })}
                    label="Stocks materials"
                  />
                </div>
              </Field>

              <Field label="Outsourcing" size="lg">
                <div className="flex h-8 items-center">
                  <Toggle
                    checked={form.is_outsourcing}
                    onChange={(v) => set({ is_outsourcing: v })}
                    label="Work goes outside"
                  />
                </div>
              </Field>

              {/*
                Row 4 — Status, always on the form including add: `submit()`
                sends `inactive` on a create exactly as on an update, so a row
                could always have been saved inactive and nothing on screen let
                anyone say so (client 2026-09-04).
              */}
              <Field label="Status" size="lg">
                <div className="flex h-8 items-center">
                  <Toggle
                    checked={form.inactive}
                    onChange={(v) => set({ inactive: v })}
                    label="Inactive"
                  />
                </div>
              </Field>

              {/*
                Row 5 — the item classes, one field holding six switches rather
                than a captioned card holding a 3-column checkbox grid of its
                own. `full` so it takes the row: six labels do not fit in half.
              */}
              <Field label="Item Classes" size="full">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-1">
                  {DEPARTMENT_ITEM_CLASSES.map((c) => (
                    <Toggle
                      key={c}
                      checked={itemClasses.includes(c)}
                      onChange={() => toggleItemClass(c)}
                      label={c}
                    />
                  ))}
                </div>
              </Field>
            </FieldGrid>

            {/*
              THE LOCATIONS ARE A `ChildGrid` NOW. The hand-rolled version drew
              a bordered panel, a title band inside it, `rounded-md border`
              around EVERY location, and then a bordered CHIP per division
              inside that — four levels of frame, so a department with three
              locations and four divisions each showed more boxes than values.

              No `forceCards`: that prop answers "this row cannot fit without
              scrolling sideways", true above ~6 columns and false at three. It
              would put a card back around each row, which is what is being
              removed. No `label` either — the columns name the grid.

              The division picker is `MultiSelect`, the primitive that already
              exists for this, instead of a hand-rolled row of bordered
              checkbox chips. `compact` drops its label because the column
              header carries it — and note that `compact` drops the required
              star with it, which is fine here because divisions are optional.

              What the conversion adds beyond the look is the keyboard contract
              a hand-rolled grid cannot inherit: Ctrl+Del removes a row from any
              cell, Tab off the last cell lands on "+ Add location", and the
              cursor lands in the row that button opens. `seedRow` opens with
              one blank line, which is also the keyboard's only way in — Tab
              lands on fields and an empty grid has none.
            */}
            <ChildGrid<LocRow>
              columns={locColumns}
              rows={locs}
              onAdd={addLoc}
              onRemove={(l) => removeLoc(l.key)}
              addLabel="+ Add location"
              seedRow
            />
          </div>
      </Sheet>
    </div>
  );
}
