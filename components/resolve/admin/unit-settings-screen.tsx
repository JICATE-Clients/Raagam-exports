"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Clock,
  Laptop,
  ListOrdered,
  MessageSquareWarning,
  ShieldAlert,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Toggle } from "@/components/ui/toggle";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { Stepper } from "@/components/resolve/admin/stepper";
import { dayWords } from "@/components/resolve/admin/span-words";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useAccordion } from "@/lib/ui/use-accordion";
import { cn } from "@/lib/utils";
import { saveUnitSettings } from "@/lib/resolve/actions";
import { saveDeskUnitSettings } from "@/lib/resolve/desk-actions";
import type { DeskUnitSettings } from "@/lib/resolve/desk-types";
import type { Priority, Severity, TriageWeights, UnitSettings } from "@/lib/resolve/types";

type Person = { id: string; name: string };

/** Every number on the form held as typed text, so a half-typed box is not
 *  coerced to 0 under the operator's cursor; parsed once, on Save. */
type NumKey =
  | "escalation_hour"
  | "ordinary_days"
  | "routine_days"
  | "purchase_days"
  | "dup_window_days"
  | "dispute_window_days"
  | "report_limit_24h"
  | "spot_check_one_in"
  | "page_cap_per_day"
  | "complaint_response_hours";

type WeightKey = Exclude<keyof TriageWeights, "severity" | "priority">;

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
const WEIGHTS: { key: WeightKey; label: string }[] = [
  { key: "per_day_open", label: "Per day open" },
  { key: "age_cap", label: "Age cap" },
  { key: "reopened", label: "Reopened" },
  { key: "disputed", label: "Disputed" },
  { key: "repeated", label: "Repeated place" },
  { key: "unassigned", label: "Unassigned" },
];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function toForm(s: UnitSettings) {
  const n = (v: number) => String(v);
  const w = s.triage_weights;
  return {
    unit_head_id: s.unit_head_id ?? "",
    estate_owner_id: s.estate_owner_id ?? "",
    superior_handler_id: s.superior_handler_id ?? "",
    requirement_owner_id: s.requirement_owner_id ?? "",
    emergency_contact: s.emergency_contact ?? "",
    director_ids: s.director_ids,
    timezone: s.timezone,
    suppress_notifications: s.suppress_notifications,
    nums: {
      escalation_hour: n(s.escalation_hour),
      ordinary_days: n(s.ordinary_days),
      routine_days: n(s.routine_days),
      purchase_days: n(s.purchase_days),
      dup_window_days: n(s.dup_window_days),
      dispute_window_days: n(s.dispute_window_days),
      report_limit_24h: n(s.report_limit_24h),
      spot_check_one_in: n(s.spot_check_one_in),
      page_cap_per_day: n(s.page_cap_per_day),
      complaint_response_hours: n(s.complaint_response_hours),
    } as Record<NumKey, string>,
    severity: Object.fromEntries(SEVERITIES.map((k) => [k, n(w.severity[k])])) as Record<Severity, string>,
    priority: Object.fromEntries(PRIORITIES.map((k) => [k, n(w.priority[k])])) as Record<Priority, string>,
    weights: Object.fromEntries(WEIGHTS.map(({ key }) => [key, n(w[key])])) as Record<WeightKey, string>,
  };
}
type Form = ReturnType<typeof toForm>;

/** The Service Desk's half (plan §2) — a separate row slice with its own save
 *  (`saveDeskUnitSettings`), so neither save can blank the other's columns. */
type DeskNumKey = "sd_auto_close_days" | "sd_stale_remind_days" | "sd_stale_escalate_days" | "sd_reopen_days";
const DESK_NUMS: DeskNumKey[] = ["sd_auto_close_days", "sd_stale_remind_days", "sd_stale_escalate_days", "sd_reopen_days"];

function toDeskForm(d: DeskUnitSettings) {
  return {
    desk_manager_id: d.desk_manager_id ?? "",
    nums: Object.fromEntries(DESK_NUMS.map((k) => [k, String(d[k])])) as Record<DeskNumKey, string>,
  };
}
type DeskForm = ReturnType<typeof toDeskForm>;

/** Leaf values of a form, as `path → text`, so two forms can be counted apart. */
function leaves(v: unknown, path = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (Array.isArray(v)) out.set(path, [...v].sort().join(","));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, `${path}.${k}`, out);
  else out.set(path, String(v));
  return out;
}
function changesBetween(a: unknown, b: unknown): number {
  const x = leaves(a);
  const y = leaves(b);
  let n = 0;
  for (const [k, v] of x) if (y.get(k) !== v) n++;
  return n;
}

type SectionKey = "people" | "concerns" | "assist" | "desk" | "deadlines" | "limits" | "triage";

/**
 * Resolve Hub ▸ Administration ▸ Unit Settings — one row per unit
 * (`rh_unit_settings`): who the escalation ladder climbs to, how long each
 * kind of job has, the abuse limits, and the triage score's weights. A unit
 * with no saved row runs on the plan's defaults, which is what this form
 * opens with.
 *
 * SECTIONS FOLD, ONE OPEN AT A TIME (mobile redesign 2026-10-26; AGENTS "Folds
 * are accordions"), each header carrying a one-line summary so a folded page
 * still says what is set. A folded section's fields stay IN THE DOCUMENT, only
 * collapsed — Tab arriving in one is what opens it (`focusProps`), so the
 * keyboard reaches every field without the mouse. A section holding a blank
 * required number is never folded (AGENTS "Mandatory fields"). Days and limits
 * are steppers over real number boxes; the docked bar counts the changes and
 * carries Undo and Save.
 */
export function UnitSettingsScreen({
  settings,
  desk,
  deskApproverIds,
  people,
}: {
  settings: UnitSettings;
  desk: DeskUnitSettings;
  /** Who holds resolve:approve — null when it could not be read (no warning then). */
  deskApproverIds: string[] | null;
  people: Person[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [dirty, setDirty] = useState(false);
  const [deskForm, setDeskForm] = useState<DeskForm>(() => toDeskForm(desk));
  const [deskDirty, setDeskDirty] = useState(false);
  const fold = useAccordion("people");
  useUnsavedGuard(dirty || deskDirty || isPending);

  const personOptions = useMemo(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);
  const directorOptions = useMemo(() => people.map((p) => ({ id: p.id, label: p.name })), [people]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const baseForm = useMemo(() => toForm(settings), [settings]);
  const baseDesk = useMemo(() => toDeskForm(desk), [desk]);

  const patch = (p: Partial<Form>) => {
    setForm((f) => ({ ...f, ...p }));
    setDirty(true);
  };
  const setNum = (k: NumKey, v: string) => patch({ nums: { ...form.nums, [k]: v } });
  const patchDesk = (p: Partial<DeskForm>) => {
    setDeskForm((f) => ({ ...f, ...p }));
    setDeskDirty(true);
  };
  const setDeskNum = (k: DeskNumKey, v: string) => patchDesk({ nums: { ...deskForm.nums, [k]: v } });

  // Plan §1.9: escalations reach the desk manager, who needs resolve:approve to
  // open them. Said under the field, advisory — the save is still allowed.
  const managerLacksTriage =
    !!deskForm.desk_manager_id && !!deskApproverIds && !deskApproverIds.includes(deskForm.desk_manager_id);
  const escalateTooEarly =
    deskForm.nums.sd_stale_remind_days.trim() !== "" &&
    deskForm.nums.sd_stale_escalate_days.trim() !== "" &&
    Number(deskForm.nums.sd_stale_escalate_days) < Number(deskForm.nums.sd_stale_remind_days);

  const days = (raw: string) => (raw.trim() === "" || !Number.isFinite(Number(raw)) ? undefined : dayWords(Number(raw)));

  const deskNumField = (k: DeskNumKey, label: string, hint: string, min = 1, error?: string) => (
    <Field label={label} required htmlFor={`rh-us-${k}`} hint={hint} error={error}>
      <Stepper id={`rh-us-${k}`} min={min} value={deskForm.nums[k]} onChange={(v) => setDeskNum(k, v)} words={days(deskForm.nums[k])} />
    </Field>
  );

  const numField = (k: NumKey, label: string, hint?: string, opts: { max?: number; words?: string } = {}) => (
    <Field label={label} required htmlFor={`rh-us-${k}`} hint={hint}>
      <Stepper id={`rh-us-${k}`} min={0} max={opts.max} value={form.nums[k]} onChange={(v) => setNum(k, v)} words={opts.words} />
    </Field>
  );
  const weightField = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <Field key={id} label={label} w="hug" htmlFor={`rh-us-w-${id}`}>
      <Input id={`rh-us-w-${id}`} type="number" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );

  function save() {
    const num = (v: string) => Number(v);
    startTransition(async () => {
      if (deskDirty) {
        const deskRes = await saveDeskUnitSettings({
          desk_manager_id: deskForm.desk_manager_id || null,
          ...(Object.fromEntries(DESK_NUMS.map((k) => [k, num(deskForm.nums[k])])) as Record<DeskNumKey, number>),
        });
        if (!deskRes.ok) {
          error(deskRes.error);
          return;
        }
        setDeskDirty(false);
        if (!dirty) {
          success("Unit settings saved.");
          router.refresh();
          return;
        }
      }
      const res = await saveUnitSettings({
        unit_head_id: form.unit_head_id || null,
        estate_owner_id: form.estate_owner_id || null,
        superior_handler_id: form.superior_handler_id || null,
        requirement_owner_id: form.requirement_owner_id || null,
        emergency_contact: form.emergency_contact.trim() || null,
        director_ids: form.director_ids,
        timezone: form.timezone,
        suppress_notifications: form.suppress_notifications,
        ...(Object.fromEntries(Object.entries(form.nums).map(([k, v]) => [k, num(v)])) as Record<NumKey, number>),
        triage_weights: {
          severity: Object.fromEntries(SEVERITIES.map((k) => [k, num(form.severity[k])])) as Record<Severity, number>,
          priority: Object.fromEntries(PRIORITIES.map((k) => [k, num(form.priority[k])])) as Record<Priority, number>,
          ...(Object.fromEntries(WEIGHTS.map(({ key }) => [key, num(form.weights[key])])) as Record<WeightKey, number>),
        },
      });
      if (res.ok) {
        success("Unit settings saved.");
        setDirty(false);
        router.refresh();
      } else error(res.error);
    });
  }

  const blank = (v: string) => v.trim() === "";
  const allNumsFilled =
    Object.values(form.nums).every((v) => !blank(v)) && Object.values(deskForm.nums).every((v) => !blank(v)) && !blank(form.timezone);
  const anyDirty = dirty || deskDirty;
  const changes = (dirty ? changesBetween(form, baseForm) : 0) + (deskDirty ? changesBetween(deskForm, baseDesk) : 0);

  function undo() {
    setForm(toForm(settings));
    setDirty(false);
    setDeskForm(toDeskForm(desk));
    setDeskDirty(false);
  }

  // A section holding a blank required field is held open — never hidden.
  const blankIn: Record<SectionKey, boolean> = {
    people: false,
    concerns: blank(form.nums.complaint_response_hours),
    assist: false,
    desk: DESK_NUMS.some((k) => blank(deskForm.nums[k])),
    deadlines:
      blank(form.timezone) ||
      (["escalation_hour", "ordinary_days", "routine_days", "purchase_days", "dispute_window_days"] as NumKey[]).some((k) =>
        blank(form.nums[k]),
      ),
    limits: (["dup_window_days", "report_limit_24h", "spot_check_one_in", "page_cap_per_day"] as NumKey[]).some((k) =>
      blank(form.nums[k]),
    ),
    triage: false,
  };

  const who = (id: string, none = "not set") => (id ? nameOf.get(id) ?? "someone" : none);
  const summary: Record<SectionKey, string> = {
    people: `Head: ${who(form.unit_head_id)} · Estate: ${who(form.estate_owner_id)}${
      form.director_ids.length ? ` · ${form.director_ids.length} director${form.director_ids.length === 1 ? "" : "s"}` : ""
    }`,
    concerns: `Superior handler: ${who(form.superior_handler_id)} · reply in ${form.nums.complaint_response_hours || "?"} h`,
    assist: `Stores: ${who(form.requirement_owner_id, "Unit Head")} · emergency contact ${form.emergency_contact.trim() ? "set" : "not set"}`,
    desk: `Manager: ${who(deskForm.desk_manager_id, "Unit Head")} · auto-close ${deskForm.nums.sd_auto_close_days || "?"} d · remind ${
      deskForm.nums.sd_stale_remind_days || "?"
    } d`,
    deadlines: `Ordinary ${form.nums.ordinary_days || "?"} d · Routine ${form.nums.routine_days || "?"} d · Purchase ${
      form.nums.purchase_days || "?"
    } d`,
    limits: `${form.nums.report_limit_24h || "?"} reports a day · notifications ${form.suppress_notifications ? "paused" : "on"}`,
    triage: "Advanced — how the triage queue is sorted",
  };

  function section(key: SectionKey, title: string, icon: LucideIcon, body: ReactNode) {
    const Icon = icon;
    const open = fold.isOpen(key) || blankIn[key];
    const bodyId = `rh-us-sec-${key}`;
    return (
      <section {...fold.focusProps(key)} className="overflow-hidden rounded-xl border border-border bg-surface">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => fold.toggle(key)}
          className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{title}</span>
            <Truncated text={summary[key]} className="text-xs text-muted-foreground" />
          </span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {/* Collapsed, never unmounted: Tab must still be able to arrive here,
            and arriving is what opens it. */}
        <div id={bodyId} className={open ? "border-t border-border p-3" : "h-0 overflow-hidden"}>
          {body}
        </div>
      </section>
    );
  }

  // A page-level editor: the marker puts it on the Tab contract (AGENTS "Tab
  // lands on fields" — a page form with no marker keeps native Tab).
  return (
    <div className="max-w-[48rem] space-y-3" data-focus-scope>
      {section(
        "people",
        "People",
        Users,
        // 200 head + 200 estate + 288 directors + 2 × 12px gap = 712px → 46rem.
        <FieldRow className="max-w-[46rem]">
          <Field label="Unit Head" w="party" htmlFor="rh-us-head" hint="3 days late, and every 2nd dispute">
            <Combobox id="rh-us-head" options={personOptions} value={form.unit_head_id} onChange={(v) => patch({ unit_head_id: v })} clearable />
          </Field>
          <Field label="Estate Office" w="party" htmlFor="rh-us-estate" hint="Owns what no team or caretaker does">
            <Combobox id="rh-us-estate" options={personOptions} value={form.estate_owner_id} onChange={(v) => patch({ estate_owner_id: v })} clearable />
          </Field>
          <Field label="Directors" w="name" htmlFor="rh-us-directors" hint="Morning digest of jobs 7+ days late">
            <MultiSelect
              id="rh-us-directors"
              label="Directors"
              options={directorOptions}
              values={form.director_ids}
              onChange={(v) => patch({ director_ids: v })}
            />
          </Field>
        </FieldRow>,
      )}

      {section(
        "concerns",
        "Concerns",
        MessageSquareWarning,
        <FieldRow className="max-w-[30rem]" align="start">
          <Field label="Superior Handler" w="party" htmlFor="rh-us-superior" hint="Independent handler for concerns about the reporter's own superior">
            <Combobox
              id="rh-us-superior"
              options={personOptions}
              value={form.superior_handler_id}
              onChange={(v) => patch({ superior_handler_id: v })}
              clearable
            />
          </Field>
          {numField("complaint_response_hours", "Reply Within", "Hours, unless the category sets its own", {
            words: form.nums.complaint_response_hours ? `${form.nums.complaint_response_hours} h` : undefined,
          })}
        </FieldRow>,
      )}

      {section(
        "assist",
        "Raagam Assist",
        Sparkles,
        // 200 owner + 200 contact + 12px gap = 412px → 26rem.
        <FieldRow className="max-w-[26rem]">
          <Field label="Stores / Requirement Owner" w="party" htmlFor="rh-us-rq-owner" hint="Buy requests go here; else the Unit Head">
            <Combobox
              id="rh-us-rq-owner"
              options={personOptions}
              value={form.requirement_owner_id}
              onChange={(v) => patch({ requirement_owner_id: v })}
              clearable
            />
          </Field>
          <Field label="Emergency Contact" w="party" htmlFor="rh-us-emergency" hint="Shown before gas, fire or shock problems">
            <Input id="rh-us-emergency" maxLength={120} value={form.emergency_contact} onChange={(e) => patch({ emergency_contact: e.target.value })} />
          </Field>
        </FieldRow>,
      )}

      {section(
        "desk",
        "IT desk",
        Laptop,
        <div className="space-y-3">
          <FieldRow className="max-w-[26rem]">
            <Field
              label="Desk Manager"
              w="party"
              htmlFor="rh-us-desk-manager"
              hint={
                managerLacksTriage ? (
                  <span className="text-warning">Cannot open escalated requests — give them Resolve Hub approve (triage) access.</span>
                ) : (
                  "Breaches and stale escalations go here; else the Unit Head"
                )
              }
            >
              <Combobox
                id="rh-us-desk-manager"
                options={personOptions}
                value={deskForm.desk_manager_id}
                onChange={(v) => patchDesk({ desk_manager_id: v })}
                clearable
              />
            </Field>
          </FieldRow>
          <div className="grid gap-3 sm:grid-cols-2">
            {deskNumField("sd_auto_close_days", "Auto-Close", "Days resolved, unconfirmed")}
            {deskNumField("sd_stale_remind_days", "Stale Remind", "Days untouched")}
            {deskNumField("sd_stale_escalate_days", "Stale Escalate", "Days untouched", 1, escalateTooEarly ? "Not before the reminder" : undefined)}
            {deskNumField("sd_reopen_days", "Reopen Within", "Days after close; 0 = never", 0)}
          </div>
        </div>,
      )}

      {section(
        "deadlines",
        "Deadlines & escalation",
        Clock,
        <div className="space-y-3">
          <FieldRow className="max-w-[26rem]">
            <Field label="Timezone" required w="term" htmlFor="rh-us-tz">
              {/* caps-input: exempt -- an IANA timezone ("Asia/Kolkata") is case-sensitive */}
              <Input id="rh-us-tz" uppercase={false} value={form.timezone} onChange={(e) => patch({ timezone: e.target.value })} />
            </Field>
          </FieldRow>
          <div className="grid gap-3 sm:grid-cols-2">
            {numField("escalation_hour", "Escalate at", "Hour, 0–23", {
              max: 23,
              words: form.nums.escalation_hour ? `${form.nums.escalation_hour.padStart(2, "0")}:00` : undefined,
            })}
            {numField("ordinary_days", "Ordinary repair", "Days", { words: days(form.nums.ordinary_days) })}
            {numField("routine_days", "Routine job", "Days", { words: days(form.nums.routine_days) })}
            {numField("purchase_days", "Needs a purchase", "Days", { words: days(form.nums.purchase_days) })}
            {numField("dispute_window_days", "Dispute within", "Days after close", { words: days(form.nums.dispute_window_days) })}
          </div>
        </div>,
      )}

      {section(
        "limits",
        "Limits",
        ShieldAlert,
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {numField("dup_window_days", "Duplicates", "Days to look back", { words: days(form.nums.dup_window_days) })}
            {numField("report_limit_24h", "Reports / day", "Per person, 24 h")}
            {numField("spot_check_one_in", "Spot check", "1 fix in N")}
            {numField("page_cap_per_day", "Pages / day", "Dangerous SMS cap")}
          </div>
          <Field label="Notifications" w="party">
            <span className="flex min-h-9 items-center">
              <Toggle checked={form.suppress_notifications} onChange={(on) => patch({ suppress_notifications: on })} label="Pause all" tone="primary" />
            </span>
          </Field>
        </div>,
      )}

      {section(
        "triage",
        "Triage score",
        ListOrdered,
        <div className="space-y-3">
          {/* Six 88px weights + 5 × 12px gap = 588px → 38rem, on every row. */}
          <FieldRow className="max-w-[38rem]">
            {SEVERITIES.map((k) =>
              weightField(`s-${k}`, `Severity ${cap(k)}`, form.severity[k], (v) => patch({ severity: { ...form.severity, [k]: v } })),
            )}
          </FieldRow>
          <FieldRow className="max-w-[38rem]">
            {PRIORITIES.map((k) =>
              weightField(`p-${k}`, `Priority ${cap(k)}`, form.priority[k], (v) => patch({ priority: { ...form.priority, [k]: v } })),
            )}
          </FieldRow>
          <FieldRow className="max-w-[38rem]">
            {WEIGHTS.map(({ key, label }) => weightField(key, label, form.weights[key], (v) => patch({ weights: { ...form.weights, [key]: v } })))}
          </FieldRow>
        </div>,
      )}

      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
        <span className="mr-auto text-sm text-muted-foreground">
          {!anyDirty || changes === 0 ? "No changes" : `${changes} ${changes === 1 ? "change" : "changes"}`}
        </span>
        <Button variant="outline" disabled={!anyDirty || isPending} onClick={undo}>
          Undo
        </Button>
        <Button disabled={!anyDirty || !allNumsFilled || escalateTooEarly || isPending} onClick={save}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
