"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Building2, CalendarRange } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { LocationPicker } from "@/components/masters/location-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import {
  createTaDepartmentAssign,
  updateTaDepartmentAssign,
  deleteTaDepartmentAssign,
} from "@/lib/orders/ta-department-assign/actions";
import type { TaDepartmentAssign } from "@/lib/orders/ta-department-assign/types";
import type { TaDeptAssignFormData } from "@/lib/orders/ta-department-assign/service";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  createdByFacet,
  createdDateFacet,
  flagFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
interface Props {
  rows: TaDepartmentAssign[];
  data: TaDeptAssignFormData;
  perms: Perms;
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type LineRow = { key: string; activity_id: string | null; is_owner: boolean };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * THE GROUPED DRAWER (user, 2026-09-23: "implement the Material BOM filter in
 * every Orders child"). The list had no filter; every facet reads a field the
 * row already carries (the embedded location / department and the lines), so
 * none costs a query. "Owner" asks whether ANY line flags the department as
 * the owner — the one thing on a line the list can answer without opening it.
 */
const ASSIGN_FACETS: FacetGroup<TaDepartmentAssign>[] = [
  {
    title: "Dates",
    icon: <CalendarRange />,
    facets: [
      { key: "entered", label: "Entered Date", all: "Any date", wide: true, date: (r) => r.entered_date },
      createdDateFacet(),
      createdByFacet(),
    ],
  },
  {
    title: "Department & location",
    icon: <Building2 />,
    facets: [
      { key: "department", label: "Department", all: "All departments", wide: true, value: (r) => r.department?.name },
      { key: "location", label: "Location", all: "All locations", value: (r) => r.location?.name },
      flagFacet("owner", "Owner", (r) => r.lines.some((l) => l.is_owner), "Owns an activity", "Owns none"),
    ],
  },
];

export function TaDepartmentAssignScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [enteredDate, setEnteredDate] = useState(() => today());
  const [locationId, setLocationId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // Inline editor, not a Sheet / MasterFullScreen — see mba-master-screen.tsx.
  useUnsavedGuard(mode === "edit" || isPending);

  /* Above the `mode === "list"` return, like every hook here (AGENTS.md
     "Hooks above every early return"). */
  const [query, setQuery] = useState("");
  const facets = useFacetFilter(rows, ASSIGN_FACETS);
  const matchesFacets = facets.matches;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesFacets(r)) return false;
      if (!needle) return true;
      return [r.code, r.location?.name, r.department?.name].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [rows, query, matchesFacets]);

  function openAdd() {
    setEditId(null);
    setEnteredDate(today());
    setLocationId(null);
    setDepartmentId(null);
    setLines([{ key: newKey(), activity_id: null, is_owner: false }]);
    setMode("edit");
  }

  useCreateIntent(() => openAdd());

  function openEdit(r: TaDepartmentAssign) {
    setEditId(r.id);
    setEnteredDate(r.entered_date ?? today());
    setLocationId(r.location_id);
    setDepartmentId(r.department_id);
    setLines(
      r.lines.length
        ? r.lines.map((l) => ({
            key: newKey(),
            activity_id: l.activity_id,
            is_owner: l.is_owner,
          }))
        : [{ key: newKey(), activity_id: null, is_owner: false }],
    );
    setMode("edit");
  }

  function submit() {
    const payload = {
      entered_date: enteredDate,
      location_id: locationId,
      department_id: departmentId,
      lines: lines.map((r) => ({ sno: 0, activity_id: r.activity_id, is_owner: r.is_owner })),
    };
    start(async () => {
      const res = editId
        ? await updateTaDepartmentAssign(editId, payload)
        : await createTaDepartmentAssign(payload);
      if (res.ok) {
        success(editId ? "Assignment updated" : "Assignment created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: TaDepartmentAssign) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteTaDepartmentAssign(r.id);
      if (res.ok) {
        success("Assignment deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST ----------------
  if (mode === "list") {
    const columns: Column<TaDepartmentAssign>[] = [
      {
        header: "Entry No",
        cell: (r) => (
          <button
            type="button"
            onClick={() => perms.canEdit && openEdit(r)}
            className="font-mono text-xs font-medium text-primary hover:underline"
          >
            {r.code ?? "—"}
          </button>
        ),
      },
      { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.entered_date)}</span> },
      { header: "Location", cell: (r) => <span className="text-sm">{r.location?.name ?? "—"}</span> },
      { header: "Department", cell: (r) => <span className="text-sm">{r.department?.name ?? "—"}</span> },
      {
        header: "Activities",
        align: "right",
        cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{r.lines.length}</span>,
      },
      rowActionsColumn((r) => (
        <RowActions
          label={r.code}
          onEdit={() => openEdit(r)}
          canEdit={perms.canEdit}
          onDelete={() => del(r)}
          canDelete={perms.canDelete}
          isPending={isPending}
        />
      )),
    ];
    return (
      <div className="space-y-4">
        <PageHeader
          title="TA Department Assign"
          description="Assign Time & Action activities to a department at a location, flagging the owner."
          actions={perms.canCreate ? <Button onClick={openAdd}>New Assignment</Button> : undefined}
        />
        <FilterBar
          search={query}
          onSearch={setQuery}
          searchPlaceholder="Search Entry No, location or department…"
          activeCount={facets.activeCount}
          onReset={facets.activeCount ? facets.reset : undefined}
          panel={facets.panel}
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={filtered}
          getKey={(r) => r.id}
          empty={rows.length ? "No assignments match these filters." : "No assignments yet."}
        />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  const activityColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Activity",
      cell: (r) => (
        <RecordPicker
          label="Activity"
          items={data.activities}
          value={r.activity_id}
          onChange={(id) =>
            setLines((xs) => xs.map((x) => (x.key === r.key ? { ...x, activity_id: id } : x)))
          }
          compact
        />
      ),
    },
    {
      // A tick box IS a column on the arrow axis (`ROW_FIELDS` in child-grid.tsx
      // counts it), so left/right reach it and Enter ticks it — neither of which
      // worked while this row sat outside a `data-grid-body`.
      header: "Owner",
      align: "center",
      width: "6rem",
      cell: (r) => (
        <input
          type="checkbox"
          aria-label="Owner"
          className="h-4 w-4 rounded border-border accent-primary"
          checked={r.is_owner}
          onChange={(e) =>
            setLines((xs) => xs.map((x) => (x.key === r.key ? { ...x, is_owner: e.target.checked } : x)))
          }
        />
      ),
    },
  ];

  return (
    // ONE MARKER, NEVER A HANDLER. `isEditorScope()` is false without it, so Tab
    // keeps native order and walks out of the form. The PageHeader inside is
    // stamped `data-focus-region="header"` by the component itself, so its
    // actions sort as chrome rather than with the fields.
    <div data-focus-scope className="space-y-4">
      <PageHeader
        title={editId ? "Edit Assignment" : "New Assignment"}
        // back={false}: this screen swaps a list and an editor at ONE url, and
        // the editor already shows "← Back to list". The derived hub link is
        // right on the LIST branch above and a second, differently aimed Back here.
        back={false}
        description="Pick a Location & Department, then assign activities. Blank rows are ignored."
        actions={
          <Button variant="outline" size="md" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* `FieldGrid`, not a hand-rolled `lg:grid-cols-4` — a screen composes
          primitives, it does not draw (LAYOUT.md §3). */}
      <Card>
        <CardBody>
          <FieldGrid>
            {/* `readOnly`, not `disabled` — see the twin note in
                ta-plan-screen.tsx. `disabled` greys an auto value at
                `opacity-50` so it reads as switched off, and drops it from the
                accessibility tree. */}
            <Field label="Entry No" size="sm" htmlFor="tda-entry">
              <Input
                id="tda-entry"
                className="font-mono"
                value={editId ? (rows.find((r) => r.id === editId)?.code ?? "") : "(auto)"}
                readOnly
              />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the same
                prop draws the star AND stamps `data-required-empty`, so the
                cursor holds on a blank box. */}
            <Field label="Entered Dt" required size="sm" htmlFor="tda-date">
              <Input
                id="tda-date"
                type="date"
                value={enteredDate}
                onChange={(e) => setEnteredDate(e.target.value)}
              />
            </Field>
            {/* The pickers draw their own labels; `Field` carries the span. */}
            <Field size="sm">
              <LocationPicker locations={data.locations} value={locationId} onChange={setLocationId} />
            </Field>
            <Field size="sm">
              <LookupDialogPicker
                kind="department"
                label="Department"
                options={data.departments}
                value={departmentId}
                onChange={setDepartmentId}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      {/* `ChildGrid`, not the hand-rolled <table> this carried. That one had no
          `data-grid-body` at all, so its rows were off the arrow axis entirely,
          and its remove button was a bare `<button>` Tab stopped on. */}
      <Card>
        <CardBody>
          <ChildGrid<LineRow>
            label="Activities"
            columns={activityColumns}
            rows={lines}
            seedRow
            onAdd={() => setLines((xs) => [...xs, { key: newKey(), activity_id: null, is_owner: false }])}
            onRemove={(r) => setLines((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add activity"
          />
        </CardBody>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>Cancel</Button>
        <Button disabled={isPending || !enteredDate} onClick={submit}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
