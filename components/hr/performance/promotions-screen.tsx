"use client";

import { Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/segmented";
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
import { today } from "@/lib/calendar";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { loadPromotionPanel, raisePromotion, withdrawPromotion } from "@/lib/hr/performance-actions";
import {
  designationFitsKind,
  performanceLabel,
  performanceTone,
  type DesignationOption,
  type PersonRole,
  type Promotion,
  type PromotionDraft,
} from "@/lib/hr/performance-types";
import type { PersonOption } from "@/lib/hr/timeoff-types";
import { Fact, ReasonSheet } from "@/components/hr/timeoff/shared";
import { PersonCombobox } from "@/components/hr/lifecycle/shared";

/**
 * HR ▸ Performance & Growth ▸ Promotions (0773, MyJKKN §13.2).
 *
 * HR raises a promotion — the new designation, the date, why, and optionally
 * the approved appraisal behind it — and it goes to the approver. MyJKKN let
 * an applicant score and approve their own application, and approval changed
 * nothing; here only the approver decides, and approving it SETS the person's
 * designation. The salary is not changed: that stays on Pay ▸ Salary Registry.
 */

type Props = {
  rows: Promotion[];
  people: PersonOption[];
  roles: Record<string, PersonRole>;
  designations: DesignationOption[];
  reviews: { id: string; person: string; label: string }[];
  canEdit: boolean;
};

type Scope = "pending_approval" | "done" | "all";

const BLANK = (): PromotionDraft => ({
  person: "",
  to_designation_id: "",
  proposed_salary: "",
  effective_date: today(),
  reason: "",
  review_id: "",
});

function basisWord(b: Promotion["salary_basis"]): string {
  return b === "daily" ? " / day" : " / month";
}

export function PromotionsScreen({ rows, people, roles, designations, reviews, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [scope, setScope] = useState<Scope>("pending_approval");
  const visible =
    scope === "all" ? rows : scope === "done" ? rows.filter((r) => r.status !== "pending_approval") : rows.filter((r) => r.status === scope);

  // ── raise ──
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<PromotionDraft>(BLANK);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<PromotionDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openRaise() {
    setD(BLANK());
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openRaise());
  const person = people.find((p) => p.key === d.person) ?? null;
  const role = d.person ? roles[d.person] : undefined;
  const desigOptions = person
    ? designations.filter((o) => designationFitsKind(o, person.kind) && !o.inactive && o.id !== role?.designation_id)
    : [];
  const personReviews = reviews.filter((r) => r.person === d.person);
  const waiting = person ? rows.some((r) => r.status === "pending_approval" && (r.staff_id ?? r.worker_id) === person.id) : false;
  const problem = !d.person
    ? "Pick the person"
    : waiting
      ? `${person?.name} already has a promotion waiting for approval`
      : !d.to_designation_id
        ? "Pick the new designation"
        : !d.effective_date
          ? "Enter the date it takes effect"
          : !d.reason.trim()
            ? "Say why they are being promoted"
            : null;

  function raise() {
    startTransition(async () => {
      const r = await raisePromotion(d);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success("Sent for approval");
      router.refresh();
    });
  }

  // ── view ──
  const [viewId, setViewId] = useState<string | null>(null);
  const live = viewId ? (rows.find((r) => r.id === viewId) ?? null) : null;
  const [panel, setPanel] = useState<(Awaited<ReturnType<typeof loadPromotionPanel>> & { id: string }) | null>(null);
  function openView(m: Promotion) {
    setViewId(m.id);
    setPanel(null);
    loadPromotionPanel(m.id).then((p) => setPanel({ ...p, id: m.id }));
  }
  useOpenIntent((id) => {
    const m = rows.find((x) => x.id === id);
    if (m) openView(m);
  });

  const [withdrawFor, setWithdrawFor] = useState<Promotion | null>(null);
  function doWithdraw(reason: string) {
    if (!withdrawFor) return;
    const id = withdrawFor.id;
    startTransition(async () => {
      const r = await withdrawPromotion(id, reason);
      if (!r.ok) toastError(r.error);
      else {
        success("Withdrawn");
        setWithdrawFor(null);
        setViewId(null);
        router.refresh();
      }
    });
  }

  const columns: Column<Promotion>[] = [
    { header: "Code", cell: (m) => <span className="font-mono text-xs font-medium">{m.code ?? "—"}</span> },
    {
      header: "Person",
      cell: (m) => (
        <span className="text-sm">
          <span className="font-medium">{m.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {m.person_code ?? ""}
            {m.person_kind === "worker" ? " · Worker" : ""}
          </span>
        </span>
      ),
    },
    {
      header: "Promotion",
      cell: (m) => (
        <span className="text-sm">
          {m.from_designation ?? "—"} <span className="text-muted-foreground">→</span> <span className="font-medium">{m.to_designation}</span>
        </span>
      ),
    },
    { header: "From", cell: (m) => <span className="text-sm tabular-nums">{fmtDate(m.effective_date)}</span> },
    {
      header: "Proposed Pay",
      align: "right",
      cell: (m) => (
        <span className="text-sm tabular-nums">{m.proposed_salary != null ? `${fmtMoney(m.proposed_salary)}${basisWord(m.salary_basis)}` : "—"}</span>
      ),
    },
  ];
  const statusColumn: Column<Promotion> = {
    header: "Status",
    cell: (m) => <StatusPill tone={performanceTone(m.status)}>{performanceLabel(m.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Promotion>((m) => (
    <RowActions
      label={m.person_name}
      onView={() => openView(m)}
      canEdit={false}
      canDelete={false}
      isPending={isPending}
      menu={canEdit && m.status === "pending_approval" ? [{ label: "Withdraw", icon: Undo2, onClick: () => setWithdrawFor(m) }] : []}
    />
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "pending_approval", label: `Awaiting approval (${rows.filter((r) => r.status === "pending_approval").length})` },
            { value: "done", label: "Decided" },
            { value: "all", label: "All" },
          ]}
        />
        {canEdit && <Button onClick={openRaise}>+ Raise Promotion</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(m) => m.id}
        empty={scope === "pending_approval" ? "No promotions waiting for approval." : "No promotions here."}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Raise a promotion"
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={raise}>
                {isPending ? "Sending…" : "Send for approval"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Person" required>
            <PersonCombobox
              people={people}
              value={d.person}
              onChange={(k) => put({ person: k, to_designation_id: "", review_id: reviews.find((r) => r.person === k)?.id ?? "" })}
            />
          </Field>
          {person && (
            <p className="text-muted-foreground">
              Now: <span className="font-medium text-foreground">{role?.designation_name ?? "No designation"}</span>
            </p>
          )}
          <Field label="New designation" required>
            <Select value={d.to_designation_id} disabled={!person} onChange={(e) => put({ to_designation_id: e.target.value })}>
              <option value="" />
              {desigOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <FieldRow>
            <Field label="Takes effect" w="code" required>
              <Input type="date" value={d.effective_date} onChange={(e) => put({ effective_date: e.target.value })} />
            </Field>
            <Field label="Proposed pay (₹)" w="num">
              <Input type="number" min="0" value={d.proposed_salary} onChange={(e) => put({ proposed_salary: e.target.value })} />
            </Field>
          </FieldRow>
          {personReviews.length > 0 && (
            <Field label="Based on appraisal">
              <Select value={d.review_id} onChange={(e) => put({ review_id: e.target.value })}>
                <option value="" />
                {personReviews.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Why" required>
            <Textarea rows={3} value={d.reason} onChange={(e) => put({ reason: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Approving it sets the new designation. The pay is for the approver to see — change the salary itself on{" "}
            {"Pay ▸ Salary Registry"}.
          </p>
        </div>
      </Sheet>

      <Sheet
        open={!!live}
        onClose={() => setViewId(null)}
        title={live ? `${live.code ?? "Promotion"} — ${live.person_name}` : "Promotion"}
        size="sm"
        footer={
          live && canEdit && live.status === "pending_approval" ? (
            <div className="flex justify-end">
              <Button variant="outline" disabled={isPending} onClick={() => setWithdrawFor(live)}>
                Withdraw
              </Button>
            </div>
          ) : undefined
        }
      >
        {live && (
          <div className="space-y-5 text-sm">
            <StatusPill tone={performanceTone(live.status)}>{performanceLabel(live.status)}</StatusPill>
            <dl className="space-y-1">
              <Fact label="Promotion">
                {live.from_designation ?? "No designation"} → {live.to_designation}
              </Fact>
              <Fact label="Takes effect">{fmtDate(live.effective_date)}</Fact>
              <Fact label="Pay" className="tabular-nums">
                {[
                  live.current_salary != null && `now ${fmtMoney(live.current_salary)}${basisWord(live.salary_basis)}`,
                  live.proposed_salary != null && `proposed ${fmtMoney(live.proposed_salary)}${basisWord(live.salary_basis)}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </Fact>
              {live.review_label && <Fact label="Appraisal">{live.review_label}</Fact>}
              <Fact label="Why" className="whitespace-pre-wrap">
                {live.reason}
              </Fact>
              {live.approved_at && <Fact label="Approved">{fmtDateTime(live.approved_at)}</Fact>}
              {live.designation_applied && <Fact label="Designation">Updated on their record</Fact>}
              {live.decision_remark && <Fact label="Approver said">{live.decision_remark}</Fact>}
              {live.withdrawn_reason && <Fact label="Withdrawn">{live.withdrawn_reason}</Fact>}
            </dl>
            {panel?.id === live.id && panel.run && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={panel.timeline} resolveUserName={(id) => panel.names[id]} />
                {panel.verdict && live.status === "pending_approval" && (
                  <ApprovalActionBar
                    run={panel.run}
                    verdict={panel.verdict}
                    subjectPath="/hr/performance/promotions"
                    onDone={() => setViewId(null)}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </Sheet>

      <ReasonSheet
        open={!!withdrawFor}
        busy={isPending}
        onClose={() => setWithdrawFor(null)}
        onConfirm={doWithdraw}
        title={`Withdraw ${withdrawFor?.code ?? ""}`}
        confirmLabel="Withdraw"
        intro="The approval is cancelled and the designation stays as it is."
      />
    </div>
  );
}
