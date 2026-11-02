"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Clock, Coffee, History, LogIn, LogOut, MoonStar, Pencil, Trash2, UtensilsCrossed } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/segmented";
import { RowIconAction } from "@/components/ui/row-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { MasterFullScreen } from "@/components/masters/master-full-screen";
import { saveCategoryTiming, deleteCategoryTiming } from "@/lib/masters/category-timing-actions";
import {
  BREAKS,
  PERSON_KINDS,
  breakMinutes,
  breakProblem,
  isOvernight,
  nextTiming,
  shiftMinutes,
  timeToMinutes,
  timingOn,
  type BreakField,
  type CategoryTiming,
  type PersonKind,
} from "@/lib/masters/category-timing-types";
import { categoryFitsKind, type EmployeeCategory } from "@/lib/masters/employee-category-types";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Form = { in_time: string; out_time: string; grace_minutes: string; effective_from: string } & Record<BreakField, string>;

const BLANK_BREAKS = Object.fromEntries(BREAKS.flatMap((b) => [[b.start, ""], [b.end, ""]])) as Record<BreakField, string>;

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}

const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** "10:30 – 10:45", or a dash for a break the category doesn't have. */
function BreakCell({ t, b }: { t: CategoryTiming | null; b: (typeof BREAKS)[number] }) {
  const s = t?.[b.start];
  const e = t?.[b.end];
  if (!s || !e) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {fmtTime(s)} – {fmtTime(e)}
    </span>
  );
}

/*
 * The day drawn to scale, Punch In on the left and Punch Out on the right,
 * each break a shaded block where it falls — so a lunch typed at the wrong
 * hour is visibly in the wrong place before Save is pressed.
 */
function DayStrip({ form }: { form: Form }) {
  if (!form.in_time || !form.out_time || form.in_time === form.out_time) {
    return (
      <div className="grid h-16 place-items-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
        Enter Punch In and Punch Out to see the day
      </div>
    );
  }
  const span = shiftMinutes(form);
  const at = (t: string) => {
    const d = timeToMinutes(t) - timeToMinutes(form.in_time);
    return ((d >= 0 ? d : d + 1440) / span) * 100;
  };
  const blocks = BREAKS.flatMap((b) => {
    const s = form[b.start];
    const e = form[b.end];
    if (!s || !e) return [];
    const left = at(s);
    const right = at(e);
    if (right <= left || right > 100) return [];
    return [{ b, left, width: right - left }];
  });
  // The stops of the day in order, listed under the track — never ON it, so
  // two breaks close together can't print over each other.
  const stops = [
    { key: "in", label: "Punch In", time: fmtTime(form.in_time), icon: LogIn, brk: false },
    ...blocks.map(({ b }) => ({
      key: b.key,
      label: b.label,
      time: `${fmtTime(form[b.start])} – ${fmtTime(form[b.end])}`,
      icon: b.key === "lunch" ? UtensilsCrossed : Coffee,
      brk: true,
    })),
    { key: "out", label: "Punch Out", time: fmtTime(form.out_time), icon: isOvernight(form) ? MoonStar : LogOut, brk: false },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
      <div className="relative mx-1.5 h-2.5 rounded-full bg-teal-500">
        {blocks.map(({ b, left, width }) => (
          <div
            key={b.key}
            className="absolute -inset-y-[3px] rounded-full bg-amber-400 shadow-[0_0_0_2px_white] dark:shadow-[0_0_0_2px_rgb(15,23,42)]"
            style={{ left: `${left}%`, width: `${Math.max(width, 1.2)}%` }}
            title={`${b.label} ${fmtTime(form[b.start])} – ${fmtTime(form[b.end])}`}
          />
        ))}
        {[0, 100].map((x) => (
          <span
            key={x}
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-600 shadow-[0_0_0_3px_white] dark:shadow-[0_0_0_3px_rgb(15,23,42)]"
            style={{ left: `${x}%` }}
          />
        ))}
      </div>

      <ol className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }}>
        {stops.map((st, i) => (
          <li
            key={st.key}
            className={cn("min-w-0", i === 0 ? "text-left" : i === stops.length - 1 ? "text-right" : "text-center")}
          >
            <p
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide",
                st.brk ? "text-amber-700 dark:text-amber-300" : "text-teal-700 dark:text-teal-300",
              )}
            >
              <st.icon className="h-3 w-3 shrink-0" />
              {st.label}
            </p>
            <p className={cn("tabular-nums text-foreground", st.brk ? "text-xs font-semibold" : "text-base font-bold")}>{st.time}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Master Data ▸ HR ▸ Work Timing — for EACH employee category, from a date:
 * Punch In, Tea Break 1, Lunch, Tea Break 2, Punch Out, and a grace allowance
 * (0774 · 0775). Staff | Worker switch over one plain table, a row per
 * category (user 2026-10-30). The editor is a full page, not a popup (user
 * 2026-10-31), with the day drawn to scale above the fields.
 *
 * A change of hours is a new dated revision, never an overwrite, so a past day
 * is judged by the hours of that day. The same Effective From again corrects
 * that revision; the revisions are listed under Changes.
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
  const blank: Form = { in_time: "", out_time: "", grace_minutes: "0", effective_from: today, ...BLANK_BREAKS };
  const [form, setForm] = useState<Form>(blank);
  const [initial, setInitial] = useState<Form>(blank);
  const [doomed, setDoomed] = useState<CategoryTiming | null>(null);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const live = categories.filter((c) => !c.inactive);
  const shown = live.filter((c) => categoryFitsKind(c.for_type, kind));
  const canWrite = perms.canEdit || perms.canCreate;

  function openEdit(c: EmployeeCategory) {
    const now = timingOn(rows, c.id, today);
    const f: Form = {
      in_time: hm(now?.in_time),
      out_time: hm(now?.out_time),
      grace_minutes: String(now?.grace_minutes ?? 0),
      // A new revision starts today; the operator moves it to a later date
      // to schedule a change, or back to correct one already in force.
      effective_from: today,
      ...(Object.fromEntries(BREAKS.flatMap((b) => [[b.start, hm(now?.[b.start])], [b.end, hm(now?.[b.end])]])) as Record<
        BreakField,
        string
      >),
    };
    setForm(f);
    setInitial(f);
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
        ...(Object.fromEntries(BREAKS.flatMap((b) => [[b.start, form[b.start] || null], [b.end, form[b.end] || null]])) as Record<
          BreakField,
          string | null
        >),
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
    ...BREAKS.map(
      (b): Column<EmployeeCategory> => ({
        header: b.label,
        cell: (c) => <BreakCell t={timingOn(rows, c.id, today)} b={b} />,
      }),
    ),
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
      header: "Working",
      cell: (c) => {
        const t = timingOn(rows, c.id, today);
        return t ? <span className="whitespace-nowrap tabular-nums">{hours(shiftMinutes(t) - breakMinutes(t))}</span> : "—";
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
            {next && <span className="block text-xs text-muted-foreground">Changes {fmtDate(next.effective_from)}</span>}
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
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k]);
  const sameInOut = !!form.in_time && form.in_time === form.out_time;
  const problem = sameInOut ? "Punch Out can't be the same as Punch In." : breakProblem(form);
  const canSave = !isPending && !!form.in_time && !!form.out_time && !!form.effective_from && !problem;
  const span = form.in_time && form.out_time && !sameInOut ? shiftMinutes(form) : 0;
  const breaks = span ? breakMinutes(form) : 0;

  const timingSection = (
    <div className="max-w-[44rem] space-y-6">
      <DayStrip form={form} />

      {span > 0 && (
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Shift", v: hours(span), icon: Clock, tone: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300", bar: "bg-sky-500" },
            { label: "Breaks", v: breaks ? hours(breaks) : "None", icon: Coffee, tone: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300", bar: "bg-amber-400" },
            { label: "Working", v: hours(Math.max(0, span - breaks)), icon: BriefcaseBusiness, tone: "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300", bar: "bg-teal-500" },
          ].map((x) => (
            <div key={x.label} className="relative overflow-hidden rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", x.bar)} />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{x.label}</dt>
                  <dd className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{x.v}</dd>
                </div>
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", x.tone)}>
                  <x.icon className="h-5 w-5" />
                </span>
              </div>
            </div>
          ))}
        </dl>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Shift</h3>
        <FieldRow>
          <Field label="Punch In" w="code" required htmlFor="ct-in">
            <Input id="ct-in" type="time" required value={form.in_time} onChange={(e) => set({ in_time: e.target.value })} />
          </Field>
          <Field label="Punch Out" w="code" required htmlFor="ct-out">
            <Input id="ct-out" type="time" required value={form.out_time} onChange={(e) => set({ out_time: e.target.value })} />
          </Field>
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
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Breaks</h3>
          <p className="text-xs text-muted-foreground">Leave a break blank if this category doesn&apos;t have it.</p>
        </div>
        {BREAKS.map((b) => {
          const s = form[b.start];
          const e = form[b.end];
          const len = s && e ? timeToMinutes(e) - timeToMinutes(s) : 0;
          return (
            <FieldRow key={b.key}>
              <div className="flex w-32 shrink-0 items-center gap-2 self-end pb-2.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", "bg-amber-400")} />
                <span className="text-sm font-medium text-foreground">{b.label}</span>
              </div>
              <Field label="From" w="code" htmlFor={`ct-${b.key}-from`}>
                <Input id={`ct-${b.key}-from`} type="time" value={s} onChange={(ev) => set({ [b.start]: ev.target.value })} />
              </Field>
              <Field label="To" w="code" htmlFor={`ct-${b.key}-to`}>
                <Input id={`ct-${b.key}-to`} type="time" value={e} onChange={(ev) => set({ [b.end]: ev.target.value })} />
              </Field>
              <p className="self-end pb-2.5 text-sm tabular-nums text-muted-foreground">
                {len > 0 ? `${len} min` : len < 0 ? `${len + 1440} min` : ""}
              </p>
            </FieldRow>
          );
        })}
      </section>

      <p className={cn("text-xs", problem ? "font-medium text-destructive" : "text-muted-foreground")}>
        {problem ??
          (form.in_time && form.out_time && isOvernight(form)
            ? "Punch Out is earlier than Punch In, so it is read as the next morning (night shift)."
            : "Late after Punch In + grace. Leaving before Punch Out is early (no grace).")}
      </p>
    </div>
  );

  const changesSection = (
    <ul className="max-w-[44rem] divide-y divide-border rounded-xl border border-border">
      {history.map((r) => (
        <li key={r.id} className="flex items-center gap-4 px-4 py-3 text-sm">
          <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{fmtDate(r.effective_from)}</span>
          <span className={cn("flex-1 tabular-nums", r.id === current?.id && "font-semibold")}>
            {fmtTime(r.in_time)} – {fmtTime(r.out_time)} · grace {r.grace_minutes}m
            {breakMinutes(r) ? ` · breaks ${breakMinutes(r)}m` : ""}
          </span>
          <span className="w-20 text-xs text-muted-foreground">
            {r.id === current?.id ? "In force" : r.effective_from.slice(0, 10) > today ? "Upcoming" : "Earlier"}
          </span>
          {perms.canDelete && (
            <RowIconAction label="Remove" name={fmtDate(r.effective_from)} icon={Trash2} danger onClick={() => setDoomed(r)} />
          )}
        </li>
      ))}
    </ul>
  );

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

      <MasterFullScreen
        open={editing !== null}
        onClose={() => setEditing(null)}
        modeLabel={
          <>
            Work Timing <span className="font-semibold text-foreground">{editing?.name}</span>
          </>
        }
        header={{
          initials: editing?.name.slice(0, 2).toUpperCase(),
          title: editing?.name ?? "",
          badges: dirty ? <span className="text-[11px] font-medium text-warning">● Unsaved</span> : undefined,
          meta: <span>{kind === "staff" ? "Staff" : "Worker"} category · Work Timing</span>,
          back: "Work Timing",
        }}
        sections={[
          { key: "timing", label: "Timing", icon: Clock, done: !!(form.in_time && form.out_time), content: timingSection },
          ...(history.length ? [{ key: "changes", label: "Changes", icon: History, done: true, content: changesSection }] : []),
        ]}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setEditing(null),
          onSave: save,
          saveLabel: "Save timing",
          canSave,
          isPending,
        }}
      />

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
