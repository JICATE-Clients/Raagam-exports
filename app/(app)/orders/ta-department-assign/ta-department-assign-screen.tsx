"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { fmtDate } from "@/lib/format";
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

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
interface Props {
  rows: TaDepartmentAssign[];
  data: TaDeptAssignFormData;
  perms: Perms;
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type LineRow = { key: string; activity_id: string | null; is_owner: boolean };

const today = () => new Date().toISOString().slice(0, 10);

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
    if (!confirm(`Delete assignment ${r.code ?? ""}?`)) return;
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
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {perms.canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>Edit</Button>
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
          title="TA Department Assign"
          description="Assign Time & Action activities to a department at a location, flagging the owner."
          actions={perms.canCreate ? <Button onClick={openAdd}>New Assignment</Button> : undefined}
        />
        <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No assignments yet." />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? "Edit Assignment" : "New Assignment"}
        description="Pick a Location & Department, then assign activities. Blank rows are ignored."
        actions={
          <Button variant="outline" size="sm" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Entry No</Label>
            <Input value={editId ? (rows.find((r) => r.id === editId)?.code ?? "") : "(auto)"} disabled />
          </div>
          <div>
            <Label htmlFor="tda-date">Entered Dt *</Label>
            <Input
              id="tda-date"
              type="date"
              value={enteredDate}
              onChange={(e) => setEnteredDate(e.target.value)}
            />
          </div>
          <LocationPicker locations={data.locations} value={locationId} onChange={setLocationId} />
          <LookupDialogPicker
            kind="department"
            label="Department"
            options={data.departments}
            value={departmentId}
            onChange={setDepartmentId}
            canCreate={masterPerms.canCreate}
            canEdit={masterPerms.canEdit}
          />
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Activities</h3>
            <Button
              type="button"
              variant="subtle"
              size="sm"
              onClick={() =>
                setLines((xs) => [...xs, { key: newKey(), activity_id: null, is_owner: false }])
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add row
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="w-12 px-3 py-1.5 text-left font-medium">S No</th>
                  <th className="px-3 py-1.5 text-left font-medium">Activity</th>
                  <th className="w-24 px-3 py-1.5 text-center font-medium">Owner</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((r, i) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-3 py-1 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1">
                      <RecordPicker
                        label="Activity"
                        items={data.activities}
                        value={r.activity_id}
                        onChange={(id) =>
                          setLines((xs) =>
                            xs.map((x) => (x.key === r.key ? { ...x, activity_id: id } : x)),
                          )
                        }
                        compact
                      />
                    </td>
                    <td className="px-3 py-1 text-center">
                      <input
                        type="checkbox"
                        aria-label="Owner"
                        className="h-4 w-4 rounded border-border accent-primary"
                        checked={r.is_owner}
                        onChange={(e) =>
                          setLines((xs) =>
                            xs.map((x) => (x.key === r.key ? { ...x, is_owner: e.target.checked } : x)),
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => setLines((xs) => xs.filter((x) => x.key !== r.key))}
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

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>Cancel</Button>
        <Button disabled={isPending || !enteredDate} onClick={submit}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
