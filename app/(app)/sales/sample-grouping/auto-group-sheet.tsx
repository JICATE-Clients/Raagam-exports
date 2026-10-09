"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  DEFAULT_BATCH_KG,
  DEFAULT_MOQ_KG,
  fmtKg,
  groupNetKg,
  moqOrderWeight,
  proposeGroups,
  purchaseBasis,
  type GroupProposal,
} from "@/lib/sales/sample-grouping/calc";
import type { GroupingCandidate, GroupRow } from "@/lib/sales/sample-grouping/types";
import { addToSampleGroup, createSampleGroup } from "@/lib/sales/sample-grouping/actions";

/**
 * AUTO-GROUP — the batches the season's costed styles fall into, PROPOSED and
 * confirmed (user 2026-10-09: "review the proposed batches … and confirm before
 * anything is committed"). A button on Detailed, never a background job on
 * Sample Entry's save: a group created behind the merchandiser's back is a
 * group nobody reviewed.
 *
 * The proposals are `proposeGroups` (calc.ts, pinned in check:sample-grouping):
 * same season + year + structure + yarn blend, and into a waiting DRAFT group
 * where one holds that key. Every proposal starts ticked; Confirm runs each
 * through the SAME create / add action a hand-ticked selection uses, so the
 * server weighs and checks it again — this sheet decides nothing the server
 * does not re-decide.
 */
type Row = GroupProposal<GroupingCandidate> & { moq: number; batch: number; afterNet: number; afterBuy: number };

export function AutoGroupSheet({
  candidates,
  groups,
  onClose,
}: {
  candidates: GroupingCandidate[];
  groups: GroupRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  useUnsavedGuard(isPending);

  const { rows, alone } = useMemo(() => {
    const drafts = groups.filter((g) => g.status === "draft");
    const netOf = (g: GroupRow) => groupNetKg(g.items.map((it) => (it.live_kg != null ? it.live_kg : it.calculated_weight_kg)));
    const out = proposeGroups(
      candidates,
      drafts.map((g) => ({ ...g, netKg: netOf(g) })),
    );
    const rows: Row[] = out.proposals.map((p) => {
      const target = p.into ? drafts.find((g) => g.id === p.into?.id) : undefined;
      const moq = target?.moq_kg ?? DEFAULT_MOQ_KG;
      const batch = target?.batch_kg ?? DEFAULT_BATCH_KG;
      const afterNet = groupNetKg([p.netKg, p.into?.netKg ?? 0]);
      return { ...p, moq, batch, afterNet, afterBuy: moqOrderWeight(afterNet, moq, batch) };
    });
    return { rows, alone: out.alone };
  }, [candidates, groups]);

  const [ticked, setTicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.key)));
  const toggle = (k: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const chosen = rows.filter((r) => ticked.has(r.key));

  const confirm = () =>
    startTransition(async () => {
      let made = 0;
      const failed: string[] = [];
      // One at a time: each re-reads the costings, and a later proposal must
      // see the group an earlier one created.
      for (const r of chosen) {
        const keys = r.candidates.map((c) => c.key);
        const res = r.into ? await addToSampleGroup(r.into.id, keys) : await createSampleGroup(keys);
        if (res.ok) made++;
        else failed.push(`${r.candidates[0].fabric_structure ?? "—"} · ${r.candidates[0].yarn_blend}: ${res.error}`);
      }
      if (made) success(`${made} batch${made === 1 ? "" : "es"} grouped.`);
      if (failed.length) toastError(failed.join(" "));
      router.refresh();
      if (!failed.length) onClose();
    });

  const proposalColumns: Column<Row>[] = [
    { header: "Season - Year", cell: (r) => <span className="text-xs">{`${r.candidates[0].season} ${r.candidates[0].season_year ?? ""}`}</span> },
    {
      header: "Fabric / yarn",
      cell: (r) => (
        <Truncated className="block max-w-[18rem] text-xs">{[r.candidates[0].fabric_structure, r.candidates[0].yarn_blend].filter(Boolean).join(" · ")}</Truncated>
      ),
    },
    {
      header: "Styles",
      cell: (r) => <Truncated className="block max-w-[14rem] font-mono text-xs">{r.candidates.map((c) => c.sample_no ?? c.style_name).join(", ")}</Truncated>,
    },
    { header: "Net kg", align: "right", cell: (r) => <span className="block text-right font-mono tabular-nums text-xs">{fmtKg(r.netKg)}</span> },
    {
      header: "Buys kg",
      align: "right",
      cell: (r) => (
        <span className="block text-right font-mono tabular-nums text-xs">
          {fmtKg(r.afterBuy, 1)}
          <span className="block font-sans text-[11px] text-muted-foreground">{purchaseBasis(r.afterNet, r.moq, r.batch)}</span>
        </span>
      ),
    },
    {
      header: "Into",
      cell: (r) =>
        r.into ? (
          <span className="text-xs">
            Join <span className="font-mono text-primary">{r.into.code}</span>
            <span className="block text-[11px] text-muted-foreground">{`${fmtKg(r.into.netKg)} → ${fmtKg(r.afterNet)} kg`}</span>
          </span>
        ) : (
          <span className="text-xs">New group</span>
        ),
    },
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      size="md"
      title="Auto-group"
      footer={
        <>
          <Button variant="outline" size="md" disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
          {rows.length ? (
            <Button size="md" disabled={isPending || !chosen.length} onClick={confirm}>
              {isPending ? "Grouping…" : `Create ${chosen.length} batch${chosen.length === 1 ? "" : "es"}`}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Ungrouped, costed styles that share a season, year, fabric structure and yarn blend. Untick a batch to leave it out — nothing is saved
          until you confirm.
        </p>
        <div className="w-fit max-w-full">
          <DataTable
            columns={withCreatedColumns(proposalColumns, rows)}
            rows={rows}
            getKey={(r) => r.key}
            compact
            paginate={false}
            selectable
            selectedKeys={ticked}
            onToggle={toggle}
            onToggleAll={() => setTicked((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.key))))}
            empty="No two ungrouped styles in this season share a structure and yarn blend, and no Draft group is waiting for one."
          />
        </div>
        {alone.length ? (
          <p className="text-sm text-muted-foreground">
            {alone.length} style{alone.length === 1 ? " has" : "s have"} no match yet, so grouping {alone.length === 1 ? "it" : "them"} would save nothing:{" "}
            {alone.map((c) => `${c.sample_no ?? c.style_name} (${c.fabric_structure ?? "—"})`).join(", ")}.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
