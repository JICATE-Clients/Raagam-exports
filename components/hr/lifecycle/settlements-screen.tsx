"use client";

import { BadgeIndianRupee, Calculator, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/ui/field";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import {
  loadSettlementPanel,
  loadSettlementPrefill,
  markSettlementPaid,
  recallSettlement,
  saveSettlement,
  submitSettlement,
} from "@/lib/hr/lifecycle-actions";
import {
  SEPARATION_LABELS,
  lifecycleLabel,
  lifecycleTone,
  previewSettlement,
  type ExitCase,
  type Settlement,
  type SettlementDraft,
} from "@/lib/hr/lifecycle-types";
import { ReasonSheet } from "@/components/hr/timeoff/shared";

/**
 * HR ▸ Team Lifecycle ▸ Full & Final (0766, MyJKKN §12.5 calculateFnf).
 *
 * Opened for an exit (from the exit, or ?exit=<id>). The form starts from what
 * the records say — basic + DA or the daily wage, the joining date, unused
 * encashable leave from Time Off, outstanding salary advances, recoveries for
 * lost or damaged assets, the notice shortfall — and every figure can be
 * changed. Gratuity, leave encashment and notice recovery are worked out by
 * the database on Save (the screen shows a preview), then the settlement goes
 * to its approver and is marked paid.
 *
 *   gratuity  (basic + DA) × 15 / 26 × completed years, or daily wage × 15 ×
 *             years; none under the minimum service (except death); capped.
 *             A last part-year of 6 months or more counts as a year.
 */

type Props = {
  rows: Settlement[];
  exits: ExitCase[];
  canEdit: boolean;
  gratuity: { min_years: number; cap: number };
};
type Panel = Awaited<ReturnType<typeof loadSettlementPanel>> & { id: string };

const s = (n: number | null | undefined) => (n == null || n === 0 ? "" : String(n));

function draftOf(x: Settlement): SettlementDraft {
  return {
    rated: x.rated,
    basic_da: s(x.basic_da),
    daily_wage: s(x.daily_wage),
    joined_on: x.joined_on ?? "",
    leave_days: s(x.leave_days),
    salary_due: s(x.salary_due),
    bonus_due: s(x.bonus_due),
    other_earnings: s(x.other_earnings),
    notice_short_days: s(x.notice_short_days),
    advance_recovery: s(x.advance_recovery),
    asset_recovery: s(x.asset_recovery),
    other_deductions: s(x.other_deductions),
    note: x.note ?? "",
  };
}

function Line({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={strong ? "flex justify-between border-t border-border pt-2 font-semibold" : "flex justify-between"}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">
        {minus && value ? "− " : ""}
        {fmtMoney(value)}
      </span>
    </div>
  );
}

export function SettlementsScreen({ rows, exits, canEdit, gratuity }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [scope, setScope] = useState<"live" | "all">("live");
  const visible = useMemo(
    () => (scope === "live" ? rows.filter((r) => r.status !== "paid" && r.status !== "rejected") : rows),
    [rows, scope],
  );
  const openExits = exits.filter((e) => e.status === "open");
  const exitsWithout = openExits.filter((e) => !rows.some((r) => r.exit_id === e.id && r.status !== "rejected"));

  // ── editor ──
  const [exitFor, setExitFor] = useState<ExitCase | null>(null);
  const [draft, setDraft] = useState<SettlementDraft | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  useUnsavedGuard((!!exitFor && dirty) || isPending);
  const put = (patch: Partial<SettlementDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  function openEditor(e: ExitCase) {
    const existing = rows.find((r) => r.exit_id === e.id && r.status === "draft");
    setExitFor(e);
    setDirty(false);
    setHint(null);
    if (existing) {
      setDraft(draftOf(existing));
      setSavedId(existing.id);
      return;
    }
    setDraft(null);
    setSavedId(null);
    loadSettlementPrefill(e.id).then((r) => {
      if (!r.ok) {
        toastError(r.error);
        setExitFor(null);
        return;
      }
      const p = r.prefill;
      setDraft({
        rated: p.rated,
        basic_da: s(p.basic_da),
        daily_wage: s(p.daily_wage),
        joined_on: p.joined_on ?? "",
        leave_days: s(p.leave_days),
        salary_due: "",
        bonus_due: "",
        other_earnings: "",
        notice_short_days: s(p.notice_short_days),
        advance_recovery: s(p.advance_recovery),
        asset_recovery: s(p.asset_recovery),
        other_deductions: "",
        note: "",
      });
      setHint(
        [
          p.leave_days ? `${p.leave_days} day(s) of encashable leave unused` : null,
          p.advance_recovery ? `${fmtMoney(p.advance_recovery)} of salary advance outstanding` : null,
          p.asset_recovery ? `${fmtMoney(p.asset_recovery)} for lost / damaged assets` : null,
          p.notice_short_days ? `${p.notice_short_days} day(s) short of the ${p.notice_required}-day notice` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      );
      setDirty(true);
    });
  }

  // ?exit=<id> from the Exits screen.
  const exitParam = params.get("exit");
  useEffect(() => {
    if (!exitParam) return;
    const e = exits.find((x) => x.id === exitParam);
    const timer = window.setTimeout(() => {
      if (e) openEditor(e);
      router.replace(pathname, { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per hand-over
  }, [exitParam]);

  const preview =
    draft && exitFor
      ? previewSettlement(draft, {
          last_working_day: exitFor.last_working_day,
          separation_type: exitFor.separation_type,
          notice_waived: exitFor.notice_waived,
          gratuity_min_years: gratuity.min_years,
          gratuity_cap: gratuity.cap,
        })
      : null;

  function save(thenSubmit: boolean) {
    if (!exitFor || !draft) return;
    const exitId = exitFor.id;
    startTransition(async () => {
      const r = await saveSettlement(exitId, draft);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setSavedId(r.id ?? null);
      setDirty(false);
      if (thenSubmit && r.id) {
        const sub = await submitSettlement(r.id);
        if (!sub.ok) {
          toastError(sub.error);
          router.refresh();
          return;
        }
        success("Sent for approval");
        setExitFor(null);
      } else {
        success("Settlement saved");
      }
      router.refresh();
    });
  }

  // ── view / recall / pay ──
  const [viewFor, setViewFor] = useState<Settlement | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  function openView(x: Settlement) {
    setViewFor(x);
    loadSettlementPanel(x.id).then((p) => setPanel({ ...p, id: x.id }));
  }
  useOpenIntent((id) => {
    const x = rows.find((r) => r.id === id);
    if (x) openView(x);
  });

  const [recallFor, setRecallFor] = useState<Settlement | null>(null);
  function doRecall(reason: string) {
    if (!recallFor) return;
    const id = recallFor.id;
    startTransition(async () => {
      const r = await recallSettlement(id, reason);
      if (!r.ok) toastError(r.error);
      else {
        success("Recalled to draft");
        setRecallFor(null);
        router.refresh();
      }
    });
  }
  const [payFor, setPayFor] = useState<Settlement | null>(null);
  const [payRef, setPayRef] = useState("");
  function doPay() {
    if (!payFor) return;
    const id = payFor.id;
    startTransition(async () => {
      const r = await markSettlementPaid(id, payRef);
      if (!r.ok) toastError(r.error);
      else {
        success("Marked paid");
        setPayFor(null);
        setPayRef("");
        router.refresh();
      }
    });
  }

  const exitOf = (x: Settlement) => exits.find((e) => e.id === x.exit_id) ?? null;

  const columns: Column<Settlement>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    {
      header: "Person",
      cell: (r) => (
        <span className="text-sm">
          <span className="font-medium">{r.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{r.exit_code}</span>
        </span>
      ),
    },
    { header: "Separation", cell: (r) => <span className="text-sm">{SEPARATION_LABELS[r.separation_type]}</span> },
    { header: "Last Day", cell: (r) => <span className="text-sm tabular-nums">{r.last_working_day ? fmtDate(r.last_working_day) : "—"}</span> },
    { header: "Gratuity", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtMoney(r.gratuity)}</span> },
    { header: "Net Payable", align: "right", cell: (r) => <span className="text-sm font-semibold tabular-nums">{fmtMoney(r.net_payable)}</span> },
  ];
  const statusColumn: Column<Settlement> = {
    header: "Status",
    cell: (r) => <StatusPill tone={lifecycleTone(r.status)}>{lifecycleLabel(r.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Settlement>((r) => {
    const e = exitOf(r);
    return (
      <RowActions
        label={r.code}
        onView={() => openView(r)}
        onEdit={e && r.status === "draft" ? () => openEditor(e) : undefined}
        canEdit={canEdit && r.status === "draft" && !!e}
        isPending={isPending}
        menu={[
          ...(canEdit && r.status === "pending" ? [{ label: "Recall to draft…", icon: Undo2, onClick: () => setRecallFor(r) }] : []),
          ...(canEdit && r.status === "approved"
            ? [{ label: "Mark paid…", icon: BadgeIndianRupee, onClick: () => { setPayRef(""); setPayFor(r); } }]
            : []),
          ...(canEdit && r.status === "rejected" && e?.status === "open"
            ? [{ label: "Work it out again", icon: Calculator, onClick: () => openEditor(e) }]
            : []),
        ]}
      />
    );
  });

  const money = (k: keyof SettlementDraft, label: string, hint?: string) =>
    draft && (
      <Field label={label} w="num" hint={hint}>
        <Input type="number" min="0" step="0.01" value={draft[k]} onChange={(e) => put({ [k]: e.target.value })} />
      </Field>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "live", label: "To finish" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {canEdit && exitsWithout.length > 0 && (
        <div className="rounded-control border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
          <span className="font-medium">No settlement yet: </span>
          {exitsWithout.slice(0, 8).map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              {/* button-shape: exempt -- an inline text link inside a sentence */}
              <button type="button" className="text-primary hover:underline" onClick={() => openEditor(e)}>
                {e.person_name}
              </button>
            </span>
          ))}
          {exitsWithout.length > 8 && ` and ${exitsWithout.length - 8} more`}
        </div>
      )}

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(r) => r.id}
        empty={scope === "live" ? "Nothing to finish. Open one from an exit." : "No settlements yet."}
      />

      {/* ── Editor ───────────────────────────────────────────────────────── */}
      <Sheet
        open={!!exitFor}
        onClose={() => setExitFor(null)}
        title={exitFor ? `Full & final — ${exitFor.person_name} (${exitFor.code ?? ""})` : "Full & final"}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {dirty ? "Gratuity, leave and notice are worked out again on Save." : savedId ? "Saved as a draft." : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setExitFor(null)}>
                Cancel
              </Button>
              <Button variant={dirty ? "primary" : "outline"} disabled={isPending || !draft} onClick={() => save(false)}>
                Save draft
              </Button>
              <Button variant={dirty ? "outline" : "primary"} disabled={isPending || !draft} onClick={() => save(true)}>
                {isPending ? "Working…" : "Save & send for approval"}
              </Button>
            </div>
          </div>
        }
      >
        {exitFor && !draft && <p className="text-sm text-muted-foreground">Reading the records…</p>}
        {exitFor && draft && preview && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground">
                {SEPARATION_LABELS[exitFor.separation_type]} · last working day {fmtDate(exitFor.last_working_day)}
                {hint ? ` · ${hint}` : ""}
              </p>
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pay basis</h3>
                <Field label="Paid">
                  <Segmented
                    name="fnf-rated"
                    value={draft.rated}
                    onChange={(v) => put({ rated: v })}
                    options={[
                      { value: "monthly", label: "Monthly" },
                      { value: "daily", label: "Daily wage" },
                    ]}
                  />
                </Field>
                <FieldRow>
                  {draft.rated === "monthly"
                    ? money("basic_da", "Basic + DA a month")
                    : money("daily_wage", "Daily wage")}
                  <Field label="Joined on" w="code">
                    <Input type="date" value={draft.joined_on} onChange={(e) => put({ joined_on: e.target.value })} />
                  </Field>
                </FieldRow>
                <p className="text-xs text-muted-foreground">
                  Service {preview.years} yr {preview.months} mo → {preview.completed} completed year(s).{" "}
                  {preview.eligible
                    ? "Gratuity is due."
                    : `No gratuity under ${gratuity.min_years} years of service.`}
                </p>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earnings</h3>
                <FieldRow>
                  {money("leave_days", "Leave days to encash", "Unused encashable leave")}
                  {money("salary_due", "Salary due (₹)", "Days worked, not yet paid")}
                  {money("bonus_due", "Bonus due (₹)")}
                  {money("other_earnings", "Other (₹)")}
                </FieldRow>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recoveries</h3>
                <FieldRow>
                  {money("notice_short_days", "Notice short (days)", exitFor.notice_waived ? "Waived on the exit" : undefined)}
                  {money("advance_recovery", "Advance (₹)")}
                  {money("asset_recovery", "Assets (₹)")}
                  {money("other_deductions", "Other (₹)")}
                </FieldRow>
              </section>

              <Field label="Note">
                <Textarea rows={2} value={draft.note} onChange={(e) => put({ note: e.target.value })} />
              </Field>
            </div>

            <aside className="h-fit space-y-1.5 rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Settlement</h3>
              <Line label="Gratuity" value={preview.gratuity} />
              <Line label="Leave encashment" value={preview.leave} />
              <Line label="Salary due" value={Number(draft.salary_due) || 0} />
              <Line label="Bonus due" value={Number(draft.bonus_due) || 0} />
              <Line label="Other earnings" value={Number(draft.other_earnings) || 0} />
              <Line label="Earnings" value={preview.earnings} strong />
              <Line label="Notice recovery" value={preview.notice} minus />
              <Line label="Advance" value={Number(draft.advance_recovery) || 0} minus />
              <Line label="Assets" value={Number(draft.asset_recovery) || 0} minus />
              <Line label="Other" value={Number(draft.other_deductions) || 0} minus />
              <Line label="Net payable" value={preview.net} strong />
              {preview.net < 0 && <p className="pt-1 text-xs text-danger">The person owes the company this amount.</p>}
            </aside>
          </div>
        )}
      </Sheet>

      {/* ── View ─────────────────────────────────────────────────────────── */}
      <Sheet
        open={!!viewFor}
        onClose={() => setViewFor(null)}
        title={viewFor ? `${viewFor.code ?? "Settlement"} — ${viewFor.person_name}` : "Settlement"}
        size="md"
      >
        {viewFor && (
          <div className="space-y-5 text-sm">
            <StatusPill tone={lifecycleTone(viewFor.status)}>{lifecycleLabel(viewFor.status)}</StatusPill>
            <div className="max-w-sm space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {viewFor.rated === "monthly"
                  ? `Basic + DA ${fmtMoney(viewFor.basic_da)} a month`
                  : `Daily wage ${fmtMoney(viewFor.daily_wage)}`}{" "}
                · {viewFor.completed_years} completed year(s) · {viewFor.leave_days} leave day(s)
              </p>
              <Line label="Gratuity" value={viewFor.gratuity} />
              <Line label="Leave encashment" value={viewFor.leave_amount} />
              <Line label="Salary due" value={viewFor.salary_due} />
              <Line label="Bonus due" value={viewFor.bonus_due} />
              <Line label="Other earnings" value={viewFor.other_earnings} />
              <Line label="Notice recovery" value={viewFor.notice_recovery} minus />
              <Line label="Advance" value={viewFor.advance_recovery} minus />
              <Line label="Assets" value={viewFor.asset_recovery} minus />
              <Line label="Other" value={viewFor.other_deductions} minus />
              <Line label="Net payable" value={viewFor.net_payable} strong />
            </div>
            {viewFor.note && <p className="whitespace-pre-wrap text-muted-foreground">{viewFor.note}</p>}
            {viewFor.decision_remark && <p className="text-muted-foreground">Decision note: {viewFor.decision_remark}</p>}
            {viewFor.paid_at && (
              <p>
                Paid {fmtDateTime(viewFor.paid_at)}
                {viewFor.paid_ref ? ` — ${viewFor.paid_ref}` : ""}
              </p>
            )}
            {panel?.id === viewFor.id && panel.run && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={panel.timeline} resolveUserName={(id) => panel.names[id]} />
                {panel.verdict && (
                  <ApprovalActionBar
                    run={panel.run}
                    verdict={panel.verdict}
                    subjectPath="/hr/team/settlements"
                    onDone={() => setViewFor(null)}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </Sheet>

      <ReasonSheet
        open={!!recallFor}
        busy={isPending}
        onClose={() => setRecallFor(null)}
        onConfirm={doRecall}
        title={`Recall ${recallFor?.code ?? ""}`}
        confirmLabel="Recall to draft"
        intro="Takes it out of the approver's queue so the figures can be changed."
      />

      <Sheet
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title={`Mark ${payFor?.code ?? ""} paid`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPayFor(null)}>
              Cancel
            </Button>
            <Button disabled={isPending} onClick={doPay}>
              Mark paid
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            {payFor?.person_name} · {payFor ? fmtMoney(payFor.net_payable) : ""}
          </p>
          <Field label="Payment reference" hint="Optional — a voucher, a cheque or the bank transfer.">
            <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
