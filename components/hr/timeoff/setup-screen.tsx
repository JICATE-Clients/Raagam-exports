"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { ActiveField } from "@/components/ui/active-field";
import { Toggle } from "@/components/ui/toggle";
import { Tabs } from "@/components/ui/tabs";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { activeTone } from "@/lib/ui/status-tone";
import { fmtDate } from "@/lib/format";
import {
  deleteBlackout,
  deleteLeaveType,
  saveBlackout,
  saveDepartmentHead,
  saveLeaveType,
  saveYear,
} from "@/lib/hr/timeoff-actions";
import {
  isOnDuty,
  fmtDays,
  fmtMinutes,
  type Blackout,
  type DepartmentHead,
  type HodOption,
  type LeaveType,
  type LeaveTypeInput,
  type LeaveYear,
  type RequestCategory,
} from "@/lib/hr/timeoff-types";

/**
 * HR ▸ Time Off ▸ Time Off Setup (0770, MyJKKN §9.4 / `admin/leave-types`,
 * `admin/academic-years`, and the blackout table MyJKKN never gave a screen).
 * Tabs: Leave Types, Other Types, Leave Years, Blackout Dates, Approval Flow. The two TYPE
 * tabs are one table split in two (user 2026-11-05: "separate tabs for leaves
 * and the other things — OD, permission, comp off", then "why those 3
 * separate, why not in one"): the leaves (CL, SL, EL, LOP …) and everything
 * else (On Duty, Permission, Comp Off). Leave Types' "+ Add" makes a leave;
 * Other Types' asks which of the three — the only place a kind is chosen,
 * and only for a NEW type (the editor never changes it).
 */

type TypeGroup = "leave" | "other";
type OtherKind = "on_duty" | "permission" | "comp_off";

const GROUPS: Record<TypeGroup, { label: string; noun: string; empty: string }> = {
  leave: { label: "Leave Types", noun: "Leave Type", empty: "No leave types yet." },
  other: { label: "Other Types", noun: "Type", empty: "No on duty, permission or comp off type yet." },
};

const OTHER_KINDS: Record<OtherKind, { label: string; category: RequestCategory }> = {
  on_duty: { label: "On Duty", category: "leave" },
  permission: { label: "Permission", category: "short_time_off" },
  comp_off: { label: "Comp Off", category: "compensatory_off" },
};

function otherKind(t: { request_category: string; code: string | null; name: string | null }): OtherKind | null {
  if (t.request_category === "short_time_off") return "permission";
  if (t.request_category === "compensatory_off") return "comp_off";
  return isOnDuty(t.code, t.name) ? "on_duty" : null;
}

function inGroup(t: LeaveType, g: TypeGroup): boolean {
  return (g === "other") === (otherKind(t) !== null);
}

type Props = {
  types: LeaveType[];
  years: LeaveYear[];
  blackouts: Blackout[];
  locations: { id: string; name: string }[];
  heads: DepartmentHead[];
  hodOptions: HodOption[];
  canEdit: boolean;
  canDelete: boolean;
};

export function SetupScreen(props: Props) {
  return (
    <Tabs
      items={[
        ...(Object.keys(GROUPS) as TypeGroup[]).map((g) => ({
          key: g === "leave" ? "types" : g,
          label: GROUPS[g].label,
          content: <TypesTab {...props} group={g} />,
        })),
        { key: "years", label: "Leave Years", content: <YearsTab {...props} /> },
        { key: "blackouts", label: "Blackout Dates", content: <BlackoutsTab {...props} /> },
        { key: "flow", label: "Approval Flow", content: <FlowTab {...props} /> },
      ]}
    />
  );
}

// ─── Leave types ───────────────────────────────────────────────────────────

type TypeDraft = Record<keyof LeaveTypeInput, string | boolean>;

function typeDraft(t?: LeaveType): TypeDraft {
  const n = (v: number | null | undefined) => (v == null ? "" : String(v));
  return {
    code: t?.code ?? "",
    name: t?.name ?? "",
    color: t?.color ?? "#6366f1",
    sort_order: n(t?.sort_order ?? 0),
    is_active: t?.is_active ?? true,
    request_category: t?.request_category ?? "leave",
    applies_to: t?.applies_to ?? "both",
    applicable_gender: t?.applicable_gender ?? "any",
    is_paid: t?.is_paid ?? true,
    allow_half_day: t?.allow_half_day ?? true,
    skip_weekends: t?.skip_weekends ?? true,
    skip_holidays: t?.skip_holidays ?? true,
    track_balance: t?.track_balance ?? true,
    default_entitled_days: n(t?.default_entitled_days ?? 0),
    accrual_type: t?.accrual_type ?? "annual",
    accrual_rate: n(t?.accrual_rate),
    min_advance_notice_days: n(t?.min_advance_notice_days ?? 0),
    max_continuous_days: n(t?.max_continuous_days),
    limit_period: t?.limit_period ?? "none",
    max_days_per_period: n(t?.max_days_per_period),
    allow_carry_forward: t?.allow_carry_forward ?? false,
    max_carry_forward_days: n(t?.max_carry_forward_days),
    is_encashable: t?.is_encashable ?? false,
    max_encashable_days: n(t?.max_encashable_days),
    sto_limit_mode: t?.sto_limit_mode ?? "none",
    sto_limit_period: t?.sto_limit_period ?? "month",
    sto_max_requests: n(t?.sto_max_requests),
    sto_total_minutes: n(t?.sto_total_minutes),
    sto_min_minutes: n(t?.sto_min_minutes),
    sto_max_minutes: n(t?.sto_max_minutes),
  };
}

/** Blank number boxes travel as null; the schema coerces the rest. */
function typePayload(d: TypeDraft): LeaveTypeInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = v === "" ? null : v;
  return out as LeaveTypeInput;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function TypesTab({ types: allTypes, canEdit, canDelete, group }: Props & { group: TypeGroup }) {
  const G = GROUPS[group];
  const types = allTypes.filter((t) => inGroup(t, group));
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<TypeDraft>(typeDraft);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);

  const set = (k: keyof TypeDraft, v: string | boolean) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const str = (k: keyof TypeDraft) => String(d[k] ?? "");
  const bool = (k: keyof TypeDraft) => d[k] === true;
  const cat = d.request_category as RequestCategory;

  function openEdit(t?: LeaveType) {
    setEditId(t?.id ?? null);
    const draft = typeDraft(t);
    if (!t && group === "other") pickKind(draft, "permission");
    setD(draft);
    setDirty(false);
    setOpen(true);
  }
  /** A new Other type takes its kind here. On Duty is recognised by "ON DUTY" in its name. */
  function pickKind(draft: TypeDraft, k: OtherKind) {
    draft.request_category = OTHER_KINDS[k].category;
    draft.track_balance = false;
    const name = String(draft.name ?? "");
    if (k === "on_duty" && !/ON DUTY/i.test(name)) draft.name = `ON DUTY ${name}`.trim();
    if (k !== "on_duty") draft.name = name.replace(/^ON DUTY\s*/i, "");
  }
  const newKind = otherKind({ request_category: str("request_category"), code: str("code"), name: str("name") }) ?? "permission";

  function save() {
    startTransition(async () => {
      const r = await saveLeaveType(editId, typePayload(d));
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(`${G.noun} saved`);
      router.refresh();
    });
  }
  function remove(t: LeaveType) {
    startTransition(async () => {
      const r = await deleteLeaveType(t.id);
      if (!r.ok) toastError(r.error);
      else {
        success("Deleted");
        router.refresh();
      }
    });
  }

  const columns: Column<LeaveType>[] = [
    { header: "Code", cell: (t) => <span className="font-mono text-xs font-medium">{t.code}</span> },
    { header: "Name", cell: (t) => <span className="text-sm">{t.name}</span> },
    ...(group === "other"
      ? [{ header: "Kind", cell: (t: LeaveType) => <span className="text-sm">{OTHER_KINDS[otherKind(t) ?? "permission"].label}</span> }]
      : []),
    {
      header: "Allowance",
      cell: (t) => (
        <span className="text-sm">
          {t.request_category === "short_time_off"
            ? t.sto_limit_mode === "count"
              ? `${t.sto_max_requests} a ${t.sto_limit_period}`
              : t.sto_limit_mode === "minutes"
                ? `${fmtMinutes(t.sto_total_minutes)} a ${t.sto_limit_period}`
                : "No limit"
            : t.request_category === "compensatory_off"
              ? "From credits"
              : !t.track_balance
                ? "Unlimited"
                : t.accrual_type === "monthly"
                  ? `${fmtDays(t.default_entitled_days)} / year (${t.accrual_rate} a month)`
                  : `${fmtDays(t.default_entitled_days)} / year`}
        </span>
      ),
    },
    { header: "For", cell: (t) => <span className="text-sm capitalize">{t.applies_to === "both" ? "Staff & workers" : t.applies_to}{t.applicable_gender !== "any" ? ` · ${t.applicable_gender}` : ""}</span> },
    { header: "Paid", cell: (t) => <span className="text-sm">{t.is_paid ? "Yes" : "No"}</span> },
  ];
  const statusColumn: Column<LeaveType> = {
    header: "Status",
    cell: (t) => <StatusPill tone={activeTone(t.is_active)}>{t.is_active ? "Active" : "Inactive"}</StatusPill>,
  };
  const actions = rowActionsColumn<LeaveType>((t) => (
    <RowActions
      label={t.name}
      onEdit={() => openEdit(t)}
      canEdit={canEdit}
      onDelete={() => remove(t)}
      canDelete={canDelete}
      isPending={isPending}
    />
  ));

  return (
    <div className="space-y-4 pt-3">
      <div className="flex justify-end">{canEdit && <Button onClick={() => openEdit()}>+ Add {G.noun}</Button>}</div>
      <DataTable
        columns={[...withCreatedColumns(columns, types), statusColumn, actions]}
        rows={types}
        getKey={(t) => t.id}
        empty={G.empty}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${str("name")}` : `New ${G.noun.toLowerCase()}`}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !str("code").trim() || !str("name").trim()} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* 144 code + 288 name + 176 available to + 144 gender + gaps ≈ 800px → cap 56rem; wraps on a phone */}
        <div className="max-w-[56rem] space-y-6">
          <Section title="Identity">
            <FieldRow>
              <ActiveField active={bool("is_active")} onChange={(v) => set("is_active", v)} isNew={!editId} />
              <Field label="Code" w="code" required>
                <Input value={str("code")} maxLength={10} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label="Name" w="name" required>
                <Input value={str("name")} onChange={(e) => set("name", e.target.value)} />
              </Field>
              {group === "other" && !editId && (
                <Field label="Kind" w="term" required>
                  <Select
                    value={newKind}
                    onChange={(e) => {
                      const next = { ...d };
                      pickKind(next, e.target.value as OtherKind);
                      setD(next);
                      setDirty(true);
                    }}
                  >
                    {(Object.keys(OTHER_KINDS) as OtherKind[]).map((k) => (
                      <option key={k} value={k}>
                        {OTHER_KINDS[k].label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {/*
                KIND REMOVED FROM THE EDITOR (user 2026-11-05: "why is it in
                every leave edit — if not needed remove it"). A type's kind —
                leave (days), compensatory off (earned, then booked), short time
                off (hours) — is fixed for its life: CL/SL/EL/LOP/OD are leave,
                CO comp-off, PER permission. The draft keeps what is stored, so
                an edit never changes it, and a NEW type is a leave type (the
                default). The list's Kind column still shows it.
              */}
              {/*
                COLOUR AND ORDER REMOVED (user 2026-11-05: "remove the colour and
                order everywhere in the Time Off setup"). The draft still carries
                what is stored, so a save keeps a type's colour (the calendar's
                dots read it) and its place in the lists; a new type takes the
                default colour and order 0.
              */}
              {/* Available to and Gender share the first line (user 2026-11-05). */}
              <Field label="Available to" w="term">
                <Select value={str("applies_to")} onChange={(e) => set("applies_to", e.target.value)}>
                  <option value="both">Staff & workers</option>
                  <option value="staff">Staff only</option>
                  <option value="workers">Workers only</option>
                </Select>
              </Field>
              <Field label="Gender" w="code">
                <Select value={str("applicable_gender")} onChange={(e) => set("applicable_gender", e.target.value)}>
                  <option value="any">Any</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                </Select>
              </Field>
            </FieldRow>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Toggle checked={bool("is_paid")} onChange={(v) => set("is_paid", v)} label="Paid leave" />
              {cat !== "short_time_off" && (
                <>
                  <Toggle checked={bool("allow_half_day")} onChange={(v) => set("allow_half_day", v)} label="Half day allowed" />
                  {/* On the second line with the other switches (user 2026-11-05: "allowance limited by in 2nd row"). */}
                  {cat === "leave" && (
                    <Toggle checked={bool("track_balance")} onChange={(v) => set("track_balance", v)} label="Limited by a balance" />
                  )}
                  {/*
                    "Don't count Sundays" and "Don't count holidays" REMOVED as
                    switches (user 2026-11-05). Both stay ON — every type held
                    them on that day, the draft keeps what is stored and a new
                    type defaults to on — so a leave over a Sunday or a holiday
                    still does not count those days. Only the choice is gone.
                  */}
                </>
              )}
            </div>
          </Section>

          {cat === "leave" && bool("track_balance") && (
            <Section title="Allowance">
                <FieldRow>
                  <Field label="Days a year" w="hug">
                    <Input type="number" min="0" step="0.5" value={str("default_entitled_days")} onChange={(e) => set("default_entitled_days", e.target.value)} />
                  </Field>
                  <Field label="Earned" w="code">
                    <Select value={str("accrual_type")} onChange={(e) => set("accrual_type", e.target.value)}>
                      <option value="annual">All at once</option>
                      <option value="monthly">Each month</option>
                    </Select>
                  </Field>
                  {str("accrual_type") === "monthly" && (
                    <Field label="Days a month" w="hug" required>
                      <Input type="number" min="0.25" step="0.25" value={str("accrual_rate")} onChange={(e) => set("accrual_rate", e.target.value)} />
                    </Field>
                  )}
                </FieldRow>
            </Section>
          )}

          {/*
            RULES REMOVED (user 2026-11-05: "the rules itself, the 3 boxes, no
            need — remove it from all the places"). Notice (days), Most days at
            a time and Cap per / Most days are gone from the editor. Every type
            held them empty (0 · none · no cap) that day, so nothing is still
            enforced unseen; the columns stay in the table and the draft still
            carries what is stored, so a save never changes them. Every time
            off is applied in advance regardless (0798's trigger).
            What was left in the section — carry forward and encashment — keeps
            it, under a title that says what it is.
          */}
          {cat === "leave" && bool("track_balance") && (
            <Section title="Carry forward & encashment">
                <>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <Toggle checked={bool("allow_carry_forward")} onChange={(v) => set("allow_carry_forward", v)} label="Carry forward to next year" />
                    <Toggle checked={bool("is_encashable")} onChange={(v) => set("is_encashable", v)} label="Encashable" />
                  </div>
                  <FieldRow>
                    {bool("allow_carry_forward") && (
                      <Field label="Most carried" w="hug">
                        <Input type="number" min="0" step="0.5" value={str("max_carry_forward_days")} onChange={(e) => set("max_carry_forward_days", e.target.value)} />
                      </Field>
                    )}
                    {bool("is_encashable") && (
                      <Field label="Most encashed / year" w="hug">
                        <Input type="number" min="0.5" step="0.5" value={str("max_encashable_days")} onChange={(e) => set("max_encashable_days", e.target.value)} />
                      </Field>
                    )}
                  </FieldRow>
                </>
            </Section>
          )}

          {cat === "short_time_off" && (
            <Section title="Permission limits">
              <FieldRow>
                <Field label="Shortest (min)" w="hug">
                  <Input type="number" min="1" value={str("sto_min_minutes")} onChange={(e) => set("sto_min_minutes", e.target.value)} />
                </Field>
                <Field label="Longest (min)" w="hug">
                  <Input type="number" min="1" value={str("sto_max_minutes")} onChange={(e) => set("sto_max_minutes", e.target.value)} />
                </Field>
                <Field label="Limit by" w="code">
                  <Select value={str("sto_limit_mode")} onChange={(e) => set("sto_limit_mode", e.target.value)}>
                    <option value="none">No limit</option>
                    <option value="count">Number of times</option>
                    <option value="minutes">Total minutes</option>
                  </Select>
                </Field>
                {str("sto_limit_mode") !== "none" && (
                  <Field label="Per" w="hug">
                    <Select value={str("sto_limit_period")} onChange={(e) => set("sto_limit_period", e.target.value)}>
                      <option value="month">Month</option>
                      <option value="year">Year</option>
                    </Select>
                  </Field>
                )}
                {str("sto_limit_mode") === "count" && (
                  <Field label="Times" w="num" required>
                    <Input type="number" min="1" value={str("sto_max_requests")} onChange={(e) => set("sto_max_requests", e.target.value)} />
                  </Field>
                )}
                {str("sto_limit_mode") === "minutes" && (
                  <Field label="Minutes" w="hug" required>
                    <Input type="number" min="1" value={str("sto_total_minutes")} onChange={(e) => set("sto_total_minutes", e.target.value)} />
                  </Field>
                )}
              </FieldRow>
            </Section>
          )}
        </div>
      </Sheet>
    </div>
  );
}

// ─── Leave years ───────────────────────────────────────────────────────────

function YearsTab({ years, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ name: "", start_date: "", end_date: "", is_closed: false });
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);

  function openEdit(y?: LeaveYear) {
    setEditId(y?.id ?? null);
    setD(y ? { name: y.name, start_date: y.start_date, end_date: y.end_date, is_closed: y.is_closed } : { name: "", start_date: "", end_date: "", is_closed: false });
    setDirty(false);
    setOpen(true);
  }
  const put = (patch: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function save() {
    startTransition(async () => {
      const r = await saveYear(editId, d);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success("Leave year saved");
      router.refresh();
    });
  }

  const columns: Column<LeaveYear>[] = [
    { header: "Year", cell: (y) => <span className="text-sm font-medium">{y.name}</span> },
    { header: "From", cell: (y) => <span className="text-sm tabular-nums">{fmtDate(y.start_date)}</span> },
    { header: "To", cell: (y) => <span className="text-sm tabular-nums">{fmtDate(y.end_date)}</span> },
  ];
  const statusColumn: Column<LeaveYear> = {
    header: "Status",
    cell: (y) => <StatusPill tone={y.is_closed ? "neutral" : "success"}>{y.is_closed ? "Closed" : "Open"}</StatusPill>,
  };
  const actions = rowActionsColumn<LeaveYear>((y) => (
    <RowActions label={y.name} onEdit={() => openEdit(y)} canEdit={canEdit} canDelete={false} />
  ));

  return (
    <div className="space-y-4 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-xs text-muted-foreground">
          Balances reset each leave year. Years cannot overlap. A closed year takes no new requests or changes.
        </span>
        {canEdit && <Button onClick={() => openEdit()}>+ Add Leave Year</Button>}
      </div>
      <DataTable
        columns={[...withCreatedColumns(columns, years), statusColumn, actions]}
        rows={years}
        getKey={(y) => y.id}
        empty="No leave years yet."
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.name}` : "New leave year"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !d.name.trim() || !d.start_date || !d.end_date} onClick={save}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input value={d.name} placeholder="2027-28" onChange={(e) => put({ name: e.target.value })} />
          </Field>
          <FieldRow>
            <Field label="From" w="code" required>
              <Input type="date" value={d.start_date} onChange={(e) => put({ start_date: e.target.value })} />
            </Field>
            <Field label="To" w="code" required>
              <Input type="date" value={d.end_date} onChange={(e) => put({ end_date: e.target.value })} />
            </Field>
          </FieldRow>
          {editId && <Toggle checked={d.is_closed} onChange={(v) => put({ is_closed: v })} label="Closed" />}
        </div>
      </Sheet>
    </div>
  );
}

// ─── Blackout dates ────────────────────────────────────────────────────────

function BlackoutsTab({ blackouts, types, locations, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const blank = { name: "", start_date: "", end_date: "", leave_type_id: "", location_id: "", reason: "" };
  const [d, setD] = useState(blank);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  function openEdit(b?: Blackout) {
    setEditId(b?.id ?? null);
    setD(
      b
        ? {
            name: b.name,
            start_date: b.start_date,
            end_date: b.end_date,
            leave_type_id: b.leave_type_id ?? "",
            location_id: b.location_id ?? "",
            reason: b.reason ?? "",
          }
        : blank,
    );
    setDirty(false);
    setOpen(true);
  }
  const put = (patch: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function save() {
    startTransition(async () => {
      const r = await saveBlackout(editId, {
        name: d.name,
        start_date: d.start_date,
        end_date: d.end_date,
        leave_type_id: d.leave_type_id || null,
        location_id: d.location_id || null,
        reason: d.reason,
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success("Blackout saved");
      router.refresh();
    });
  }
  function remove(b: Blackout) {
    startTransition(async () => {
      const r = await deleteBlackout(b.id);
      if (!r.ok) toastError(r.error);
      else {
        success("Deleted");
        router.refresh();
      }
    });
  }

  const columns: Column<Blackout>[] = [
    { header: "Name", cell: (b) => <span className="text-sm font-medium">{b.name}</span> },
    { header: "From", cell: (b) => <span className="text-sm tabular-nums">{fmtDate(b.start_date)}</span> },
    { header: "To", cell: (b) => <span className="text-sm tabular-nums">{fmtDate(b.end_date)}</span> },
    { header: "Leave Type", cell: (b) => <span className="text-sm">{b.leave_type_id ? (typeName.get(b.leave_type_id) ?? "—") : "Every type"}</span> },
    { header: "Unit", cell: (b) => <span className="text-sm">{b.location_id ? (locName.get(b.location_id) ?? "—") : "Every unit"}</span> },
  ];
  const actions = rowActionsColumn<Blackout>((b) => (
    <RowActions
      label={b.name}
      onEdit={() => openEdit(b)}
      canEdit={canEdit}
      onDelete={() => remove(b)}
      canDelete={canDelete}
      isPending={isPending}
    />
  ));

  return (
    <div className="space-y-4 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-xs text-muted-foreground">
          No leave can be applied for on these dates — peak shipment weeks, audits, stock-taking.
        </span>
        {canEdit && <Button onClick={() => openEdit()}>+ Add Blackout</Button>}
      </div>
      <DataTable
        columns={[...withCreatedColumns(columns, blackouts), actions]}
        rows={blackouts}
        getKey={(b) => b.id}
        empty="No blackout dates."
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.name}` : "New blackout"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !d.name.trim() || !d.start_date || !d.end_date} onClick={save}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input value={d.name} onChange={(e) => put({ name: e.target.value })} />
          </Field>
          <FieldRow>
            <Field label="From" w="code" required>
              <Input type="date" value={d.start_date} onChange={(e) => put({ start_date: e.target.value })} />
            </Field>
            <Field label="To" w="code" required>
              <Input type="date" min={d.start_date} value={d.end_date} onChange={(e) => put({ end_date: e.target.value })} />
            </Field>
          </FieldRow>
          <Field label="Leave type">
            <Select value={d.leave_type_id} onChange={(e) => put({ leave_type_id: e.target.value })}>
              <option value="">Every type</option>
              {types
                .filter((t) => t.is_active || t.id === d.leave_type_id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Unit">
            <Select value={d.location_id} onChange={(e) => put({ location_id: e.target.value })}>
              <option value="">Every unit</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason">
            <Textarea rows={2} value={d.reason} onChange={(e) => put({ reason: e.target.value })} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}

// ─── Approval flow (0817) ──────────────────────────────────────────────────

const STAGES = [
  { label: "Department HOD", who: "The head of the person's department. No HOD named, or the HOD is the one on leave → the HR Manager takes it." },
  { label: "HR Manager", who: "Whoever holds the HR Manager role. Nobody does → the Managing Director." },
  { label: "ED", who: "The owner — the login holding Managing Director. Only after the ED approves is it approved." },
];

/**
 * Every leave, permission, on duty, comp-off booking and encashment goes
 * Department HOD → HR Manager → ED (user 2026-11-05). The three steps are the
 * engine's flow (0817); what HR sets here is who heads each department. An HOD
 * acts with their own login — the one whose e-mail is on their staff record.
 */
function FlowTab({ heads, hodOptions, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  useUnsavedGuard(isPending);
  const named = heads.filter((h) => h.hod_staff_id).length;

  function pick(h: DepartmentHead, staffId: string) {
    startTransition(async () => {
      const r = await saveDepartmentHead(h.department_id, staffId || null);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(staffId ? `HOD of ${h.department_name} saved` : `${h.department_name} has no HOD now`);
      router.refresh();
    });
  }

  const columns: Column<DepartmentHead>[] = [
    { header: "Department", cell: (h) => <span className="text-sm font-medium">{h.department_name}</span> },
    {
      header: "HOD",
      cell: (h) => {
        const own = hodOptions.filter((o) => o.department_id === h.department_id);
        const rest = hodOptions.filter((o) => o.department_id !== h.department_id);
        const label = (o: HodOption) => (o.code ? `${o.name} (${o.code})` : o.name);
        return (
          <Select
            aria-label={`HOD of ${h.department_name}`}
            className="w-full max-w-sm"
            value={h.hod_staff_id ?? ""}
            disabled={!canEdit || isPending}
            onChange={(e) => pick(h, e.target.value)}
          >
            <option value="">No HOD — HR Manager approves</option>
            {own.length > 0 && (
              <optgroup label="In this department">
                {own.map((o) => (
                  <option key={o.id} value={o.id} data-person={`staff:${o.id}`}>
                    {label(o)}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={own.length ? "Other departments" : "Staff"}>
              {rest.map((o) => (
                <option key={o.id} value={o.id} data-person={`staff:${o.id}`}>
                  {label(o)}
                </option>
              ))}
            </optgroup>
          </Select>
        );
      },
    },
  ];

  return (
    <div className="space-y-4 pt-3">
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {STAGES.map((st, i) => (
          <li key={st.label} className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span className="text-sm font-semibold">{st.label}</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{st.who}</p>
          </li>
        ))}
      </ol>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Department HODs · {named} of {heads.length} named
      </h3>
      {/* paginate={false}: the whole set of departments is one setting, not a listing to page through. */}
      <DataTable columns={columns} rows={heads} getKey={(h) => h.department_id} empty="No departments yet." paginate={false} />
    </div>
  );
}
