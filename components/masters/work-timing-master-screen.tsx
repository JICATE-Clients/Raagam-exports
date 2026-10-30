"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Clock, MoonStar, Pencil, Trash2 } from "lucide-react";
import { KIND_LOOK } from "@/components/hr/timing-group-look";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { saveCategoryTiming, deleteCategoryTiming } from "@/lib/masters/category-timing-actions";
import {
  PERSON_KINDS,
  isOvernight,
  shiftMinutes,
  timingOn,
  type CategoryTiming,
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
 * for EACH employee category, from a date (0774). Split into Staff and Worker
 * by the category's For (user 2026-10-30: "whatever category we are creating
 * … should be shown in work timing separately so that we can assign timing").
 * A new category appears here on its own, reading "No timing set".
 *
 * A change of hours is a new dated revision, never an overwrite, so a past day
 * is judged by the hours of that day. The same Effective From again corrects
 * that revision.
 */
// dup-check: exempt -- keyed by (category, effective_from); a later date is a
// revision of the hours, the same date corrects it.
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
  const [editing, setEditing] = useState<EmployeeCategory | null>(null);
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);
  const [form, setForm] = useState<Form>({ in_time: "", out_time: "", grace_minutes: "0", effective_from: today });
  const [doomed, setDoomed] = useState<CategoryTiming | null>(null);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const live = categories.filter((c) => !c.inactive);

  function openEdit(c: EmployeeCategory, e: MouseEvent<HTMLButtonElement>) {
    const now = timingOn(rows, c.id, today);
    setOrigin(e.currentTarget.getBoundingClientRect());
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

  const overnightDraft =
    form.in_time && form.out_time && isOvernight({ in_time: form.in_time, out_time: form.out_time });
  const canSave =
    !isPending && !!form.in_time && !!form.out_time && !!form.effective_from && form.in_time !== form.out_time;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Set Punch In and Punch Out for each employee category. Categories appear under Staff or
        Worker by their For on Employee Category. Punches in between are still recorded and shown on
        Live Punches and the HR dashboard.
      </p>

      {PERSON_KINDS.map(({ value: kind, label }) => {
        const look = KIND_LOOK[kind];
        const Icon = look.icon;
        const cats = live.filter((c) => categoryFitsKind(c.for_type, kind));
        return (
          <section key={kind} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", look.well)}>
                <Icon className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-heading">{label}</h2>
              <span className="text-xs text-muted-foreground">
                {cats.length} {cats.length === 1 ? "category" : "categories"}
              </span>
            </div>

            {cats.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                No {label} categories yet. Add one on Employee Category with For = {label}.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cats.map((c) => {
                  const t = timingOn(rows, c.id, today);
                  const history = rows.filter((r) => r.category_id === c.id).slice().reverse();
                  const upcoming = history.filter((r) => r.effective_from.slice(0, 10) > today);
                  return (
                    <Card key={c.id} className="relative flex min-w-0 flex-col overflow-hidden p-4">
                      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", look.rule)} />
                      <div className="flex items-center gap-3">
                        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-heading">
                          {c.name}
                          {c.is_draft ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(draft)</span> : null}
                        </h3>
                        {(perms.canEdit || perms.canCreate) && (
                          <Button variant="outline" onClick={(e) => openEdit(c, e)}>
                            <Pencil className="h-3.5 w-3.5" />
                            {t ? "Change" : "Set timing"}
                          </Button>
                        )}
                      </div>

                      {t ? (
                        <>
                          <p className="mt-4 flex items-baseline gap-2 text-2xl font-semibold tabular-nums tracking-tight text-heading">
                            {fmtTime(t.in_time)}
                            <span className="text-base font-normal text-muted-foreground">→</span>
                            {fmtTime(t.out_time)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {hours(shiftMinutes(t))} day
                            </span>
                            <span>In grace {t.grace_minutes} min</span>
                            {isOvernight(t) && (
                              <span className="inline-flex items-center gap-1 text-warning">
                                <MoonStar className="h-3.5 w-3.5" />
                                Out next morning
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">From {fmtDate(t.effective_from)}</p>
                        </>
                      ) : (
                        <p className="mt-4 text-sm text-muted-foreground">
                          No timing set yet — nobody in this category is marked late or early.
                        </p>
                      )}

                      {history.length > 0 && (
                        <div className="mt-4 border-t border-border pt-3">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            History{upcoming.length ? ` · ${upcoming.length} upcoming` : ""}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {history.map((r) => (
                              <li key={r.id} className="flex items-center gap-2 text-xs">
                                <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                                  {fmtDate(r.effective_from)}
                                </span>
                                <span className={cn("flex-1 tabular-nums", r.id === t?.id && "font-semibold")}>
                                  {fmtTime(r.in_time)} – {fmtTime(r.out_time)} · {r.grace_minutes}m
                                  {r.id === t?.id ? " · now" : r.effective_from.slice(0, 10) > today ? " · upcoming" : ""}
                                </span>
                                {perms.canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => setDoomed(r)}
                                    className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-danger"
                                    aria-label={`Remove the ${fmtDate(r.effective_from)} timing`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`${editing?.name ?? ""} Timing`}
        size="sm"
        alignToPane
        origin={origin}
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
            <Field label="In grace (min)" w="num" htmlFor="ct-grace">
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
                : `Grace applies to Punch In only: late after Punch In + grace. Leaving before Punch Out is early — no grace.`}
          </p>
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
