"use client";

import { PersonCell, personKeyOf } from "@/components/ui/person-avatar";
import { BadgeIndianRupee, Undo2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import {
  loadPersonBalances,
  loadTimeoffPanel,
  markEncashmentPaid,
  requestEncashment,
  withdrawTimeoff,
} from "@/lib/hr/timeoff-actions";
import {
  fmtDays,
  statusLabel,
  timeoffTone,
  type BalanceRow,
  type Encashment,
  type LeaveType,
  type PersonOption,
} from "@/lib/hr/timeoff-types";
import { ApprovalTrail, Fact, PersonField, PHONE_FIELDS, PhoneActionBar, PhoneCard, PhoneCards, ReasonSheet } from "./shared";

/**
 * HR ▸ Time Off ▸ Leave Encashment (0770). A stub in MyJKKN (request only);
 * here it is checked against the type's encashable limit and the balance,
 * priced at the person's day rate (staff: monthly salary ÷ 30; worker: shift
 * wage), approved through the engine, and marked paid by HR. Pending and
 * approved encashments come off the balance at once.
 */

type Props = {
  rows: Encashment[];
  types: LeaveType[];
  people: PersonOption[];
  selfOnly: boolean;
  /** The signed-in person ("staff:<id>"); the form opens with them picked. */
  me?: string | null;
  canPay: boolean;
};
type Panel = Awaited<ReturnType<typeof loadTimeoffPanel>> & { id: string };

export function EncashmentScreen({ rows, types, people, selfOnly, me, canPay }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const encashable = types.filter((t) => t.is_active && t.is_encashable);

  // ── request ──
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [typeId, setTypeId] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const dirty = open && (!!days || !!reason.trim());
  useUnsavedGuard(dirty || isPending);

  const [balances, setBalances] = useState<{ person: string; rows: BalanceRow[] } | null>(null);
  useEffect(() => {
    if (!open || !person) return;
    let live = true;
    loadPersonBalances(person).then((r) => {
      if (live) setBalances({ person, rows: r });
    });
    return () => {
      live = false;
    };
  }, [open, person]);
  const bal = balances?.person === person ? balances.rows.find((b) => b.leave_type_id === typeId) : undefined;
  const type = encashable.find((t) => t.id === typeId);

  function openNew() {
    setPerson(selfOnly ? (people[0]?.key ?? "") : people.some((p) => p.key === me) ? (me as string) : "");
    setTypeId(encashable.length === 1 ? encashable[0].id : "");
    setDays("");
    setReason("");
    setOpen(true);
  }
  useCreateIntent(() => openNew());

  const problem = !person
    ? "Pick the person"
    : !typeId
      ? "Pick the leave type"
      : !(Number(days) > 0)
        ? "Enter the days to encash"
        : bal && Number(days) > bal.available
          ? `Only ${fmtDays(bal.available)} day(s) available`
          : type?.max_encashable_days != null && Number(days) > type.max_encashable_days
            ? `At most ${fmtDays(type.max_encashable_days)} day(s) a year`
            : !reason.trim()
              ? "The reason is mandatory"
              : null;

  function submit() {
    startTransition(async () => {
      const r = await requestEncashment(person, typeId, Number(days), reason);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setOpen(false);
      success("Encashment requested — sent for approval");
      router.refresh();
    });
  }

  // ── view / withdraw / pay ──
  const [viewFor, setViewFor] = useState<Encashment | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  function openView(x: Encashment) {
    setViewFor(x);
    loadTimeoffPanel("encashment", x.id).then((p) => setPanel({ ...p, id: x.id }));
  }
  useOpenIntent((id) => {
    const x = rows.find((r) => r.id === id);
    if (x) openView(x);
  });

  const [withdrawFor, setWithdrawFor] = useState<Encashment | null>(null);
  const [payFor, setPayFor] = useState<Encashment | null>(null);
  const [payRef, setPayRef] = useState("");

  function doWithdraw(why: string) {
    if (!withdrawFor) return;
    const id = withdrawFor.id;
    startTransition(async () => {
      const r = await withdrawTimeoff("encashment", id, why);
      if (!r.ok) toastError(r.error);
      else {
        success("Withdrawn — the days are back in the balance");
        setWithdrawFor(null);
        router.refresh();
      }
    });
  }
  function doPay() {
    if (!payFor) return;
    const id = payFor.id;
    startTransition(async () => {
      const r = await markEncashmentPaid(id, payRef);
      if (!r.ok) toastError(r.error);
      else {
        success("Marked paid");
        setPayFor(null);
        setPayRef("");
        router.refresh();
      }
    });
  }

  const columns: Column<Encashment>[] = [
    ...(selfOnly ? [] : [{ header: "Person", cell: (r: Encashment) => <PersonCell name={r.person_name} person={personKeyOf(r)} /> }]),
    { header: "Leave Type", cell: (r) => <span className="text-sm">{r.leave_name}</span> },
    { header: "Days", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtDays(r.days)}</span> },
    { header: "Rate / Day", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtMoney(r.rate_per_day)}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="text-sm font-medium tabular-nums">{fmtMoney(r.amount)}</span> },
  ];
  const statusColumn: Column<Encashment> = {
    header: "Status",
    cell: (r) => (
      <span className="inline-flex flex-col items-start gap-0.5">
        <StatusPill tone={timeoffTone(r.status)}>{statusLabel(r.status)}</StatusPill>
        {/* Pending until the last of HOD → HR Manager → ED; this says how far it got. */}
        {r.status === "pending" && r.stage && <span className="text-xs text-muted-foreground">{r.stage}</span>}
      </span>
    ),
  };
  const rowActs = (r: Encashment) => (
    <RowActions
      label={r.person_name}
      onView={() => openView(r)}
      isPending={isPending}
      menu={[
        ...(r.status === "pending" ? [{ label: "Withdraw…", icon: Undo2, onClick: () => setWithdrawFor(r) }] : []),
        ...(r.status === "approved" && canPay
          ? [{ label: "Mark paid…", icon: BadgeIndianRupee, onClick: () => { setPayRef(""); setPayFor(r); } }]
          : []),
      ]}
    />
  );
  const actions = rowActionsColumn<Encashment>(rowActs);
  const colorOf = (id: string) => types.find((t) => t.id === id)?.color ?? "var(--primary)";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {encashable.length
            ? `Encashable: ${encashable.map((t) => t.name).join(", ")}.`
            : "No leave type is encashable yet — tick Encashable on Time Off Setup."}
        </span>
        {people.length > 0 && encashable.length > 0 && (
          <Button className="hidden md:inline-flex" onClick={openNew}>
            + Request Encashment
          </Button>
        )}
      </div>

      <PhoneCards empty="No encashments yet.">
        {rows.map((r) => (
          <PhoneCard
            key={r.id}
            color={colorOf(r.leave_type_id)}
            title={r.leave_name}
            status={<StatusPill tone={timeoffTone(r.status)}>{statusLabel(r.status)}</StatusPill>}
            when={fmtMoney(r.amount)}
            figure={`${fmtDays(r.days)} day(s) × ${fmtMoney(r.rate_per_day)}`}
            person={selfOnly ? null : { name: r.person_name, key: personKeyOf(r) }}
            stage={r.status === "pending" ? r.stage : null}
            onOpen={() => openView(r)}
            actions={rowActs(r)}
          />
        ))}
      </PhoneCards>

      <div className="hidden md:block">
        <DataTable
          columns={[...withCreatedColumns(columns, rows), statusColumn, actions]}
          rows={rows}
          getKey={(r) => r.id}
          empty="No encashments yet."
        />
      </div>

      {people.length > 0 && encashable.length > 0 && (
        <PhoneActionBar>
          <Button onClick={openNew}>+ Request Encashment</Button>
        </PhoneActionBar>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Request leave encashment"
        asPage
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-xs text-muted-foreground">
              {problem ?? "Priced at the day rate when it is saved; the days leave the balance at once."}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={submit}>
                {isPending ? "Requesting…" : "Request"}
              </Button>
            </div>
          </div>
        }
      >
        <div className={`max-w-[44rem] space-y-4 ${PHONE_FIELDS}`}>
          <FieldRow>
            {!selfOnly && <PersonField people={people} value={person} onChange={setPerson} me={me} />}
            <Field label="Leave Type" w="term" required>
              <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">—</option>
                {encashable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Days" w="num" required>
              <Input type="number" min="0.5" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
          </FieldRow>
          {person && typeId && (
            <p className="text-xs text-muted-foreground">
              {bal ? `Available: ${fmtDays(bal.available)} day(s).` : "Reading the balance…"}
              {type?.max_encashable_days != null ? ` At most ${fmtDays(type.max_encashable_days)} day(s) a year.` : ""}
            </p>
          )}
          <Field label="Reason" required>
            <VoiceTextarea rows={2} value={reason} onValueChange={setReason} />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={!!viewFor}
        onClose={() => setViewFor(null)}
        title={viewFor && !selfOnly && viewFor.person_name !== "—" ? `${viewFor.person_name} — Encashment` : "Encashment"}
        asPage
      >
        {viewFor && (
          <div className="space-y-5 text-sm">
            <StatusPill tone={timeoffTone(viewFor.status)}>{statusLabel(viewFor.status)}</StatusPill>
            <dl className="space-y-1">
              <Fact label="Leave type">{viewFor.leave_name}</Fact>
              <Fact label="Days" className="tabular-nums">{fmtDays(viewFor.days)}</Fact>
              <Fact label="Amount" className="font-semibold tabular-nums">
                {fmtMoney(viewFor.amount)} <span className="font-normal text-muted-foreground">({fmtMoney(viewFor.rate_per_day)} a day)</span>
              </Fact>
              <Fact label="Reason" className="whitespace-pre-wrap">{viewFor.reason}</Fact>
              {viewFor.decision_remark && <Fact label="Decision note">{viewFor.decision_remark}</Fact>}
              {viewFor.paid_at && (
                <Fact label="Paid">
                  {fmtDateTime(viewFor.paid_at)}
                  {viewFor.paid_ref ? ` — ${viewFor.paid_ref}` : ""}
                </Fact>
              )}
            </dl>
            {panel?.id === viewFor.id && (
              <ApprovalTrail panel={panel} subjectPath="/hr/time-off/encashment" onDone={() => setViewFor(null)} />
            )}
          </div>
        )}
      </Sheet>

      <ReasonSheet
        open={!!withdrawFor}
        busy={isPending}
        onClose={() => setWithdrawFor(null)}
        onConfirm={doWithdraw}
        title={`Withdraw — ${withdrawFor?.person_name ?? ""}`}
        confirmLabel="Withdraw"
        intro="This takes the encashment out of the approver's queue and returns its days to the balance."
      />

      <Sheet
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title={`Mark paid — ${payFor?.person_name ?? ""}`}
        asPage
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
            {payFor?.person_name} · {payFor ? fmtMoney(payFor.amount) : ""}
          </p>
          <Field label="Payment reference" hint="Optional — a voucher, a cheque or the payroll run it went through.">
            <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
