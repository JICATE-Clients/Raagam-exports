"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { type Column } from "@/components/ui/data-table";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LocationPicker } from "@/components/masters/location-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createWorkTiming,
  updateWorkTiming,
  deleteWorkTiming,
} from "@/lib/masters/work-timing-actions";
import type { WorkTiming, WorkTimingInput } from "@/lib/masters/work-timing-types";
import type { EmployeeLocation } from "@/lib/masters/employee-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { fmtDate } from "@/lib/format";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// today as YYYY-MM-DD for the date inputs' default.
function today() {
  return new Date().toISOString().slice(0, 10);
}

type HeaderForm = {
  date: string;
  location_id: string;
  effective_from: string;
};

type LineRow = {
  key: string;
  shift_category_id: string;
  no_of_shifts: string;
  applicable_for_all_categories: boolean;
};
const blankLine = (key: string): LineRow => ({
  key,
  shift_category_id: "",
  no_of_shifts: "",
  applicable_for_all_categories: false,
});

/**
 * Legacy HR "Work Timing" master-detail: header (Entry No auto · Date ·
 * Location → locations · Effective From) + a Shift line grid (Shift Category →
 * config_lookups 'shift_category' · No Of Shifts · Applicable For All
 * Categories). Save / Save-As-Drafts (draft persists with `is_draft = true`).
 */
// dup-check: exempt -- header is an auto Entry No plus Location and Effective
// From. The same location's timings are re-issued at a later date whenever a
// shift pattern changes, and that second row is the revision, not a duplicate.
export function WorkTimingMasterScreen({
  rows,
  locations,
  shiftCategories,
  perms,
}: {
  rows: WorkTiming[];
  locations: EmployeeLocation[];
  shiftCategories: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNo, setEditNo] = useState<number | null>(null);
  const [form, setForm] = useState<HeaderForm>({ date: today(), location_id: "", effective_from: today() });
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setEditId(null);
    setEditNo(null);
    setForm({ date: today(), location_id: "", effective_from: today() });
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: WorkTiming) {
    setEditId(r.id);
    setEditNo(r.entry_no);
    setForm({
      date: r.date?.slice(0, 10) || today(),
      location_id: r.location_id ?? "",
      effective_from: r.effective_from?.slice(0, 10) || today(),
    });
    setLines(
      r.lines.map((l) => ({
        key: newKey(),
        shift_category_id: l.shift_category_id ?? "",
        no_of_shifts: l.no_of_shifts != null ? String(l.no_of_shifts) : "",
        applicable_for_all_categories: l.applicable_for_all_categories,
      })),
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, blankLine(newKey())]);
  }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: WorkTimingInput = {
        date: form.date,
        location_id: form.location_id || null,
        effective_from: form.effective_from,
        is_draft: asDraft,
        lines: lines.map((l, i) => ({
          sno: i + 1,
          shift_category_id: l.shift_category_id || null,
          no_of_shifts: l.no_of_shifts.trim() === "" ? null : Number(l.no_of_shifts),
          applicable_for_all_categories: l.applicable_for_all_categories,
        })),
      };
      const res = editId ? await updateWorkTiming(editId, payload) : await createWorkTiming(payload);
      if (res.ok) {
        success(editId ? "Work timing updated." : asDraft ? "Saved as draft." : "Work timing added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: WorkTiming) {
    startTransition(async () => {
      const res = await deleteWorkTiming(r.id);
      if (res.ok) {
        success("Work timing deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: WorkTiming) {
    return r.is_draft ? (
      <StatusPill tone="warning">Draft</StatusPill>
    ) : (
      <StatusPill tone="success">Active</StatusPill>
    );
  }

  /**
   * ONE DECLARATION for the shift lines. `ChildGrid` renders the table header
   * and each cell from this array, so a column cannot be added to the header
   * and forgotten in the row — which is exactly what the hand-rolled markup
   * this replaces made possible, since it wrote both by hand in two places.
   *
   * `width` is the card-mode track and the table's column hint: the picker
   * column omits it and flexes, the count is fixed, the switch hugs.
   *
   * `ariaLabel` on the switch is NOT optional here. `Toggle`'s `label` is
   * omitted because the column header already says it on screen — but a header
   * is not associated with the control programmatically, so without this the
   * grid would ship an unnamed checkbox.
   */
  const lineColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Shift Category",
      cell: (l) => (
        <LookupDialogPicker
          kind="shift_category"
          label="Shift Category"
          options={shiftCategories}
          value={l.shift_category_id || null}
          onChange={(id) => setLineAt(l.key, { shift_category_id: id })}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          compact
        />
      ),
    },
    {
      header: "No Of Shifts",
      width: "9rem",
      align: "right",
      cell: (l) => (
        <Input
          type="number"
          min={0}
          value={l.no_of_shifts}
          onChange={(e) => setLineAt(l.key, { no_of_shifts: e.target.value })}
          aria-label="No of shifts"
        />
      ),
    },
    {
      header: "All Categories",
      // A FIXED WIDTH, NOT `auto`. `auto` is this prop's CARD-mode
      // spelling for "hug"; in the TABLE branch it lands on
      // `<th style={{width:"auto"}}>`, which is the CSS default — so the
      // column absorbed the table's leftover width and left a band of
      // empty space beside a 40px switch (client 2026-09-09).
      width: "8rem",
      align: "center",
      cell: (l) => (
        <Toggle
          checked={l.applicable_for_all_categories}
          onChange={(v) => setLineAt(l.key, { applicable_for_all_categories: v })}
          ariaLabel="Applies to every employee category"
        />
      ),
    },
  ];

  const columns: Column<WorkTiming>[] = [
    { header: "Entry No", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{fmtDate(r.date)}</span> },
    {
      header: "Location",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.location?.name ?? "—"}</span>,
    },
    {
      header: "Effective From",
      cell: (r) => <span className="text-sm text-muted-foreground">{fmtDate(r.effective_from)}</span>,
    },
    {
      header: "Shifts",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.lines.length || "—"}</span>,
    },
    { header: "Status", cell: (r) => statusPill(r) },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [String(r.entry_no), r.location?.name].filter(Boolean).join(" ")}
        searchPlaceholder="Search by entry no or location…"
        statusOf={(r) => (r.is_draft ? "draft" : "active")}
        addLabel="+ Add Work Timing"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No work timings yet."
        mobile={{
          title: (r) => `#${r.entry_no}${r.location?.name ? ` · ${r.location.name}` : ""}`,
          meta: (r) =>
            `${r.date?.slice(0, 10) ?? ""} · ${r.lines.length} shift${r.lines.length === 1 ? "" : "s"}`,
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
        title={editId ? `Edit Work Timing #${editNo}` : "New Work Timing"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={isPending || !form.date || !form.effective_from}
              onClick={() => submit(true)}
            >
              Save as Draft
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.date || !form.effective_from}
              onClick={() => submit(false)}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/*
            Header first, lines under it — the two-column split this replaces put
            the shift grid BESIDE the header fields, which is what forced the
            grid into a narrow right-hand pane and the pane into a card with a
            title band of its own.
          */}
          <FieldGrid className="max-w-3xl">
            {/* Row 1 — Entry No · Date */}
            <Field label="Entry No" size="lg" skipTab>
              {/* `readOnly` + `skipTab`, not `disabled`: reachable by mouse, off
                  the typing path. The old "(auto)" described the box. */}
              <Input value={editNo != null ? `#${editNo}` : ""} readOnly />
            </Field>

            <Field label="Date" size="lg" required htmlFor="wt-date">
              <Input
                id="wt-date"
                type="date"
                // `.min(1)` in `workTimingInput`.
                required
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </Field>

            {/* Row 2 — Location · Effective From */}
            <Field label="Location" size="lg">
              {/*
                `compact` DROPS THE PICKER'S OWN LABEL. `LocationPicker` defaults
                to drawing one, so inside a `<Field>` the word appeared twice —
                and the inner label also pushed the control a row lower than the
                date beside it, so the pair no longer lined up (client
                2026-09-07: "there is 2 locations here").

                The `Field`'s label is the one that stays: it is what the other
                fields draw, so keeping it is what keeps this control on the same
                baseline as Effective From. Dropping the outer one instead would
                have left a single label — sitting lower than every other label
                on the form.
              */}
              <LocationPicker
                compact
                locations={locations}
                value={form.location_id || null}
                onChange={(id) => set({ location_id: id ?? "" })}
              />
            </Field>

            <Field label="Effective From" size="lg" required htmlFor="wt-eff">
              <Input
                id="wt-eff"
                type="date"
                // `.min(1)` in `workTimingInput`.
                required
                value={form.effective_from}
                onChange={(e) => set({ effective_from: e.target.value })}
              />
            </Field>
          </FieldGrid>

          {/*
            THE SHIFT LINES ARE A `ChildGrid` NOW, and the frames are what that
            buys. The hand-rolled version drew three: a bordered panel, a grey
            title band inside it, and `rounded-md border` around EVERY shift — so
            a work timing with four shifts showed six boxes (client 2026-09-04:
            "there are so many extra boxes and lines remove them"). A grid draws
            one frame; rows are divided by a hairline inside it.

            NO `forceCards`, DELIBERATELY. That prop answers "this row cannot fit
            without scrolling sideways", which is true above about six columns
            and false at three — the layout contract is explicit that below that
            a table still fits and still reads better. `forceCards` here would
            re-introduce a card per row, which is the thing being removed.

            NO `label` either: the de-clutter rule drops a grid's caption band
            where something already names it, and the columns do — "Shift
            Category" heads the first one.

            What the conversion adds beyond the look is the keyboard contract,
            which a hand-rolled grid cannot inherit: Ctrl+Del removes a row from
            any cell (it drives the row's own ✕ via `data-row-remove`), Tab off
            the last cell lands on "+ Add shift" rather than escaping the
            section, and the cursor lands in the row that button opens. The old
            markup called `gridKeyNav` by hand and had none of the rest.

            `seedRow` opens with one blank line so entering the first shift costs
            no click — and it is what gives the keyboard a way in at all, since
            Tab lands on fields and an empty grid has none.
          */}
          <ChildGrid<LineRow>
            columns={lineColumns}
            rows={lines}
            onAdd={addLine}
            onRemove={(l) => removeLine(l.key)}
            addLabel="+ Add shift"
            seedRow
          />
        </div>
      </Sheet>
    </div>
  );
}
