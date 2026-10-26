"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
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

/**
 * Resolve Hub ▸ Administration ▸ Unit Settings — one row per unit
 * (`rh_unit_settings`): who the escalation ladder climbs to, how long each
 * kind of job has, the abuse limits, and the triage score's weights. A unit
 * with no saved row runs on the plan's defaults, which is what this form
 * opens with.
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
  useUnsavedGuard(dirty || deskDirty || isPending);

  const personOptions = useMemo(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);
  const directorOptions = useMemo(() => people.map((p) => ({ id: p.id, label: p.name })), [people]);

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

  const deskNumField = (k: DeskNumKey, label: string, hint: string, min = 1, error?: string) => (
    <Field label={label} required w="hug" htmlFor={`rh-us-${k}`} hint={hint} error={error}>
      <Input id={`rh-us-${k}`} type="number" min={String(min)} value={deskForm.nums[k]} onChange={(e) => setDeskNum(k, e.target.value)} />
    </Field>
  );

  const numField = (k: NumKey, label: string, hint?: string) => (
    <Field label={label} required w="hug" htmlFor={`rh-us-${k}`} hint={hint}>
      <Input id={`rh-us-${k}`} type="number" min="0" value={form.nums[k]} onChange={(e) => setNum(k, e.target.value)} />
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

  const allNumsFilled =
    Object.values(form.nums).every((v) => v.trim() !== "") &&
    Object.values(deskForm.nums).every((v) => v.trim() !== "") &&
    !!form.timezone.trim();
  const anyDirty = dirty || deskDirty;

  // A page-level editor: the marker puts it on the Tab contract (AGENTS "Tab
  // lands on fields" — a page form with no marker keeps native Tab).
  return (
    <div className="space-y-4" data-focus-scope>
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <CardBody>
          {/* 200 head + 200 estate + 288 directors + 2 × 12px gap = 712px → 46rem. */}
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
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Complaints</CardTitle>
        </CardHeader>
        <CardBody>
          {/* 200 handler + 88 hours + 12px gap = 300px → 20rem. */}
          <FieldRow className="max-w-[20rem]">
            <Field
              label="Superior Handler"
              w="party"
              htmlFor="rh-us-superior"
              hint="Independent handler for complaints about the reporter's own superior"
            >
              <Combobox
                id="rh-us-superior"
                options={personOptions}
                value={form.superior_handler_id}
                onChange={(v) => patch({ superior_handler_id: v })}
                clearable
              />
            </Field>
            {numField("complaint_response_hours", "Respond In", "Hours, unless the category sets its own")}
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raagam Assist</CardTitle>
        </CardHeader>
        <CardBody>
          {/* 200 owner + 200 contact + 12px gap = 412px → 26rem. */}
          <FieldRow className="max-w-[26rem]">
            <Field
              label="Stores / Requirement Owner"
              w="party"
              htmlFor="rh-us-rq-owner"
              hint="Buy requests go here; else the Unit Head"
            >
              <Combobox
                id="rh-us-rq-owner"
                options={personOptions}
                value={form.requirement_owner_id}
                onChange={(v) => patch({ requirement_owner_id: v })}
                clearable
              />
            </Field>
            <Field
              label="Emergency Contact"
              w="party"
              htmlFor="rh-us-emergency"
              hint="Shown before gas, fire or shock problems"
            >
              <Input
                id="rh-us-emergency"
                maxLength={120}
                value={form.emergency_contact}
                onChange={(e) => patch({ emergency_contact: e.target.value })}
              />
            </Field>
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service Desk</CardTitle>
        </CardHeader>
        <CardBody>
          {/* 200 manager + 4 × 88 days + 4 × 12px gap = 600px → 38rem. */}
          <FieldRow className="max-w-[38rem]" align="start">
            <Field
              label="Desk Manager"
              w="party"
              htmlFor="rh-us-desk-manager"
              hint={
                managerLacksTriage ? (
                  <span className="text-warning">
                    Cannot open escalated requests — give them Resolve Hub approve (triage) access.
                  </span>
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
            {deskNumField("sd_auto_close_days", "Auto-Close", "Days resolved, unconfirmed")}
            {deskNumField("sd_stale_remind_days", "Stale Remind", "Days untouched")}
            {deskNumField(
              "sd_stale_escalate_days",
              "Stale Escalate",
              "Days untouched",
              1,
              escalateTooEarly ? "Not before the reminder" : undefined,
            )}
            {deskNumField("sd_reopen_days", "Reopen Within", "Days after close; 0 = never", 0)}
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deadlines &amp; escalation</CardTitle>
        </CardHeader>
        <CardBody>
          {/* 176 timezone + 5 × 88 + 5 × 12px gap = 676px → 44rem. */}
          <FieldRow className="max-w-[44rem]">
            <Field label="Timezone" required w="term" htmlFor="rh-us-tz">
              {/* caps-input: exempt -- an IANA timezone ("Asia/Kolkata") is case-sensitive */}
              <Input id="rh-us-tz" uppercase={false} value={form.timezone} onChange={(e) => patch({ timezone: e.target.value })} />
            </Field>
            {numField("escalation_hour", "Escalate at", "Hour, 0–23")}
            {numField("ordinary_days", "Ordinary", "Days")}
            {numField("routine_days", "Routine", "Days")}
            {numField("purchase_days", "Purchase", "Days")}
            {numField("dispute_window_days", "Dispute", "Days after close")}
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
        </CardHeader>
        <CardBody>
          {/* 4 × 88 + 200 toggle + 4 × 12px gap = 600px → 38rem. */}
          <FieldRow className="max-w-[38rem]">
            {numField("dup_window_days", "Duplicates", "Days to look back")}
            {numField("report_limit_24h", "Reports / day", "Per person, 24 h")}
            {numField("spot_check_one_in", "Spot check", "1 fix in N")}
            {numField("page_cap_per_day", "Pages / day", "Dangerous SMS cap")}
            <Field label="Notifications" w="party">
              <span className="flex min-h-9 items-center">
                <Toggle
                  checked={form.suppress_notifications}
                  onChange={(on) => patch({ suppress_notifications: on })}
                  label="Suppress all"
                  tone="primary"
                />
              </span>
            </Field>
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triage score</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
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
            {WEIGHTS.map(({ key, label }) =>
              weightField(key, label, form.weights[key], (v) => patch({ weights: { ...form.weights, [key]: v } })),
            )}
          </FieldRow>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!anyDirty || isPending}
          onClick={() => {
            setForm(toForm(settings));
            setDirty(false);
            setDeskForm(toDeskForm(desk));
            setDeskDirty(false);
          }}
        >
          Cancel
        </Button>
        <Button disabled={!anyDirty || !allNumsFilled || escalateTooEarly || isPending} onClick={save}>
          {isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
