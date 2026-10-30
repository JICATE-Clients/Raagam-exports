"use client";

import { Check, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { SelectionBar } from "@/components/ui/selection-bar";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useOpenIntent } from "@/lib/use-open-intent";
import { fmtDateTime } from "@/lib/format";
import { decideTimeoff } from "@/lib/hr/timeoff-actions";
import type { QueueItem } from "@/lib/hr/timeoff-types";

/**
 * HR ▸ Time Off ▸ Time Off Approvals (0765, MyJKKN `/hr/leave/approvals`).
 *
 * One queue for every kind: leave and permission requests and encashments are
 * decided through the approval engine (so only the person on the current step
 * may act, and the requester is told), comp-off claims directly by HR. Tick
 * several to approve or reject them together. Items waiting on someone else's
 * step are listed under "Everything pending" for visibility, without buttons.
 */

type Props = { items: QueueItem[] };
type Kind = "all" | QueueItem["kind"];
type Decision = { items: QueueItem[]; action: "approve" | "reject" };

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

  const [mineOnly, setMineOnly] = useState<"mine" | "all">("mine");
  const [kind, setKind] = useState<Kind>("all");
  const visible = useMemo(
    () => items.filter((i) => (mineOnly === "all" || i.can_act) && (kind === "all" || i.kind === kind)),
    [items, mineOnly, kind],
  );
  const counts = useMemo(() => {
    const c = { request: 0, encashment: 0, claim: 0 };
    for (const i of items) if (mineOnly === "all" || i.can_act) c[i.kind] += 1;
    return c;
  }, [items, mineOnly]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const keyOf = (i: QueueItem) => `${i.kind}:${i.id}`;
  const actable = visible.filter((i) => i.can_act);

  // A queue row opened from the approvals inbox or a notification.
  const [focusId, setFocusId] = useState<string | null>(null);
  useOpenIntent((id) => {
    setMineOnly("all");
    setFocusId(id);
  });

  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");

  function run() {
    if (!deciding) return;
    const { items: list, action } = deciding;
    startTransition(async () => {
      const r = await decideTimeoff(
        list.map((i) => ({ kind: i.kind, id: i.id })),
        action,
        comment,
      );
      if (!r.ok) {
        toastError(r.error);
        router.refresh();
        return;
      }
      success(`${r.count ?? list.length} ${action === "approve" ? "approved" : "rejected"}`);
      setDeciding(null);
      setComment("");
      setSelected(new Set());
      router.refresh();
    });
  }

  const columns: Column<QueueItem>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Person", cell: (r) => <span className="text-sm font-medium">{r.person_name}</span> },
    { header: "What", cell: (r) => <span className="text-sm">{r.what}</span> },
    { header: "When", cell: (r) => <span className="text-sm tabular-nums">{r.when}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="text-sm tabular-nums">{r.amount}</span> },
    { header: "Reason", cell: (r) => <Truncated className="max-w-[16rem] text-sm text-muted-foreground">{r.reason}</Truncated> },
    { header: "Asked", cell: (r) => <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(r.created_at)}</span> },
  ];
  const actions = rowActionsColumn<QueueItem>((r) => (
    <RowActions
      label={r.code}
      view={false}
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
        empty={mineOnly === "mine" ? "Nothing is waiting on you." : "Nothing is pending."}
      />

      <Sheet
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={
          deciding
            ? `${deciding.action === "approve" ? "Approve" : "Reject"} ${
                deciding.items.length === 1
                  ? `${deciding.items[0].code ?? ""} — ${deciding.items[0].person_name}`
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
              {isPending ? "Working…" : deciding?.action === "reject" ? "Reject" : "Approve"}
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
            <Field label={deciding.action === "reject" ? "Reason" : "Comment (optional)"} required={deciding.action === "reject"}>
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </div>
        )}
      </Sheet>
    </div>
  );
}
