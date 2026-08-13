"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { Truncated } from "@/components/ui/truncated";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { RecordPicker } from "@/components/masters/record-picker";
import {
  createTaStyle,
  updateTaStyle,
  deleteTaStyle,
} from "@/lib/orders/ta-styles/actions";
import {
  taStyleStatusTone,
  taStyleStatusLabel,
  type TaStyle,
} from "@/lib/orders/ta-styles/types";
import type { TaStyleFormData, PickerRow } from "@/lib/orders/ta-styles/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
interface Props {
  rows: TaStyle[];
  data: TaStyleFormData;
  perms: Perms;
}

type ActivityRow = {
  key: string;
  activity_id: string | null;
  from_activity_id: string | null;
  days_required: string;
};

export function TaStyleScreen({ rows, data, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [leadDays, setLeadDays] = useState("0");
  const [startDays, setStartDays] = useState("0");
  const [blocked, setBlocked] = useState(false);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // Inline editor, not a Sheet / MasterFullScreen — see mba-master-screen.tsx.
  useUnsavedGuard(mode === "edit" || isPending);

  const activityItems: PickerRow[] = data.activities;
  const customerItems: PickerRow[] = data.customers;

  // Live-computed footer (provisional formula, mirrors the server).
  const noOfDays = useMemo(
    () => activities.reduce((sum, a) => sum + (Number(a.days_required) || 0), 0),
    [activities],
  );
  const targetDays = (Number(leadDays) || 0) + (Number(startDays) || 0) + noOfDays;

  function blankRow(): ActivityRow {
    return { key: newKey(), activity_id: null, from_activity_id: null, days_required: "0" };
  }

  function loadForm(r: TaStyle | null, opts: { asCopy?: boolean } = {}) {
    setEditId(opts.asCopy ? null : r?.id ?? null);
    setEditCode(opts.asCopy ? null : r?.code ?? null);
    setCustomerId(r?.customer_id ?? null);
    setDescription(r ? r.description ?? "" : "");
    setLeadDays(r ? String(r.lead_days) : "0");
    setStartDays(r ? String(r.start_days) : "0");
    setBlocked(r?.blocked ?? false);
    setActivities(
      r && r.activities.length
        ? r.activities.map((a) => ({
            key: newKey(),
            activity_id: a.activity_id,
            from_activity_id: a.from_activity_id,
            days_required: String(a.days_required),
          }))
        : [blankRow()],
    );
    setMode("edit");
  }

  function openAdd() {
    loadForm(null);
  }
  useCreateIntent(openAdd);

  function submit(asDraft: boolean) {
    const payload = {
      is_draft: asDraft,
      blocked,
      customer_id: customerId,
      description,
      lead_days: Number(leadDays) || 0,
      start_days: Number(startDays) || 0,
      activities: activities.map((a) => ({
        activity_id: a.activity_id,
        from_activity_id: a.from_activity_id,
        days_required: Number(a.days_required) || 0,
      })),
    };
    start(async () => {
      const res = editId
        ? await updateTaStyle(editId, payload)
        : await createTaStyle(payload);
      if (res.ok) {
        success(editId ? "TA style updated" : "TA style created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: TaStyle) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteTaStyle(r.id);
      if (res.ok) {
        success("TA style deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST ----------------
  if (mode === "list") {
    const columns: Column<TaStyle>[] = [
      {
        header: "Style Ref No",
        cell: (r) => (
          <button
            type="button"
            onClick={() => perms.canEdit && loadForm(r)}
            className="font-mono text-xs font-medium text-primary hover:underline"
          >
            {r.code ?? "—"}
          </button>
        ),
      },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
      {
        header: "Description",
        cell: (r) => (
          // `truncate` + a `title` is an ellipsis with a tooltip the keyboard and
          // touch can never reach. <Truncated> writes the clamp itself, measures
          // the box, and reveals on hover OR press-and-hold — and only when
          // something is actually hidden (AGENTS.md, "Truncated values").
          <Truncated text={r.description ?? "—"} className="block max-w-[18rem] text-sm" />
        ),
      },
      { header: "Lead", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.lead_days}</span> },
      { header: "Start", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.start_days}</span> },
      { header: "No of Days", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.no_of_days}</span> },
      {
        header: "Status",
        cell: (r) => <StatusPill tone={taStyleStatusTone(r)}>{taStyleStatusLabel(r)}</StatusPill>,
      },
      rowActionsColumn((r) => (
        <RowActions
          label={r.code}
          onEdit={() => loadForm(r)}
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
          title="TA Style"
          description="Reusable Time & Action templates — activities, predecessors and day offsets."
          actions={perms.canCreate ? <Button onClick={openAdd}>New TA Style</Button> : undefined}
        />
        <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No TA styles yet." />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  const activityColumns: ChildGridColumn<ActivityRow>[] = [
    {
      header: "Activity",
      cell: (r) => (
        <RecordPicker
          label="Activity"
          items={activityItems}
          value={r.activity_id}
          onChange={(id) =>
            setActivities((xs) => xs.map((x) => (x.key === r.key ? { ...x, activity_id: id } : x)))
          }
          compact
        />
      ),
    },
    {
      header: "From Activity",
      cell: (r) => (
        <RecordPicker
          label="From Activity"
          items={activityItems}
          value={r.from_activity_id}
          onChange={(id) =>
            setActivities((xs) => xs.map((x) => (x.key === r.key ? { ...x, from_activity_id: id } : x)))
          }
          compact
        />
      ),
    },
    {
      header: "Days Required",
      align: "right",
      className: "min-w-[8rem]",
      cell: (r) => (
        <Input
          type="number"
          className="h-8 text-right"
          value={r.days_required}
          onChange={(e) =>
            setActivities((xs) => xs.map((x) => (x.key === r.key ? { ...x, days_required: e.target.value } : x)))
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
        title={editId ? "Edit TA Style" : "New TA Style"}
        description="Pick activities from the TA Activity catalogue and set day offsets."
        actions={
          <div className="flex gap-2">
            {editId && (
              <Button variant="outline" size="md" onClick={() => loadForm(rows.find((r) => r.id === editId) ?? null, { asCopy: true })}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
            )}
            <Button variant="outline" size="md" onClick={() => setMode("list")}>
              ← Back to list
            </Button>
          </div>
        }
      />

      {/* `FieldGrid`, not a hand-rolled `lg:grid-cols-3` — a screen composes
          primitives, it does not draw (LAYOUT.md §3). */}
      <Card>
        <CardBody>
          <FieldGrid>
            <Field label="Style Ref No" size="sm" htmlFor="tas-ref">
              <Input id="tas-ref" className="font-mono" value={editCode ?? "(auto)"} readOnly />
            </Field>
            {/* The picker draws its own label; `Field` carries the span. */}
            <Field size="sm">
              <RecordPicker label="Customer" items={customerItems} value={customerId} onChange={setCustomerId} />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the same
                prop draws the star AND stamps `data-required-empty`, so the
                cursor holds on a blank box. Typed by hand it was decoration and
                Tab walked straight past. */}
            <Field label="Description" required size="sm" htmlFor="tas-desc">
              <Input id="tas-desc" uppercase value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Lead Days" size="sm" htmlFor="tas-lead">
              <Input id="tas-lead" type="number" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} />
            </Field>
            <Field label="Start Days" size="sm" htmlFor="tas-start">
              <Input id="tas-start" type="number" value={startDays} onChange={(e) => setStartDays(e.target.value)} />
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      {/* `ChildGrid`, not the hand-rolled <table> this carried — that one drew
          its own S No cell and its own Trash2 button, so it inherited neither
          Ctrl+Del nor `data-row-remove`. Three columns, so it keeps the table
          layout rather than wrapping. */}
      <Card>
        <CardBody>
          <ChildGrid<ActivityRow>
            label="Activity"
            columns={activityColumns}
            rows={activities}
            seedRow
            onAdd={() => setActivities((xs) => [...xs, blankRow()])}
            onRemove={(r) => setActivities((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add activity"
          />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={blocked}
              onChange={(e) => setBlocked(e.target.checked)}
            />
            Blocked
          </label>
          <div className="flex-1" />
          <div className="text-sm">
            <span className="text-muted-foreground">Target Days: </span>
            <span className="tabular-nums font-semibold">{targetDays}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">No of Days: </span>
            <span className="tabular-nums font-semibold">{noOfDays}</span>
          </div>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>Cancel</Button>
        <Button variant="outline" disabled={isPending || !description.trim()} onClick={() => submit(true)}>
          Save as Draft
        </Button>
        <Button disabled={isPending || !description.trim()} onClick={() => submit(false)}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
