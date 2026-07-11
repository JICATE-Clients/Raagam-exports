"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
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
    if (!confirm(`Delete TA style ${r.code ?? ""}?`)) return;
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
          <span className="block max-w-[18rem] truncate text-sm" title={r.description ?? undefined}>
            {r.description ?? "—"}
          </span>
        ),
      },
      { header: "Lead", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.lead_days}</span> },
      { header: "Start", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.start_days}</span> },
      { header: "No of Days", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.no_of_days}</span> },
      {
        header: "Status",
        cell: (r) => <StatusPill tone={taStyleStatusTone(r)}>{taStyleStatusLabel(r)}</StatusPill>,
      },
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {perms.canEdit && (
              <Button variant="outline" size="sm" onClick={() => loadForm(r)}>Edit</Button>
            )}
            {perms.canDelete && (
              <Button variant="outline" size="sm" onClick={() => del(r)}>Delete</Button>
            )}
          </div>
        ),
      },
    ];
    return (
      <div className="space-y-4">
        <PageHeader
          title="TA Style"
          description="Reusable Time & Action templates — activities, predecessors and day offsets."
          actions={perms.canCreate ? <Button onClick={openAdd}>New TA Style</Button> : undefined}
        />
        <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No TA styles yet." />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? "Edit TA Style" : "New TA Style"}
        description="Pick activities from the TA Activity catalogue and set day offsets."
        actions={
          <div className="flex gap-2">
            {editId && (
              <Button variant="outline" size="sm" onClick={() => loadForm(rows.find((r) => r.id === editId) ?? null, { asCopy: true })}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setMode("list")}>
              ← Back to list
            </Button>
          </div>
        }
      />

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Style Ref No</Label>
            <Input value={editCode ?? "(auto)"} disabled />
          </div>
          <RecordPicker label="Customer" items={customerItems} value={customerId} onChange={setCustomerId} />
          <div>
            <Label htmlFor="tas-desc">Description *</Label>
            <Input id="tas-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tas-lead">Lead Days</Label>
            <Input id="tas-lead" type="number" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tas-start">Start Days</Label>
            <Input id="tas-start" type="number" value={startDays} onChange={(e) => setStartDays(e.target.value)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Activity</h3>
            <Button
              type="button"
              variant="subtle"
              size="sm"
              onClick={() => setActivities((xs) => [...xs, blankRow()])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add row
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="w-12 px-3 py-1.5 text-left font-medium">S No</th>
                  <th className="px-3 py-1.5 text-left font-medium">Activity</th>
                  <th className="px-3 py-1.5 text-left font-medium">From Activity</th>
                  <th className="w-32 px-3 py-1.5 text-right font-medium">Days Required</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {activities.map((r, i) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-3 py-1 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1">
                      <RecordPicker
                        label="Activity"
                        items={activityItems}
                        value={r.activity_id}
                        onChange={(id) =>
                          setActivities((xs) => xs.map((x) => (x.key === r.key ? { ...x, activity_id: id } : x)))
                        }
                        compact
                      />
                    </td>
                    <td className="px-3 py-1">
                      <RecordPicker
                        label="From Activity"
                        items={activityItems}
                        value={r.from_activity_id}
                        onChange={(id) =>
                          setActivities((xs) => xs.map((x) => (x.key === r.key ? { ...x, from_activity_id: id } : x)))
                        }
                        compact
                      />
                    </td>
                    <td className="px-3 py-1">
                      <Input
                        type="number"
                        className="text-right"
                        value={r.days_required}
                        onChange={(e) =>
                          setActivities((xs) => xs.map((x) => (x.key === r.key ? { ...x, days_required: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => setActivities((xs) => xs.filter((x) => x.key !== r.key))}
                        aria-label="Remove row"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
