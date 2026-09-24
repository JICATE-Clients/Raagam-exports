"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtDateTimeMs, fmtMoney } from "@/lib/format";
import {
  abandonFine,
  deleteFineDraft,
  loadFineDetail,
  saveFineDraft,
  submitFine,
} from "@/lib/hr/fines-actions";
import {
  FINE_EVENT_LABELS,
  FINE_MODE_LABELS,
  FINE_MODES,
  FINE_STATUSES,
  FINE_STATUS_LABELS,
  FINE_STATUS_TONES,
  previewFineAmount,
  type FineEvent,
  type FineMode,
  type FineStatus,
  type HrFine,
  type StaffOption,
} from "@/lib/hr/fines-types";

/**
 * Pay ▸ Fines & Deductions (0629, doc/order/punishment fine.md).
 *
 * "SAFETY FIRST" (§3): a fine is entered as a DRAFT with no payroll effect, and
 * reaches the approver only through the confirmation modal — YES/NO defaulting
 * to NO, Submit disabled until YES. Every rule the screen shows is also a rule
 * the database enforces; the screen only says it sooner.
 */

type Props = {
  rows: HrFine[];
  staff: StaffOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type Draft = {
  staff_id: string;
  incident_ref: string;
  incident_date: string;
  deduction_month: string; // YYYY-MM
  deduction_mode: FineMode;
  fine_amount: string;
  days_of_pay: string;
  pct_of_gross: string;
  remarks: string;
};

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function blankDraft(): Draft {
  return {
    staff_id: "",
    incident_ref: "",
    incident_date: "",
    deduction_month: thisMonth(),
    deduction_mode: "direct",
    fine_amount: "",
    days_of_pay: "",
    pct_of_gross: "",
    remarks: "",
  };
}

function draftOf(f: HrFine): Draft {
  return {
    staff_id: f.staff_id,
    incident_ref: f.incident_ref,
    incident_date: f.incident_date,
    deduction_month: f.deduction_month.slice(0, 7),
    deduction_mode: f.deduction_mode,
    fine_amount: f.deduction_mode === "direct" ? String(f.fine_amount) : "",
    days_of_pay: f.days_of_pay == null ? "" : String(f.days_of_pay),
    pct_of_gross: f.pct_of_gross == null ? "" : String(f.pct_of_gross),
    remarks: f.remarks,
  };
}

function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function modeDetail(f: Pick<HrFine, "deduction_mode" | "days_of_pay" | "pct_of_gross">): string {
  if (f.deduction_mode === "days") return `${f.days_of_pay} day(s) of pay`;
  if (f.deduction_mode === "percent") return `${f.pct_of_gross}% of gross`;
  return "Direct";
}

export function FinesScreen({ rows, staff, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [statusFilter, setStatusFilter] = useState<"" | FineStatus>("");
  const visible = useMemo(
    () => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows),
    [rows, statusFilter],
  );

  // ── editor ──
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((editorOpen && dirty) || isPending);

  // ── confirmation modal ──
  const [confirmFor, setConfirmFor] = useState<HrFine | null>(null);
  const [confirmed, setConfirmed] = useState<"no" | "yes">("no");

  // ── abandon ──
  const [abandonFor, setAbandonFor] = useState<HrFine | null>(null);
  const [abandonReason, setAbandonReason] = useState("");

  // ── view ──
  const [viewFor, setViewFor] = useState<HrFine | null>(null);
  // Keyed by the fine it belongs to: a late answer for a fine the operator
  // has since closed must not paint its trail under another one.
  const [detail, setDetail] = useState<(Awaited<ReturnType<typeof loadFineDetail>> & { id: string }) | null>(null);

  function openNew() {
    setEditId(null);
    setDraft(blankDraft());
    setDirty(false);
    setEditorOpen(true);
  }
  useCreateIntent(() => {
    if (canCreate) openNew();
  });

  function openEdit(f: HrFine) {
    setEditId(f.id);
    setDraft(draftOf(f));
    setDirty(false);
    setEditorOpen(true);
  }

  function openView(f: HrFine) {
    setViewFor(f);
    loadFineDetail(f.id).then((d) => setDetail({ ...d, id: f.id }));
  }
  useOpenIntent((id) => {
    const f = rows.find((r) => r.id === id);
    if (f) openView(f);
  });

  function openConfirm(f: HrFine) {
    setConfirmed("no"); // §3: the toggle ALWAYS starts at NO
    setConfirmFor(f);
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  const staffOf = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const pickedStaff = draft.staff_id ? staffOf.get(draft.staff_id) : undefined;
  const preview = previewFineAmount({
    mode: draft.deduction_mode,
    salary: pickedStaff?.monthly_salary ?? 0,
    month: draft.deduction_month,
    amount: Number(draft.fine_amount) || null,
    days: Number(draft.days_of_pay) || null,
    pct: Number(draft.pct_of_gross) || null,
  });

  const staffOptions = useMemo(
    () => staff.map((s) => ({ value: s.id, label: s.name, search: s.code ?? undefined })),
    [staff],
  );

  const draftProblem = (() => {
    if (!draft.staff_id) return "Pick the staff member";
    if (!draft.incident_ref.trim()) return "Enter the incident reference";
    if (!draft.incident_date) return "Enter the incident date";
    if (!/^\d{4}-\d{2}$/.test(draft.deduction_month)) return "Pick the deduction month";
    if (draft.deduction_mode !== "direct" && !((pickedStaff?.monthly_salary ?? 0) > 0))
      return "This staff member has no monthly salary — use a direct amount";
    if (!(preview && preview > 0)) return "The fine amount must be greater than zero";
    if (!draft.remarks.trim()) return "Remarks are mandatory";
    return null;
  })();

  function save(thenSubmit: boolean) {
    startTransition(async () => {
      const r = await saveFineDraft(editId, {
        staff_id: draft.staff_id,
        incident_ref: draft.incident_ref,
        incident_date: draft.incident_date,
        deduction_month: draft.deduction_month,
        deduction_mode: draft.deduction_mode,
        fine_amount: Number(draft.fine_amount) || null,
        days_of_pay: Number(draft.days_of_pay) || null,
        pct_of_gross: Number(draft.pct_of_gross) || null,
        remarks: draft.remarks,
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setEditorOpen(false);
      success("Fine saved as draft — no effect on payroll until it is approved");
      router.refresh();
      if (thenSubmit && r.id) {
        const staffRow = staffOf.get(draft.staff_id);
        // The row is not in `rows` until the refresh lands, so the modal is
        // fed from what was just saved; the server re-reads the stored row.
        openConfirm({
          id: r.id,
          code: null,
          staff_id: draft.staff_id,
          staff_name: staffRow?.name ?? null,
          staff_code: staffRow?.code ?? null,
          incident_ref: draft.incident_ref.trim().toUpperCase(),
          incident_date: draft.incident_date,
          deduction_month: `${draft.deduction_month}-01`,
          deduction_mode: draft.deduction_mode,
          days_of_pay: Number(draft.days_of_pay) || null,
          pct_of_gross: Number(draft.pct_of_gross) || null,
          basis_salary: staffRow?.monthly_salary ?? null,
          fine_amount: preview ?? 0,
          status: "draft",
          is_submitted: false,
          remarks: draft.remarks.trim().toUpperCase(),
          decision_remark: null,
          submitted_at: null,
          approved_by: null,
          approver_name: null,
          approved_at: null,
          decided_at: null,
          created_by: null,
          created_at: "",
          updated_at: "",
        });
      }
    });
  }

  function doSubmit() {
    if (!confirmFor || confirmed !== "yes") return;
    const id = confirmFor.id;
    startTransition(async () => {
      const r = await submitFine(id, true);
      if (r.ok) {
        success("Submitted — locked and sent to the MD / HR Manager for approval");
        setConfirmFor(null);
        router.refresh();
      } else toastError(r.error);
    });
  }

  function doAbandon() {
    if (!abandonFor) return;
    const id = abandonFor.id;
    startTransition(async () => {
      const r = await abandonFine(id, abandonReason);
      if (r.ok) {
        success("Fine abandoned — kept for the audit, excluded from payroll");
        setAbandonFor(null);
        setAbandonReason("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  function doDelete(f: HrFine) {
    startTransition(async () => {
      const r = await deleteFineDraft(f.id);
      if (r.ok) {
        success("Draft deleted");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<HrFine>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Staff", cell: (r) => <span className="text-sm">{r.staff_name ?? "—"}</span> },
    { header: "Incident", cell: (r) => <span className="text-sm">{r.incident_ref} · {fmtDate(r.incident_date)}</span> },
    { header: "Month", cell: (r) => <span className="text-sm">{monthLabel(r.deduction_month)}</span> },
    { header: "Basis", cell: (r) => <span className="text-sm">{modeDetail(r)}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="tabular-nums text-sm font-medium">{fmtMoney(r.fine_amount)}</span> },
  ];

  const statusColumn: Column<HrFine> = {
    header: "Status",
    cell: (r) => <StatusPill tone={FINE_STATUS_TONES[r.status]}>{FINE_STATUS_LABELS[r.status]}</StatusPill>,
  };

  const actions = rowActionsColumn<HrFine>((r) => (
    <RowActions
      label={r.code}
      onView={() => openView(r)}
      onEdit={() => openEdit(r)}
      canEdit={canEdit && r.status === "draft"}
      onDelete={() => doDelete(r)}
      canDelete={canDelete && r.status === "draft"}
      isPending={isPending}
      menu={[
        ...(r.status === "draft" && (canCreate || canEdit)
          ? [{ label: "Submit for approval…", onClick: () => openConfirm(r) }]
          : []),
        ...((r.status === "draft" || r.status === "pending") && canEdit
          ? [{ label: "Abandon…", danger: true, onClick: () => { setAbandonReason(""); setAbandonFor(r); } }]
          : []),
      ]}
    />
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select
            aria-label="Status"
            className="h-9 w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | FineStatus)}
          >
            <option value="">All statuses</option>
            {FINE_STATUSES.map((s) => (
              <option key={s} value={s}>{FINE_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/hr/fines/register" className={buttonClasses({ variant: "outline" })}>
            Fine Summary Report
          </Link>
          {canCreate && <Button onClick={openNew}>+ Add Fine</Button>}
        </div>
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(r) => r.id}
        empty="No fines yet."
      />

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      <Sheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editId ? "Edit fine (draft)" : "New fine"}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {draftProblem ?? "Saved as a draft — no effect on payroll until approved."}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button variant="outline" disabled={isPending || !!draftProblem} onClick={() => save(false)}>
                Save draft
              </Button>
              <Button disabled={isPending || !!draftProblem} onClick={() => save(true)}>
                Save &amp; submit…
              </Button>
            </div>
          </div>
        }
      >
        {/* 288 staff + 144 ref + 144 date + 144 month + 3×12 gaps = 756px → cap 48rem */}
        <div className="max-w-[48rem] space-y-4">
          <FieldRow>
            <Field label="Staff" w="name" required>
              <Combobox
                options={staffOptions}
                value={draft.staff_id}
                onChange={(v) => set("staff_id", v)}
              />
            </Field>
            <Field label="Incident Ref" w="code" required>
              <Input value={draft.incident_ref} onChange={(e) => set("incident_ref", e.target.value)} />
            </Field>
            <Field label="Incident Date" w="code" required>
              <Input type="date" value={draft.incident_date} onChange={(e) => set("incident_date", e.target.value)} />
            </Field>
            <Field label="Deduction Month" w="code" required>
              <Input type="month" value={draft.deduction_month} onChange={(e) => set("deduction_month", e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Deduction">
              <Segmented
                name="fine-mode"
                value={draft.deduction_mode}
                onChange={(v) => set("deduction_mode", v)}
                options={FINE_MODES.map((m) => ({ value: m, label: FINE_MODE_LABELS[m] }))}
              />
            </Field>
            {/* DIRECT vs CALCULATED (§3): direct shows only the amount; a
                calculated mode hides it and shows its own input plus the
                derived figure, which the database recomputes on save. */}
            {draft.deduction_mode === "direct" && (
              <Field label="Amount (₹)" w="code" required>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={draft.fine_amount}
                  onChange={(e) => set("fine_amount", e.target.value)}
                />
              </Field>
            )}
            {draft.deduction_mode === "days" && (
              <Field label="Days of Pay" w="num" required>
                <Input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={draft.days_of_pay}
                  onChange={(e) => set("days_of_pay", e.target.value)}
                />
              </Field>
            )}
            {draft.deduction_mode === "percent" && (
              <Field label="% of Gross" w="num" required>
                <Input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={draft.pct_of_gross}
                  onChange={(e) => set("pct_of_gross", e.target.value)}
                />
              </Field>
            )}
            {draft.deduction_mode !== "direct" && (
              <Field
                label="Amount (₹)"
                w="code"
                hint={pickedStaff ? `Salary ${fmtMoney(pickedStaff.monthly_salary)} / month` : undefined}
              >
                <Input readOnly value={preview == null ? "" : preview.toFixed(2)} />
              </Field>
            )}
          </FieldRow>

          <Field label="Remarks" required hint="Mandatory — the reason for the fine. It prints on the Fine Summary Report.">
            <Textarea rows={3} value={draft.remarks} onChange={(e) => set("remarks", e.target.value)} />
          </Field>
        </div>
      </Sheet>

      {/* ── Confirmation modal (§3) ────────────────────────────────────── */}
      <Sheet
        open={!!confirmFor}
        onClose={() => setConfirmFor(null)}
        title="Confirm fine"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmFor(null)}>Cancel</Button>
            <Button disabled={isPending || confirmed !== "yes"} onClick={doSubmit}>
              {isPending ? "Submitting…" : "Submit for approval"}
            </Button>
          </div>
        }
      >
        {confirmFor && (
          <div className="space-y-3 text-sm">
            <dl className="space-y-1">
              <Fact label="Staff" className="font-medium">
                {confirmFor.staff_name ?? "—"}
                {confirmFor.staff_code ? <span className="ml-1 font-mono text-xs text-muted-foreground">{confirmFor.staff_code}</span> : null}
              </Fact>
              <Fact label="Incident">{confirmFor.incident_ref} · {fmtDate(confirmFor.incident_date)}</Fact>
              <Fact label="Deduction month">{monthLabel(confirmFor.deduction_month)}</Fact>
              <Fact label="Amount" className="font-semibold tabular-nums">{fmtMoney(confirmFor.fine_amount)} <span className="font-normal text-muted-foreground">({modeDetail(confirmFor)})</span></Fact>
              <Fact label="Remarks" className="whitespace-pre-wrap">{confirmFor.remarks}</Fact>
            </dl>
            <p className="text-xs text-muted-foreground">
              Once submitted the fine is locked and goes to the MD / HR Manager. It is deducted from salary only after
              they approve it.
            </p>
            <Field label="I have checked the Staff ID and the Amount">
              <Segmented
                name="fine-confirm"
                value={confirmed}
                onChange={setConfirmed}
                options={[
                  { value: "no", label: "NO" },
                  { value: "yes", label: "YES" },
                ]}
              />
            </Field>
          </div>
        )}
      </Sheet>

      {/* ── Abandon ────────────────────────────────────────────────────── */}
      <Sheet
        open={!!abandonFor}
        onClose={() => setAbandonFor(null)}
        title={`Abandon ${abandonFor?.code ?? "fine"}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAbandonFor(null)}>Keep it</Button>
            <Button variant="danger" disabled={isPending || !abandonReason.trim()} onClick={doAbandon}>
              Abandon fine
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            {abandonFor?.status === "pending"
              ? "This withdraws the fine from the approver's queue."
              : "The draft is closed."}{" "}
            The record stays for the audit and is never deducted.
          </p>
          <Field label="Reason" required>
            <Textarea rows={2} value={abandonReason} onChange={(e) => setAbandonReason(e.target.value)} />
          </Field>
        </div>
      </Sheet>

      {/* ── View: record, approval, audit log ──────────────────────────── */}
      <Sheet
        open={!!viewFor}
        onClose={() => setViewFor(null)}
        title={viewFor ? `${viewFor.code ?? "Fine"} — ${viewFor.staff_name ?? ""}` : "Fine"}
        size="md"
      >
        {viewFor && (
          <div className="space-y-5 text-sm">
            <div className="flex items-center gap-2">
              <StatusPill tone={FINE_STATUS_TONES[viewFor.status]}>{FINE_STATUS_LABELS[viewFor.status]}</StatusPill>
              {viewFor.status !== "draft" && <span className="text-xs text-muted-foreground">Locked — read-only record</span>}
            </div>
            <dl className="space-y-1">
              <Fact label="Incident">{viewFor.incident_ref} · {fmtDate(viewFor.incident_date)}</Fact>
              <Fact label="Deduction month">{monthLabel(viewFor.deduction_month)}</Fact>
              <Fact label="Basis">
                {modeDetail(viewFor)}
                {viewFor.basis_salary ? ` of ${fmtMoney(viewFor.basis_salary)}` : ""}
              </Fact>
              <Fact label="Amount" className="font-semibold tabular-nums">{fmtMoney(viewFor.fine_amount)}</Fact>
              <Fact label="Remarks" className="whitespace-pre-wrap">{viewFor.remarks}</Fact>
              {viewFor.approver_name && (
                <>
                  <Fact label="Approved by">{viewFor.approver_name} · {fmtDateTimeMs(viewFor.approved_at)}</Fact>
                </>
              )}
              {viewFor.decision_remark && (
                <>
                  <Fact label="Decision note" className="whitespace-pre-wrap">{viewFor.decision_remark}</Fact>
                </>
              )}
            </dl>

            {detail?.id === viewFor.id && detail.panel.run && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline
                  rows={detail.panel.timeline}
                  resolveUserName={(id) => detail.panel.names[id]}
                />
                {detail.panel.verdict && (
                  <ApprovalActionBar run={detail.panel.run} verdict={detail.panel.verdict} subjectPath="/hr/fines" onDone={() => setViewFor(null)} />
                )}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit log</h3>
              {detail?.id !== viewFor.id ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <AuditLog events={detail.events} />
              )}
            </section>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** One label/value line of a record summary. */
function Fact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={className}>{children}</dd>
    </div>
  );
}

function AuditLog({ events }: { events: FineEvent[] }) {
  if (events.length === 0) return <p className="text-muted-foreground">No events recorded.</p>;
  return (
    <ol className="space-y-1.5">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmtDateTimeMs(e.created_at)}</span>
          <span className="font-medium">{FINE_EVENT_LABELS[e.change_type] ?? e.change_type}</span>
          <span className="text-muted-foreground">{e.actor_name ?? "—"}</span>
          {e.fine_amount != null && <span className="tabular-nums text-muted-foreground">{fmtMoney(e.fine_amount)}</span>}
          {e.remark && <span className="text-muted-foreground">— {e.remark}</span>}
        </li>
      ))}
    </ol>
  );
}
