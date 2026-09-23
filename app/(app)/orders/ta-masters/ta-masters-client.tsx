"use client";

import { useMemo, useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import {
  createTaActivity,
  updateTaActivity,
  toggleTaActivity,
  deleteTaActivity,
} from "@/lib/orders/ta-activities/actions";
import type { TaActivity } from "@/lib/orders/ta-activities/types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Ban, CalendarRange, CheckCircle2, ListChecks } from "lucide-react";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  createdByFacet,
  createdDateFacet,
  flagFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";

/**
 * THE GROUPED DRAWER (user, 2026-09-23: "implement the Material BOM filter in
 * every Orders child"). The list had no filter; every facet reads a field the
 * row already carries. Status is COUNTED (Active before Blocked — the order of
 * "what is in use"), so a zero is shown and not choosable. `department` is left
 * out: it is retained on the row but not on this form, so a facet over it would
 * offer values the operator can neither see nor set here.
 */
const ACTIVITY_FACETS: FacetGroup<TaActivity>[] = [
  {
    title: "Status & type",
    icon: <ListChecks />,
    facets: [
      {
        key: "status",
        label: "Status",
        all: "All statuses",
        wide: true,
        counted: true,
        options: [
          { value: "active", label: "Active" },
          { value: "blocked", label: "Blocked" },
        ],
        match: (a, v) => (v === "active") === a.is_active,
      },
      { key: "type", label: "Type", all: "All types", value: (a) => a.type?.name },
      flagFacet("sub", "Sub-activities", (a) => a.has_sub_activities, "Has sub-activities", "No sub-activities"),
    ],
  },
  {
    title: "Delivery & created",
    icon: <CalendarRange />,
    facets: [
      flagFacet(
        "delivery",
        "Delivery date",
        (a) => a.consider_for_delivery_date,
        "Considered",
        "Not considered",
      ),
      createdDateFacet(),
      createdByFacet(),
    ],
  },
];

interface Props {
  activities: TaActivity[];
  types: ConfigLookup[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  masterCanCreate: boolean;
  masterCanEdit: boolean;
}

export function TaMastersClient({
  activities,
  types,
  canCreate,
  canEdit,
  canDelete,
  masterCanCreate,
  masterCanEdit,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shortName, setShortName] = useState("");
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [hasSub, setHasSub] = useState(false);

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(formOpen || isPending);
  const [considerDelivery, setConsiderDelivery] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const [query, setQuery] = useState("");
  const facets = useFacetFilter(activities, ACTIVITY_FACETS);
  const matchesFacets = facets.matches;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activities.filter((a) => {
      if (!matchesFacets(a)) return false;
      if (!needle) return true;
      return [a.short_name, a.name, a.type?.name].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [activities, query, matchesFacets]);

  function reset() {
    setShortName("");
    setName("");
    setTypeId(null);
    setHasSub(false);
    setConsiderDelivery(false);
    setBlocked(false);
  }

  function openCreate() {
    setEditingId(null);
    reset();
    setFormOpen(true);
  }

  useCreateIntent(() => openCreate());

  function openEdit(a: TaActivity) {
    setEditingId(a.id);
    setShortName(a.short_name);
    setName(a.name);
    setTypeId(a.type_id);
    setHasSub(a.has_sub_activities);
    setConsiderDelivery(a.consider_for_delivery_date);
    setBlocked(!a.is_active);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      short_name: shortName.trim(),
      name: name.trim(),
      type_id: typeId,
      has_sub_activities: hasSub,
      consider_for_delivery_date: considerDelivery,
      is_active: !blocked,
    };
    startTransition(async () => {
      const result = editingId
        ? await updateTaActivity(editingId, payload)
        : await createTaActivity(payload);
      if (result.ok) {
        success(editingId ? "Activity updated" : "Activity added");
        closeForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleToggle(a: TaActivity) {
    startTransition(async () => {
      const result = await toggleTaActivity(a.id, !a.is_active);
      if (result.ok) {
        success(a.is_active ? "Blocked" : "Unblocked");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteTaActivity(id);
      if (result.ok) {
        success("Activity removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<TaActivity>[] = [
    {
      header: "Short",
      cell: (a) => <span className="font-mono text-xs font-medium">{a.short_name}</span>,
    },
    { header: "Activity", cell: (a) => <span className="text-sm font-medium">{a.name}</span> },
    {
      header: "Type",
      cell: (a) => (
        <span className="text-sm text-muted-foreground">{a.type?.name ?? "—"}</span>
      ),
    },
    {
      header: "Sub-activities",
      align: "center",
      cell: (a) => (
        <span className="text-xs text-muted-foreground">
          {a.has_sub_activities ? "Yes" : "—"}
        </span>
      ),
    },
    {
      header: "Delivery date",
      align: "center",
      cell: (a) => (
        <span className="text-xs text-muted-foreground">
          {a.consider_for_delivery_date ? "Yes" : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (a) => (
        <StatusPill tone={a.is_active ? "success" : "danger"}>
          {a.is_active ? "Active" : "Blocked"}
        </StatusPill>
      ),
    },
    ...(canEdit || canDelete
      ? [
          rowActionsColumn<TaActivity>((a) => (
            <RowActions
              label={a.name}
              onEdit={() => openEdit(a)}
              canEdit={canEdit}
              onDelete={() => handleDelete(a.id)}
              canDelete={canDelete}
              isPending={isPending}
              /* Block/Unblock is a lifecycle toggle, not row CRUD — it belongs
                 behind the ⋮ rather than competing with Edit (LAYOUT.md §6a). */
              menu={
                canEdit
                  ? [
                      {
                        label: a.is_active ? "Block" : "Unblock",
                        icon: a.is_active ? Ban : CheckCircle2,
                        onClick: () => handleToggle(a),
                      },
                    ]
                  : []
              }
            />
          )),
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="md" onClick={closeForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={openCreate}>New activity</Button>
          )}
        </div>
      )}

      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit TA activity" : "New TA activity"}</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              // ONE MARKER, NEVER A HANDLER. Without it `isEditorScope()` is
              // false, so Tab keeps native order, leaves the form and stops on
              // buttons — one of the ~51 page-level editors AGENTS.md counts as
              // missing this. See the `raagam-keyboard-contract` skill.
              data-focus-scope
              onSubmit={handleSave}
              className="space-y-4"
            >
              {/* `FieldGrid`, not a hand-rolled `lg:grid-cols-3` with
                  `col-span-*` on the tick boxes — a screen composes primitives,
                  it does not draw (LAYOUT.md §3). */}
              <FieldGrid>
                {/* `required` on the Field, not a `<span className="text-danger">*</span>`
                    typed into the label. That drew the same red star and did
                    nothing else: no `RequiredScope`, no `data-required-empty`, so
                    Tab walked straight past a blank box. One prop now draws the
                    star AND holds the cursor. */}
                <Field label="Short name" required size="sm" htmlFor="ta-short">
                  <Input
                    id="ta-short"
                    uppercase
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Name" required size="sm" htmlFor="ta-name">
                  <Input
                    id="ta-name"
                    uppercase
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </Field>
                {/* The picker draws its own label; `Field` carries the span. */}
                <Field size="sm">
                  <LookupDialogPicker
                    kind="ta_activity_type"
                    label="Type"
                    options={types}
                    value={typeId}
                    onChange={setTypeId}
                    canCreate={masterCanCreate}
                    canEdit={masterCanEdit}
                  />
                </Field>

                {/* The three tick boxes take a field slot each rather than
                    `sm:col-span-2 lg:col-span-1`, so they sit on the same track
                    as the fields above instead of a second width. A checkbox IS
                    a field on the arrow axis, so it stays in the typing path. */}
                <Field size="sm">
                  <label className="flex h-9 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border accent-primary"
                      checked={hasSub}
                      onChange={(e) => setHasSub(e.target.checked)}
                    />
                    <span className="text-sm">Has sub-activities</span>
                  </label>
                </Field>
                <Field size="sm">
                  <label className="flex h-9 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border accent-primary"
                      checked={considerDelivery}
                      onChange={(e) => setConsiderDelivery(e.target.checked)}
                    />
                    <span className="text-sm">Consider for delivery date</span>
                  </label>
                </Field>
                <Field size="sm">
                  <label className="flex h-9 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border accent-danger"
                      checked={blocked}
                      onChange={(e) => setBlocked(e.target.checked)}
                    />
                    <span className="text-sm">Blocked</span>
                  </label>
                </Field>
              </FieldGrid>

              <div className="flex items-end gap-2">
                <Button
                  type="submit"
                  disabled={isPending || !shortName.trim() || !name.trim()}
                >
                  {isPending ? "Saving…" : editingId ? "Update activity" : "Add activity"}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search short name, activity or type…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
      />

      <DataTable
        columns={withCreatedColumns(columns, activities)}
        rows={filtered}
        getKey={(a) => a.id}
        empty={activities.length ? "No activities match these filters." : "No T&A activities defined yet."}
      />
    </div>
  );
}
