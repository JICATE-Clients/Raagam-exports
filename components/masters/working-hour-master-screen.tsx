"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createWorkingHour,
  updateWorkingHour,
  deleteWorkingHour,
} from "@/lib/masters/working-hour-actions";
import type { WorkingHour, WorkingHourInput } from "@/lib/masters/working-hour-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

function today() {
  return new Date().toISOString().slice(0, 10);
}
/** Postgres `time` comes back as HH:MM:SS; the <input type="time"> wants HH:MM. */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

// The ten time slots, in legacy layout order (paired left/right).
const SLOTS = [
  ["morning_in", "Morning In", "evening_out", "Evening Out"],
  ["morning_break_from", "Morning Break From", "morning_break_to", "Morning Break To"],
  ["lunch_break_from", "Lunch Break From", "lunch_break_to", "Lunch Break To"],
  ["evening_break_from", "Evening Break From", "evening_break_to", "Evening Break To"],
  ["ot_in", "OT In", "ot_out", "OT Out"],
] as const;

type TimeKey =
  | "morning_in"
  | "morning_break_from"
  | "morning_break_to"
  | "lunch_break_from"
  | "lunch_break_to"
  | "evening_break_from"
  | "evening_break_to"
  | "evening_out"
  | "ot_in"
  | "ot_out";

type HeaderForm = { date: string } & Record<TimeKey, string>;
const BLANK_TIMES: Record<TimeKey, string> = {
  morning_in: "",
  morning_break_from: "",
  morning_break_to: "",
  lunch_break_from: "",
  lunch_break_to: "",
  evening_break_from: "",
  evening_break_to: "",
  evening_out: "",
  ot_in: "",
  ot_out: "",
};

/**
 * Legacy HR "Working Hour" master. Flat form: Entry No (auto) · Date + ten daily
 * time slots (Morning / Lunch / Evening breaks, Evening Out, OT In/Out). Save /
 * Save-As-Drafts (draft persists with `is_draft = true`).
 */
export function WorkingHourMasterScreen({ rows, perms }: { rows: WorkingHour[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNo, setEditNo] = useState<number | null>(null);
  const [form, setForm] = useState<HeaderForm>({ date: today(), ...BLANK_TIMES });

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [String(r.entry_no), r.date].join(" ").toLowerCase().includes(q));
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditNo(null);
    setForm({ date: today(), ...BLANK_TIMES });
    setOpen(true);
  }
  function openEdit(r: WorkingHour) {
    setEditId(r.id);
    setEditNo(r.entry_no);
    setForm({
      date: r.date?.slice(0, 10) || today(),
      morning_in: hhmm(r.morning_in),
      morning_break_from: hhmm(r.morning_break_from),
      morning_break_to: hhmm(r.morning_break_to),
      lunch_break_from: hhmm(r.lunch_break_from),
      lunch_break_to: hhmm(r.lunch_break_to),
      evening_break_from: hhmm(r.evening_break_from),
      evening_break_to: hhmm(r.evening_break_to),
      evening_out: hhmm(r.evening_out),
      ot_in: hhmm(r.ot_in),
      ot_out: hhmm(r.ot_out),
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const t = (k: TimeKey) => (form[k].trim() === "" ? null : form[k]);
      const payload: WorkingHourInput = {
        date: form.date,
        morning_in: t("morning_in"),
        morning_break_from: t("morning_break_from"),
        morning_break_to: t("morning_break_to"),
        lunch_break_from: t("lunch_break_from"),
        lunch_break_to: t("lunch_break_to"),
        evening_break_from: t("evening_break_from"),
        evening_break_to: t("evening_break_to"),
        evening_out: t("evening_out"),
        ot_in: t("ot_in"),
        ot_out: t("ot_out"),
        is_draft: asDraft,
      };
      const res = editId ? await updateWorkingHour(editId, payload) : await createWorkingHour(payload);
      if (res.ok) {
        success(editId ? "Working hour updated." : asDraft ? "Saved as draft." : "Working hour added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: WorkingHour) {
    startTransition(async () => {
      const res = await deleteWorkingHour(r.id);
      if (res.ok) {
        success("Working hour deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<WorkingHour>[] = [
    { header: "Entry No", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{r.date?.slice(0, 10)}</span> },
    {
      header: "Morning In",
      cell: (r) => <span className="text-sm text-muted-foreground">{hhmm(r.morning_in) || "—"}</span>,
    },
    {
      header: "Evening Out",
      cell: (r) => <span className="text-sm text-muted-foreground">{hhmm(r.evening_out) || "—"}</span>,
    },
    {
      header: "Status",
      cell: (r) =>
        r.is_draft ? <StatusPill tone="warning">Draft</StatusPill> : <StatusPill tone="success">Active</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by entry no or date…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Working Hour
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No working hours yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No working hours yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">#{r.entry_no}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.date?.slice(0, 10)}
                    {hhmm(r.morning_in) ? ` · In ${hhmm(r.morning_in)}` : ""}
                    {hhmm(r.evening_out) ? ` · Out ${hhmm(r.evening_out)}` : ""}
                  </div>
                </div>
                {r.is_draft ? (
                  <StatusPill tone="warning">Draft</StatusPill>
                ) : (
                  <StatusPill tone="success">Active</StatusPill>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Working Hour #${editNo}` : "New Working Hour"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" size="md" disabled={isPending || !form.date} onClick={() => submit(true)}>
              Save as Draft
            </Button>
            <Button size="md" disabled={isPending || !form.date} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Entry No</Label>
              <Input value={editNo != null ? `#${editNo}` : "(auto)"} readOnly disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="wh-date">Date</Label>
              <Input
                id="wh-date"
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>

          {SLOTS.map(([kA, lA, kB, lB]) => (
            <div key={kA} className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`wh-${kA}`}>{lA}</Label>
                <Input
                  id={`wh-${kA}`}
                  type="time"
                  value={form[kA]}
                  onChange={(e) => set({ [kA]: e.target.value } as Partial<HeaderForm>)}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor={`wh-${kB}`}>{lB}</Label>
                <Input
                  id={`wh-${kB}`}
                  type="time"
                  value={form[kB]}
                  onChange={(e) => set({ [kB]: e.target.value } as Partial<HeaderForm>)}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
