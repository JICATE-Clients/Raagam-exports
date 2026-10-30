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
  saveLeaveType,
  saveYear,
} from "@/lib/hr/timeoff-actions";
import {
  CATEGORY_LABELS,
  REQUEST_CATEGORIES,
  fmtDays,
  fmtMinutes,
  type Blackout,
  type LeaveType,
  type LeaveTypeInput,
  type LeaveYear,
  type RequestCategory,
} from "@/lib/hr/timeoff-types";
import { TypeDot } from "./shared";

/**
 * HR ▸ Time Off ▸ Leave Setup (0770, MyJKKN §9.4 / `admin/leave-types`,
 * `admin/academic-years`, and the blackout table MyJKKN never gave a screen).
 * Three tabs: Leave Types, Leave Years, Blackout Dates.
 */

type Props = {
  types: LeaveType[];
  years: LeaveYear[];
  blackouts: Blackout[];
  locations: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
};

export function SetupScreen(props: Props) {
  return (
    <Tabs
      items={[
        { key: "types", label: "Leave Types", content: <TypesTab {...props} /> },
        { key: "years", label: "Leave Years", content: <YearsTab {...props} /> },
        { key: "blackouts", label: "Blackout Dates", content: <BlackoutsTab {...props} /> },
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

function TypesTab({ types, canEdit, canDelete }: Props) {
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
    setD(typeDraft(t));
    setDirty(false);
    setOpen(true);
  }
  function save() {
    startTransition(async () => {
      const r = await saveLeaveType(editId, typePayload(d));
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success("Leave type saved");
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
    { header: "Name", cell: (t) => <TypeDot color={t.color}>{t.name}</TypeDot> },
    { header: "Kind", cell: (t) => <span className="text-sm">{CATEGORY_LABELS[t.request_category]}</span> },
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
      <div className="flex justify-end">{canEdit && <Button onClick={() => openEdit()}>+ Add Leave Type</Button>}</div>
      <DataTable
        columns={[...withCreatedColumns(columns, types), statusColumn, actions]}
        rows={types}
        getKey={(t) => t.id}
        empty="No leave types yet."
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${str("name")}` : "New leave type"}
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
        {/* 144 code + 288 name + 176 kind + 88 colour + 72 order + gaps ≈ 830px → cap 56rem */}
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
              <Field label="Kind" w="term">
                <Select value={str("request_category")} onChange={(e) => set("request_category", e.target.value)}>
                  {REQUEST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Colour" w="hug">
                {/* caps-input: exempt -- a colour value, not text */}
                <Input type="color" className="h-9 p-1" value={str("color")} onChange={(e) => set("color", e.target.value)} />
              </Field>
              <Field label="Order" w="num">
                <Input type="number" min="0" value={str("sort_order")} onChange={(e) => set("sort_order", e.target.value)} />
              </Field>
            </FieldRow>
            <FieldRow>
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
                  <Toggle checked={bool("skip_weekends")} onChange={(v) => set("skip_weekends", v)} label="Don't count Sundays" />
                  <Toggle checked={bool("skip_holidays")} onChange={(v) => set("skip_holidays", v)} label="Don't count holidays" />
                </>
              )}
            </div>
          </Section>

          {cat === "leave" && (
            <Section title="Allowance">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Toggle checked={bool("track_balance")} onChange={(v) => set("track_balance", v)} label="Limited by a balance" />
              </div>
              {bool("track_balance") && (
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
              )}
            </Section>
          )}

          {cat !== "short_time_off" && (
            <Section title="Rules">
              <FieldRow>
                <Field label="Notice (days)" w="hug" hint="Asked of the person applying for themself">
                  <Input type="number" min="0" value={str("min_advance_notice_days")} onChange={(e) => set("min_advance_notice_days", e.target.value)} />
                </Field>
                <Field label="Most days at a time" w="hug">
                  <Input type="number" min="0.5" step="0.5" value={str("max_continuous_days")} onChange={(e) => set("max_continuous_days", e.target.value)} />
                </Field>
                {cat === "leave" && (
                  <>
                    <Field label="Cap per" w="code">
                      <Select value={str("limit_period")} onChange={(e) => set("limit_period", e.target.value)}>
                        <option value="none">No cap</option>
                        <option value="month">Month</option>
                        <option value="year">Year</option>
                      </Select>
                    </Field>
                    {str("limit_period") !== "none" && (
                      <Field label="Most days" w="hug" required>
                        <Input type="number" min="0.5" step="0.5" value={str("max_days_per_period")} onChange={(e) => set("max_days_per_period", e.target.value)} />
                      </Field>
                    )}
                  </>
                )}
              </FieldRow>
              {cat === "leave" && bool("track_balance") && (
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
              )}
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
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
          <Field label="Name" required hint="For example 2027-28">
            <Input value={d.name} onChange={(e) => put({ name: e.target.value })} />
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
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
