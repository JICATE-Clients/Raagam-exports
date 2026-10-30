"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Clock, MoonStar, Pencil, Trash2 } from "lucide-react";
import { GROUP_LOOK } from "@/components/hr/timing-group-look";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { saveGroupTiming, deleteGroupTiming } from "@/lib/masters/group-timing-actions";
import {
  TIMING_GROUPS,
  isOvernight,
  shiftMinutes,
  timingsOn,
  type GroupTiming,
  type TimingGroup,
} from "@/lib/masters/group-timing-types";
import type { EmployeeCategory } from "@/lib/masters/employee-category-types";
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
 * Master Data ▸ HR ▸ Work Timing — the client's three fixed timing groups
 * (Staff · Security · Production Staff, 2026-10-28) and the ONLY thing each one
 * fixes: Punch In, Punch Out and a grace allowance, from a date.
 *
 * Replaces the legacy shift-category / no-of-shifts form, which the client
 * found "complicated" for a rule that is two times. Punches between In and Out
 * are still recorded and shown (Live Punches, HR dashboard); they are just not
 * held to a time.
 *
 * A change of hours is a new dated revision, never an overwrite, so a past day
 * is judged by the hours of that day. The same Effective From again corrects
 * that revision.
 */
// dup-check: exempt -- three fixed groups, keyed by (group, effective_from); a
// later date is a revision of the hours, the same date corrects it.
export function WorkTimingMasterScreen({
  rows,
  categories,
  today,
  perms,
}: {
  rows: GroupTiming[];
  categories: EmployeeCategory[];
  /** Today in IST, YYYY-MM-DD — resolved on the server, never `Date.now()` in a render. */
  today: string;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [group, setGroup] = useState<TimingGroup | null>(null);
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);
  const [form, setForm] = useState<Form>({ in_time: "", out_time: "", grace_minutes: "0", effective_from: today });
  const [doomed, setDoomed] = useState<GroupTiming | null>(null);

  const current = timingsOn(rows, today);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  function openEdit(g: TimingGroup, e: MouseEvent<HTMLButtonElement>) {
    const now = current[g];
    setOrigin(e.currentTarget.getBoundingClientRect());
    setForm({
      in_time: now?.in_time.slice(0, 5) ?? "",
      out_time: now?.out_time.slice(0, 5) ?? "",
      grace_minutes: String(now?.grace_minutes ?? 0),
      // A new revision starts today; the operator moves it to a later date
      // to schedule a change, or back to correct one already in force.
      effective_from: today,
    });
    setGroup(g);
  }

  function save() {
    if (!group) return;
    startTransition(async () => {
      const res = await saveGroupTiming({
        timing_group: group,
        in_time: form.in_time,
        out_time: form.out_time,
        grace_minutes: Number(form.grace_minutes || 0),
        effective_from: form.effective_from,
      });
      if (res.ok) {
        success("Timing saved.");
        setGroup(null);
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
      const res = await deleteGroupTiming(id);
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Fix Punch In and Punch Out for each group. Every employee category belongs to one group
        (set it on Employee Category). Punches in between are still recorded and shown on Live
        Punches and the HR dashboard.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {TIMING_GROUPS.map(({ value: g, label }) => {
          const t = current[g];
          const look = GROUP_LOOK[g];
          const Icon = look.icon;
          const cats = categories.filter((c) => c.timing_group === g && !c.inactive);
          const history = rows.filter((r) => r.timing_group === g).slice().reverse();
          const upcoming = history.filter((r) => r.effective_from.slice(0, 10) > today);
          return (
            <Card key={g} className="relative flex min-w-0 flex-col overflow-hidden p-4">
              <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", look.rule)} />
              <div className="flex items-center gap-3">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", look.well)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <h3 className="flex-1 text-sm font-semibold text-heading">{label}</h3>
                {(perms.canEdit || perms.canCreate) && (
                  <Button variant="outline" onClick={(e) => openEdit(g, e)}>
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
                  No timing set yet — nobody in this group is marked late or early.
                </p>
              )}

              <div className="mt-4 border-t border-border pt-3">
                <p className="text-[11px] font-medium text-muted-foreground">Employee categories</p>
                {cats.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {cats.map((c) => (
                      <span key={c.id} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs">
                        {c.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">None linked yet.</p>
                )}
              </div>

              {history.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
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

      <Sheet
        open={group !== null}
        onClose={() => setGroup(null)}
        title={`${TIMING_GROUPS.find((x) => x.value === group)?.label ?? ""} Timing`}
        size="sm"
        alignToPane
        origin={origin}
        footer={
          <>
            <Button variant="outline" onClick={() => setGroup(null)}>
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
            <Field label="Punch In" w="code" required htmlFor="gt-in">
              <Input id="gt-in" type="time" required value={form.in_time} onChange={(e) => set({ in_time: e.target.value })} />
            </Field>
            <Field label="Punch Out" w="code" required htmlFor="gt-out">
              <Input id="gt-out" type="time" required value={form.out_time} onChange={(e) => set({ out_time: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="In grace (min)" w="num" htmlFor="gt-grace">
              <Input
                id="gt-grace"
                type="number"
                min={0}
                max={180}
                value={form.grace_minutes}
                onChange={(e) => set({ grace_minutes: e.target.value })}
              />
            </Field>
            <Field label="Effective From" w="code" required htmlFor="gt-from">
              <Input
                id="gt-from"
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
