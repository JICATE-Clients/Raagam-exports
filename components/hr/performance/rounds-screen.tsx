"use client";

import { CircleCheck, CirclePlay, Lock, LockOpen, Users } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate } from "@/lib/format";
import { deleteRound, saveRound, setRoundStatus } from "@/lib/hr/performance-actions";
import { performanceLabel, performanceTone, type Round, type RoundStatus } from "@/lib/hr/performance-types";

/**
 * HR ▸ Performance & Growth ▸ Appraisal Rounds (0773, MyJKKN §13.1 cycles).
 *
 * A round is one appraisal period for one unit: Draft → Open (people rate) →
 * Self-rating closed (supervisors finish) → Closed. One round is open per unit
 * at a time. People are added on Appraisals, where the round's reviews live.
 */

type Props = { rows: Round[]; canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Draft = { name: string; period_from: string; period_to: string; self_due: string; review_due: string; note: string };
const BLANK: Draft = { name: "", period_from: "", period_to: "", self_due: "", review_due: "", note: "" };

const MOVE_WORDS: Record<RoundStatus, { label: string; done: string }> = {
  draft: { label: "Draft", done: "" },
  open: { label: "Open", done: "Round opened" },
  locked: { label: "Close self-rating", done: "Self-rating closed" },
  closed: { label: "Close round", done: "Round closed" },
};

export function RoundsScreen({ rows, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(BLANK);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openEdit(r?: Round) {
    setEditId(r?.id ?? null);
    setD(
      r
        ? {
            name: r.name,
            period_from: r.period_from,
            period_to: r.period_to,
            self_due: r.self_due ?? "",
            review_due: r.review_due ?? "",
            note: r.note ?? "",
          }
        : BLANK,
    );
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openEdit());

  const problem = !d.name.trim()
    ? "Name the round"
    : !d.period_from || !d.period_to
      ? "Enter the period it covers"
      : d.period_to < d.period_from
        ? "The period ends before it starts"
        : null;

  function save() {
    startTransition(async () => {
      const r = await saveRound(editId, d);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(editId ? "Round saved" : "Round added — add people to it on Appraisals");
      router.refresh();
    });
  }

  function move(r: Round, to: RoundStatus) {
    startTransition(async () => {
      const res = await setRoundStatus(r.id, to);
      if (!res.ok) toastError(res.error);
      else {
        success(MOVE_WORDS[to].done);
        router.refresh();
      }
    });
  }

  const columns: Column<Round>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Round", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    {
      header: "Period",
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {fmtDate(r.period_from)} – {fmtDate(r.period_to)}
        </span>
      ),
    },
    {
      header: "Due",
      cell: (r) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {r.self_due ? `Self ${fmtDate(r.self_due)}` : ""}
          {r.self_due && r.review_due ? " · " : ""}
          {r.review_due ? `Supervisor ${fmtDate(r.review_due)}` : ""}
          {!r.self_due && !r.review_due ? "—" : ""}
        </span>
      ),
    },
    {
      header: "Progress",
      cell: (r) =>
        r.counts.total === 0 ? (
          <span className="text-sm text-muted-foreground">Nobody added yet</span>
        ) : (
          <span className="text-sm tabular-nums">
            {r.counts.approved} / {r.counts.total} approved
            <span className="ml-2 text-xs text-muted-foreground">
              {[
                r.counts.self && `${r.counts.self} self-rating`,
                r.counts.supervisor && `${r.counts.supervisor} with supervisor`,
                r.counts.pending && `${r.counts.pending} awaiting approval`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        ),
    },
  ];
  const statusColumn: Column<Round> = {
    header: "Status",
    cell: (r) => <StatusPill tone={performanceTone(r.status)}>{performanceLabel(r.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Round>((r) => (
    <RowActions
      label={r.name}
      view={false}
      onEdit={() => openEdit(r)}
      canEdit={canEdit}
      editDisabledReason={r.status === "closed" ? "This round is closed" : null}
      onDelete={() =>
        startTransition(async () => {
          const res = await deleteRound(r.id);
          if (!res.ok) toastError(res.error);
          else {
            success("Deleted");
            router.refresh();
          }
        })
      }
      canDelete={canDelete}
      deleteDisabledReason={
        r.status !== "draft" ? "Only a draft round can be deleted" : r.counts.total > 0 ? "People are in this round — remove them first" : null
      }
      isPending={isPending}
      menu={[
        { label: "Appraisals", icon: Users, onClick: () => router.push(`/hr/performance/appraisals?round=${r.id}`) },
        ...(canEdit && (r.status === "draft" || r.status === "locked")
          ? [{ label: r.status === "draft" ? "Open" : "Reopen self-rating", icon: r.status === "draft" ? CirclePlay : LockOpen, onClick: () => move(r, "open") }]
          : []),
        ...(canEdit && r.status === "open" ? [{ label: "Close self-rating", icon: Lock, onClick: () => move(r, "locked") }] : []),
        ...(canEdit && r.status === "locked" ? [{ label: "Close round", icon: CircleCheck, onClick: () => move(r, "closed") }] : []),
      ]}
    />
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canCreate && <Button onClick={() => openEdit()}>+ Add Round</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, rows), statusColumn, actions]}
        rows={rows}
        getKey={(r) => r.id}
        empty="No appraisal rounds yet. Add one, add people to it on Appraisals, then open it."
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.name}` : "New appraisal round"}
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={save}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required hint="For example 2026-27 ANNUAL">
            <Input value={d.name} onChange={(e) => put({ name: e.target.value })} />
          </Field>
          <FieldRow>
            <Field label="Period from" w="code" required>
              <Input type="date" value={d.period_from} onChange={(e) => put({ period_from: e.target.value })} />
            </Field>
            <Field label="to" w="code" required>
              <Input type="date" value={d.period_to} onChange={(e) => put({ period_to: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Self-rating due" w="code">
              <Input type="date" value={d.self_due} onChange={(e) => put({ self_due: e.target.value })} />
            </Field>
            <Field label="Supervisor due" w="code">
              <Input type="date" value={d.review_due} onChange={(e) => put({ review_due: e.target.value })} />
            </Field>
          </FieldRow>
          <Field label="Note">
            <Textarea rows={2} value={d.note} onChange={(e) => put({ note: e.target.value })} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
