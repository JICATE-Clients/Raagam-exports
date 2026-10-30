"use client";

import { Undo2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { claimCompOff, withdrawCompOff } from "@/lib/hr/timeoff-actions";
import { fmtDays, statusLabel, timeoffTone, type CompOffCredit, type PersonOption } from "@/lib/hr/timeoff-types";

/**
 * HR ▸ Time Off ▸ Compensatory Off (0770, MyJKKN §9.6).
 *
 * Claim a credit for each day worked off-schedule (up to 31 in one claim);
 * HR approves or rejects it on Time Off Approvals; an approved credit is
 * booked as leave on Leave Requests (type Compensatory Off), earliest expiry
 * first. A credit lapses a month after the day worked. Whether a biometric
 * punch exists for the worked day is recorded beside the claim, so the
 * approver can see it.
 */

type Props = {
  rows: CompOffCredit[];
  people: PersonOption[];
  selfOnly: boolean;
};

export function CompOffScreen({ rows, people, selfOnly }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const t0 = today();

  const [scope, setScope] = useState<"usable" | "all">("usable");
  const visible = useMemo(
    () => (scope === "usable" ? rows.filter((r) => r.status === "pending" || (r.status === "approved" && !r.expired)) : rows),
    [rows, scope],
  );

  // Usable credit per person — approved and not expired.
  const usableByPerson = useMemo(() => {
    const m = new Map<string, { name: string; days: number }>();
    for (const r of rows) {
      if (r.status !== "approved" || r.expired) continue;
      const k = r.staff_id ?? r.worker_id ?? "";
      const cur = m.get(k) ?? { name: r.person_name, days: 0 };
      cur.days += r.credit_days;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // ── claim ──
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [nextDate, setNextDate] = useState("");
  const [credit, setCredit] = useState<"1" | "0.5">("1");
  const [reason, setReason] = useState("");
  const dirty = open && (dates.length > 0 || !!reason.trim());
  useUnsavedGuard(dirty || isPending);

  function openClaim() {
    setPerson(selfOnly ? (people[0]?.key ?? "") : "");
    setDates([]);
    setNextDate("");
    setCredit("1");
    setReason("");
    setOpen(true);
  }
  useCreateIntent(() => openClaim());

  function addDate() {
    if (!nextDate || dates.includes(nextDate)) return;
    if (nextDate > t0) {
      toastError("A credit is claimed for a day already worked");
      return;
    }
    if (dates.length >= 31) {
      toastError("At most 31 dates in one claim");
      return;
    }
    setDates((d) => [...d, nextDate].sort());
    setNextDate("");
  }

  const problem = !person
    ? "Pick the person"
    : dates.length === 0
      ? "Add at least one worked date"
      : !reason.trim()
        ? "Say what the work was"
        : null;

  function submit() {
    startTransition(async () => {
      const r = await claimCompOff(person, dates, Number(credit), reason);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setOpen(false);
      success(`${r.count} credit(s) claimed — waiting for HR`);
      router.refresh();
    });
  }

  function withdraw(c: CompOffCredit) {
    startTransition(async () => {
      const r = await withdrawCompOff(c.id);
      if (!r.ok) toastError(r.error);
      else {
        success("Claim withdrawn");
        router.refresh();
      }
    });
  }

  const columns: Column<CompOffCredit>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    ...(selfOnly ? [] : [{ header: "Person", cell: (r: CompOffCredit) => <span className="text-sm">{r.person_name}</span> }]),
    { header: "Worked", cell: (r) => <span className="text-sm tabular-nums">{fmtDate(r.worked_date)}</span> },
    { header: "Credit", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtDays(r.credit_days)}</span> },
    {
      header: "Punch",
      cell: (r) => (
        <span className={r.had_punch ? "text-sm text-success" : "text-sm text-muted-foreground"}>
          {r.had_punch ? "Found" : "None"}
        </span>
      ),
    },
    { header: "Expires", cell: (r) => <span className="text-sm tabular-nums">{fmtDate(r.expires_on)}</span> },
    { header: "Reason", cell: (r) => <Truncated className="max-w-[16rem] text-sm text-muted-foreground">{r.reason}</Truncated> },
  ];
  const statusColumn: Column<CompOffCredit> = {
    header: "Status",
    cell: (r) =>
      r.expired ? (
        <StatusPill tone={timeoffTone("expired")}>Expired</StatusPill>
      ) : (
        <StatusPill tone={timeoffTone(r.status)}>{statusLabel(r.status)}</StatusPill>
      ),
  };
  const actions = rowActionsColumn<CompOffCredit>((r) => (
    <RowActions
      label={r.code}
      isPending={isPending}
      menu={r.status === "pending" ? [{ label: "Withdraw claim", icon: Undo2, onClick: () => withdraw(r) }] : []}
    />
  ));

  return (
    <div className="space-y-4">
      {usableByPerson.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {usableByPerson.slice(0, 12).map((p) => (
            <span key={p.name} className="rounded-control border border-border bg-card px-3 py-1.5 text-sm">
              {p.name} · <span className="font-semibold tabular-nums">{fmtDays(p.days)}</span> day(s) usable
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "usable", label: "Pending & usable" },
            { value: "all", label: "All" },
          ]}
        />
        <div className="flex gap-2">
          <Link href="/hr/time-off/leave?new=1" className={buttonClasses({ variant: "outline" })}>
            Book comp-off as leave
          </Link>
          {people.length > 0 && <Button onClick={openClaim}>+ Claim Credit</Button>}
        </div>
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(r) => r.id}
        empty="No comp-off credits yet."
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Claim comp-off credit"
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? "Each date becomes its own credit, decided by HR."}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={submit}>
                {isPending ? "Claiming…" : "Claim"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="max-w-[48rem] space-y-4">
          <FieldRow>
            {!selfOnly && (
              <Field label="Person" w="name" required>
                <Combobox
                  options={people.map((p) => ({
                    value: p.key,
                    label: p.name,
                    sublabel: p.kind === "worker" ? "Worker" : "Staff",
                    search: p.code,
                  }))}
                  value={person}
                  onChange={setPerson}
                />
              </Field>
            )}
            <Field label="Credit per day">
              <Segmented
                name="comp-off-credit"
                value={credit}
                onChange={setCredit}
                options={[
                  { value: "1", label: "Full day" },
                  { value: "0.5", label: "Half day" },
                ]}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Worked date" w="code" required={dates.length === 0}>
              <Input
                type="date"
                max={t0}
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nextDate) {
                    e.preventDefault();
                    addDate();
                  }
                }}
              />
            </Field>
            <div className="flex items-end">
              <Button variant="outline" data-row-add="" disabled={!nextDate} onClick={addDate}>
                + Add date
              </Button>
            </div>
          </FieldRow>
          {dates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {dates.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-control border border-border bg-muted/40 px-2 py-1 text-sm tabular-nums"
                >
                  {fmtDate(d)}
                  {/* button-shape: exempt -- a round ✕ chip on a date tag */}
                  <button
                    type="button"
                    aria-label={`Remove ${fmtDate(d)}`}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setDates((all) => all.filter((x) => x !== d))}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <Field label="What was the work" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
