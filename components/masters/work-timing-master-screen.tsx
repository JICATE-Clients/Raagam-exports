"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoonStar, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { ToggleGroup } from "@/components/ui/segmented";
import { RowIconAction } from "@/components/ui/row-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { saveCategoryTiming, deleteCategoryTiming } from "@/lib/masters/category-timing-actions";
import {
  PERSON_KINDS,
  isOvernight,
  nextTiming,
  shiftMinutes,
  timingOn,
  type CategoryTiming,
  type PersonKind,
} from "@/lib/masters/category-timing-types";
import { categoryFitsKind, type EmployeeCategory } from "@/lib/masters/employee-category-types";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Form = { in_time: string; out_time: string; grace_minutes: string; effective_from: string };

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}

/**
 * Master Data ▸ HR ▸ Work Timing — Punch In, Punch Out and a grace allowance
 * for EACH employee category, from a date (0774). Staff | Worker switch over
 * one plain table, a row per category (user 2026-10-30: "whatever category we
 * are creating … should be shown in work timing separately", then "can we
 * make more simpler" — the first cut was a grid of cards). A new category
 * appears here on its own, reading "Not set".
 *
 * A change of hours is a new dated revision, never an overwrite, so a past day
 * is judged by the hours of that day. The same Effective From again corrects
 * that revision; the revisions are listed in the edit panel.
 */
// dup-check: exempt -- keyed by (category, effective_from); a later date is a
// revision of the hours, the same date corrects it.
// created-by: exempt -- a row per category's CURRENT hours, not a record listing.
export function WorkTimingMasterScreen({
  rows,
  categories,
  today,
  perms,
}: {
  rows: CategoryTiming[];
  categories: EmployeeCategory[];
  /** Today in IST, YYYY-MM-DD — resolved on the server, never `Date.now()` in a render. */
  today: string;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<PersonKind>("staff");
  const [editing, setEditing] = useState<EmployeeCategory | null>(null);
  const [form, setForm] = useState<Form>({ in_time: "", out_time: "", grace_minutes: "0", effective_from: today });
  const [doomed, setDoomed] = useState<CategoryTiming | null>(null);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const live = categories.filter((c) => !c.inactive);
  const shown = live.filter((c) => categoryFitsKind(c.for_type, kind));
  const canWrite = perms.canEdit || perms.canCreate;

  function openEdit(c: EmployeeCategory) {
    const now = timingOn(rows, c.id, today);
    setForm({
      in_time: now?.in_time.slice(0, 5) ?? "",
      out_time: now?.out_time.slice(0, 5) ?? "",
      grace_minutes: String(now?.grace_minutes ?? 0),
      // A new revision starts today; the operator moves it to a later date
      // to schedule a change, or back to correct one already in force.
      effective_from: today,
    });
    setEditing(c);
  }

  function save() {
    if (!editing) return;
    const categoryId = editing.id;
    startTransition(async () => {
      const res = await saveCategoryTiming({
        category_id: categoryId,
        in_time: form.in_time,
        out_time: form.out_time,
        grace_minutes: Number(form.grace_minutes || 0),
        effective_from: form.effective_from,
      });
      if (res.ok) {
        success("Timing saved.");
        setEditing(null);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove() {
    if (!doomed) return;
    const id = doomed.id;
    startTransition(async () => {
      const res = await deleteCategoryTiming(id);
      setDoomed(null);
      if (res.ok) {
        success("Timing revision removed.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<EmployeeCategory>[] = [
    {
      header: "Category",
      cell: (c) => (
        <span className="font-medium">
          {c.name}
          {c.is_draft ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(draft)</span> : null}
        </span>
      ),
    },
    {
      header: "Punch In",
      cell: (c) => {
        const t = timingOn(rows, c.id, today);
        return t ? <span className="tabular-nums">{fmtTime(t.in_time)}</span> : <span className="text-muted-foreground">Not set</span>;
      },
    },
    {
      header: "Punch Out",
      cell: (c) => {
        const t = timingOn(rows, c.id, today);
        if (!t) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="inline-flex items-center gap-1 tabular-nums">
            {fmtTime(t.out_time)}
            {isOvernight(t) && <MoonStar className="h-3.5 w-3.5 text-warning" aria-label="next morning" />}
          </span>
        );
      },
    },
    {
      header: "Hours",
      cell: (c) => {
        const t = timingOn(rows, c.id, today);
        return t ? <span className="tabular-nums">{hours(shiftMinutes(t))}</span> : "—";
      },
    },
    {
      header: "Grace",
      align: "right",
      cell: (c) => {
        const t = timingOn(rows, c.id, today);
        return t ? <span className="tabular-nums">{t.grace_minutes} min</span> : "—";
      },
    },
    {
      header: "From",
      cell: (c) => {
        const t = timingOn(rows, c.id, today);
        const next = nextTiming(rows, c.id, today);
        return (
          <span className="tabular-nums">
            {t ? fmtDate(t.effective_from) : "—"}
            {next && (
              <span className="block text-xs text-muted-foreground">
                Changes {fmtDate(next.effective_from)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      header: "",
      align: "right",
      cell: (c) =>
        canWrite ? <RowIconAction label="Set timing" name={c.name} icon={Pencil} onClick={() => openEdit(c)} /> : null,
    },
  ];

  const history = editing ? rows.filter((r) => r.category_id === editing.id).slice().reverse() : [];
  const current = editing ? timingOn(rows, editing.id, today) : null;
  const overnightDraft =
    form.in_time && form.out_time && isOvernight({ in_time: form.in_time, out_time: form.out_time });
  const canSave =
    !isPending && !!form.in_time && !!form.out_time && !!form.effective_from && form.in_time !== form.out_time;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          label="Staff or Worker"
          role="tablist"
          value={kind}
          onChange={setKind}
          options={PERSON_KINDS.map((k) => ({
            value: k.value,
            label: `${k.label} (${live.filter((c) => categoryFitsKind(c.for_type, k.value)).length})`,
          }))}
        />
        <p className="text-xs text-muted-foreground">Categories come from Employee Category, by their For.</p>
      </div>

      <DataTable
        columns={columns}
        rows={shown}
        getKey={(c) => c.id}
        empty={`No ${kind === "staff" ? "Staff" : "Worker"} categories yet. Add one on Employee Category.`}
      />

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`${editing?.name ?? ""} — Timing`}
        size="sm"
        alignToPane
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FieldRow>
            <Field label="Punch In" w="code" required htmlFor="ct-in">
              <Input id="ct-in" type="time" required value={form.in_time} onChange={(e) => set({ in_time: e.target.value })} />
            </Field>
            <Field label="Punch Out" w="code" required htmlFor="ct-out">
              <Input id="ct-out" type="time" required value={form.out_time} onChange={(e) => set({ out_time: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Grace (min)" w="num" htmlFor="ct-grace">
              <Input
                id="ct-grace"
                type="number"
                min={0}
                max={180}
                value={form.grace_minutes}
                onChange={(e) => set({ grace_minutes: e.target.value })}
              />
            </Field>
            <Field label="Effective From" w="code" required htmlFor="ct-from">
              <Input
                id="ct-from"
                type="date"
                required
                value={form.effective_from}
                onChange={(e) => set({ effective_from: e.target.value })}
              />
            </Field>
          </FieldRow>
          <p className="text-xs text-muted-foreground">
            {form.in_time && form.out_time && form.in_time === form.out_time
              ? "Punch Out can't be the same as Punch In."
              : overnightDraft
                ? "Punch Out is earlier than Punch In, so it is read as the next morning (night shift)."
                : "Late after Punch In + grace. Leaving before Punch Out is early (no grace)."}
          </p>

          {history.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Changes</p>
              <ul className="mt-1.5 space-y-1">
                {history.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{fmtDate(r.effective_from)}</span>
                    <span className={cn("flex-1 tabular-nums", r.id === current?.id && "font-semibold")}>
                      {fmtTime(r.in_time)} – {fmtTime(r.out_time)} · {r.grace_minutes}m
                      {r.id === current?.id ? " · now" : r.effective_from.slice(0, 10) > today ? " · upcoming" : ""}
                    </span>
                    {perms.canDelete && (
                      <RowIconAction label="Remove" name={fmtDate(r.effective_from)} icon={Trash2} danger onClick={() => setDoomed(r)} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={doomed !== null}
        title={`Remove the ${doomed ? fmtDate(doomed.effective_from) : ""} timing?`}
        body="Days from that date will be judged by the revision before it."
        confirmLabel="Remove"
        isPending={isPending}
        onConfirm={remove}
        onCancel={() => setDoomed(null)}
      />
    </div>
  );
}
