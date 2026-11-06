"use client";

import { PersonCell, personKeyOf } from "@/components/ui/person-avatar";
import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { SelectionBar } from "@/components/ui/selection-bar";
import { Truncated } from "@/components/ui/truncated";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useOpenIntent } from "@/lib/use-open-intent";
import { fmtDateTime } from "@/lib/format";
import { decideTimeoff, forwardTimeoff, loadTimeoffPanel } from "@/lib/hr/timeoff-actions";
import { ApprovalTrail, Fact, type TimeoffPanel } from "./shared";
import { statusLabel, timeoffTone, type QueueItem } from "@/lib/hr/timeoff-types";

/**
 * HR ▸ Time Off ▸ Time Off Approvals (0770, MyJKKN `/hr/leave/approvals`).
 *
 * One queue for every kind: leave and permission requests and encashments are
 * decided through the approval engine (so only the person on the current step
 * may act, and the requester is told), comp-off claims directly by HR. Tick
 * several to approve or reject them together. Items waiting on someone else's
 * step are listed under "Everything pending" for visibility, without buttons.
 */

type Props = { items: QueueItem[] };
type Kind = "all" | QueueItem["kind"];
/** "forward" = send it to the next stage (0820): one item, from its own view. */
type Decision = { items: QueueItem[]; action: "approve" | "reject" | "forward"; to?: string };
const VERB = { approve: "Approve", reject: "Reject", forward: "Send" } as const;

const KIND_LABEL: Record<QueueItem["kind"], string> = {
  request: "Leave / permission",
  encashment: "Encashment",
  claim: "Comp-off claim",
};

export function ApprovalsScreen({ items }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  useUnsavedGuard(isPending);

  /* "decided" — approved and rejected, so an approval is SEEN as one (user
     2026-11-06: "I want to see the approved wording in green"). */
  const [mineOnly, setMineOnly] = useState<"mine" | "all" | "decided">("mine");
  const [kind, setKind] = useState<Kind>("all");
  const inScope = (i: QueueItem) =>
    mineOnly === "decided" ? i.status !== "pending" : i.status === "pending" && (mineOnly === "all" || i.can_act);
  const visible = items.filter((i) => inScope(i) && (kind === "all" || i.kind === kind));
  const counts = { request: 0, encashment: 0, claim: 0 };
  for (const i of items) if (inScope(i)) counts[i.kind] += 1;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const keyOf = (i: QueueItem) => `${i.kind}:${i.id}`;
  const actable = visible.filter((i) => i.can_act);

  // A queue row opened from the approvals inbox or a notification.
  const [focusId, setFocusId] = useState<string | null>(null);
  useOpenIntent((id) => {
    setMineOnly("all");
    setFocusId(id);
    const it = items.find((i) => i.id === id);
    if (it) openView(it);
  });

  // ── view: the whole request and its HOD → HR Manager → ED trail ──
  const [viewing, setViewing] = useState<QueueItem | null>(null);
  const [panel, setPanel] = useState<(TimeoffPanel & { id: string }) | null>(null);
  // The stage after the one this request is at — what "Send to …" names.
  const nextStage =
    viewing?.can_act && panel?.id === viewing.id ? panel.next : null;
  function openView(i: QueueItem) {
    setViewing(i);
    if (i.kind !== "claim") loadTimeoffPanel(i.kind, i.id).then((p) => setPanel({ ...p, id: i.id }));
  }

  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");

  function run() {
    if (!deciding) return;
    const { items: list, action } = deciding;
    startTransition(async () => {
      const one = list[0];
      const r =
        action === "forward" && one.kind !== "claim"
          ? await forwardTimeoff(one.kind, one.id, comment)
          : action === "forward"
            ? ({ ok: false, error: "A comp-off claim is decided by HR directly" } as const)
            : await decideTimeoff(
                list.map((i) => ({ kind: i.kind, id: i.id })),
                action,
                comment,
              );
      if (!r.ok) {
        toastError(r.error);
        router.refresh();
        return;
      }
      success(
        action === "forward"
          ? `Sent to ${deciding.to ?? "the next stage"}`
          : `${r.count ?? list.length} ${action === "approve" ? "approved" : "rejected"}`,
      );
      setDeciding(null);
      setViewing(null);
      setComment("");
      setSelected(new Set());
      router.refresh();
    });
  }

  const columns: Column<QueueItem>[] = [
    {
      header: "Person",
      // The name opens the request — its details and approval flow. No code
      // column (user 2026-11-05: "why code is here, only name is enough").
      cell: (r) => (
        <PersonCell name={r.person_name} person={personKeyOf(r)}>
          <button type="button" onClick={() => openView(r)} className="text-left text-sm font-medium text-primary hover:underline">
            {r.person_name}
          </button>
        </PersonCell>
      ),
    },
    { header: "What", cell: (r) => <span className="text-sm">{r.what}</span> },
    { header: "When", cell: (r) => <span className="text-sm tabular-nums">{r.when}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="text-sm tabular-nums">{r.amount}</span> },
    { header: "Reason", cell: (r) => <Truncated className="max-w-[16rem] text-sm text-muted-foreground">{r.reason}</Truncated> },
    { header: "Asked", cell: (r) => <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(r.created_at)}</span> },
    // The status in its colour (Approved green, Rejected red, Pending amber);
    // under it, who has it now (Department HOD → HR Manager → ED, 0817) or who decided.
    {
      header: "Status",
      cell: (r) => (
        <span className="text-sm">
          <StatusPill tone={timeoffTone(r.status)}>{statusLabel(r.status)}</StatusPill>
          <span className={r.can_act ? "block text-xs font-medium text-primary" : "block text-xs text-muted-foreground"}>
            {r.status !== "pending" ? (r.decided ?? "") : r.can_act ? `Waiting on you${r.stage ? ` · ${r.stage}` : ""}` : (r.stage ?? "")}
          </span>
        </span>
      ),
    },
  ];
  const actions = rowActionsColumn<QueueItem>((r) => (
    <RowActions
      label={r.person_name}
      onView={() => openView(r)}
      isPending={isPending}
      menu={
        r.can_act
          ? [
              { label: "Approve", icon: Check, onClick: () => setDeciding({ items: [r], action: "approve" }) },
              { label: "Reject…", icon: X, danger: true, onClick: () => setDeciding({ items: [r], action: "reject" }) },
            ]
          : []
      }
    />
  ));

  const chosen = actable.filter((i) => selected.has(keyOf(i)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          label="Whose"
          value={mineOnly}
          onChange={(v) => {
            setMineOnly(v);
            setSelected(new Set());
          }}
          options={[
            { value: "mine", label: "Waiting on me" },
            { value: "all", label: "Everything pending" },
            { value: "decided", label: "Decided" },
          ]}
        />
        <ToggleGroup
          label="Kind"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setSelected(new Set());
          }}
          options={[
            { value: "all", label: `All (${counts.request + counts.encashment + counts.claim})` },
            { value: "request", label: `Leave / permission (${counts.request})` },
            { value: "claim", label: `Comp-off claims (${counts.claim})` },
            { value: "encashment", label: `Encashment (${counts.encashment})` },
          ]}
        />
      </div>

      <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())}>
        <Button size="sm" disabled={isPending} onClick={() => setDeciding({ items: chosen, action: "approve" })}>
          Approve {chosen.length}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => setDeciding({ items: chosen, action: "reject" })}
        >
          Reject {chosen.length}
        </Button>
      </SelectionBar>

      <DataTable
        columns={[...columns, actions]}
        rows={visible}
        getKey={keyOf}
        selectable={actable.length > 0}
        selectedKeys={selected}
        onToggle={(k) => {
          if (!actable.some((i) => keyOf(i) === k)) return;
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            return n;
          });
        }}
        onToggleAll={() =>
          setSelected((s) => (s.size === actable.length ? new Set() : new Set(actable.map(keyOf))))
        }
        rowClassName={(r) => (r.id === focusId ? "bg-primary/5" : undefined)}
        empty={
          mineOnly === "mine" ? "Nothing is waiting on you." : mineOnly === "decided" ? "Nothing decided in the last 60 days." : "Nothing is pending."
        }
      />

      <Sheet
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.person_name} — ${KIND_LABEL[viewing.kind]}` : ""}
        size="md"
        footer={
          viewing?.can_act ? (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={isPending} onClick={() => setDeciding({ items: [viewing], action: "reject" })}>
                Reject…
              </Button>
              {/* Needs the next person's attention: HOD → HR Manager → ED (0820). */}
              {nextStage && (
                <Button
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setDeciding({ items: [viewing], action: "forward", to: nextStage })}
                >
                  Send to {nextStage}…
                </Button>
              )}
              <Button disabled={isPending} onClick={() => setDeciding({ items: [viewing], action: "approve" })}>
                Approve
              </Button>
            </div>
          ) : undefined
        }
      >
        {viewing && (
          <div className="space-y-5 text-sm">
            <dl className="space-y-1">
              <Fact label="Person">{viewing.person_name}</Fact>
              <Fact label="What">{viewing.what}</Fact>
              <Fact label="When" className="tabular-nums">
                {viewing.when}
              </Fact>
              <Fact label="Amount" className="tabular-nums">
                {viewing.amount}
              </Fact>
              <Fact label="Reason" className="whitespace-pre-wrap">
                {viewing.reason}
              </Fact>
              <Fact label="Asked" className="tabular-nums">
                {fmtDateTime(viewing.created_at)}
              </Fact>
            </dl>
            {viewing.kind === "claim" ? (
              <p className="text-muted-foreground">A comp-off claim is decided by HR directly — one step.</p>
            ) : panel?.id === viewing.id ? (
              <ApprovalTrail panel={panel} subjectPath="/hr/time-off/approvals" decide={false} />
            ) : (
              <p className="text-muted-foreground">Loading the approval flow…</p>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={
          deciding
            ? `${deciding.action === "forward" ? `Send to ${deciding.to}` : VERB[deciding.action]} ${
                deciding.items.length === 1
                  ? deciding.items[0].person_name
                  : `${deciding.items.length} items`
              }`
            : ""
        }
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Back
            </Button>
            <Button
              variant={deciding?.action === "reject" ? "danger" : "primary"}
              disabled={isPending || (deciding?.action === "reject" && !comment.trim())}
              onClick={run}
            >
              {isPending ? "Working…" : deciding?.action === "forward" ? `Send to ${deciding.to}` : deciding ? VERB[deciding.action] : ""}
            </Button>
          </div>
        }
      >
        {deciding && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {deciding.items.slice(0, 8).map((i) => (
                <li key={keyOf(i)} className="flex justify-between gap-3">
                  <span>
                    {i.person_name} · <span className="text-muted-foreground">{KIND_LABEL[i.kind]}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{i.amount}</span>
                </li>
              ))}
              {deciding.items.length > 8 && <li className="text-muted-foreground">…and {deciding.items.length - 8} more</li>}
            </ul>
            {deciding.action === "forward" && (
              <p className="text-muted-foreground">
                It leaves your queue and waits for the {deciding.to}, who approves or rejects it.
              </p>
            )}
            {deciding.action === "approve" && (
              <p className="text-muted-foreground">Approving closes the request — nobody after you is asked.</p>
            )}
            <Field
              label={deciding.action === "reject" ? "Reason" : deciding.action === "forward" ? "Note for them (optional)" : "Comment (optional)"}
              required={deciding.action === "reject"}
            >
              <VoiceTextarea rows={2} value={comment} onValueChange={setComment} />
            </Field>
          </div>
        )}
      </Sheet>
    </div>
  );
}
