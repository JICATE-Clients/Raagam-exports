"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, PackageCheck, Split, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  distributeProblem,
  excessToStock,
  fmtKg,
  groupNetKg,
  moqOrderWeight,
  purchaseBasis,
  releasedCuttingKg,
} from "@/lib/sales/sample-grouping/calc";
import {
  GROUP_STATUS_LABEL,
  GROUP_STATUS_TONE,
  type GroupItemRow,
  type GroupRow,
} from "@/lib/sales/sample-grouping/types";
import {
  approveAndRaiseSampleGroupIw,
  approveSampleGroup,
  distributeSampleGroup,
  markSampleGroupFabricReceived,
  raiseSampleGroupIw,
  removeFromSampleGroup,
  reopenSampleGroup,
  saveSampleGroupTerms,
} from "@/lib/sales/sample-grouping/actions";

/**
 * ONE GROUP — its terms, its styles and the one next step (spec §2's flow:
 * group → MOQ → IW → fabric received → distribute to the styles).
 *
 * A `Sheet`, not a rail editor: four fields and a READ-ONLY table of styles —
 * every figure in it comes from the costings, so there is no grid to type into
 * (the skill's tree: ≤ 7 fields, no child grid). `md`, because the styles
 * table is eight columns wide.
 *
 * WHAT CAN CHANGE WHEN, and the server says the same (actions.ts, 0702):
 *   MOQ / Batch     — Draft only: they decide what is bought.
 *   Cutting waste / Remarks — until the fabric is distributed: they decide
 *                     what is released.
 *   Styles          — Draft only; past it the database refuses.
 *
 * ONE FILLED BUTTON (AGENTS.md "Buttons"): Save while there are unsaved
 * changes, else the next step. The step is HIDDEN while dirty, so a step never
 * runs on terms the operator has typed but not saved.
 */

const label10 = "text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground";

type Terms = { moq: string; batch: string; waste: string; remarks: string };
const termsOf = (g: GroupRow): Terms => ({
  moq: String(g.moq_kg),
  batch: String(g.batch_kg),
  waste: String(g.cutting_waste_pct),
  remarks: g.remarks ?? "",
});
const numOr = (v: string, fallback: number) => {
  const x = Number(v);
  return v.trim() !== "" && Number.isFinite(x) ? x : fallback;
};

function termsProblems(t: Terms): Partial<Record<keyof Terms, string>> {
  const out: Partial<Record<keyof Terms, string>> = {};
  const moq = Number(t.moq);
  const batch = Number(t.batch);
  const waste = Number(t.waste || "0");
  if (!t.moq.trim() || !(moq > 0)) out.moq = "MOQ must be more than 0 kg.";
  if (!t.batch.trim() || !(batch > 0)) out.batch = "Batch must be more than 0 kg.";
  if (!Number.isFinite(waste) || waste < 0) out.waste = "Cutting waste cannot be negative.";
  else if (waste >= 100) out.waste = "Cutting waste must be under 100 %.";
  return out;
}

export function GroupSheet({
  group,
  perms,
  onClose,
}: {
  group: GroupRow;
  perms: { canEdit: boolean; canRaiseIw: boolean };
  onClose: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [terms, setTerms] = useState<Terms>(() => termsOf(group));
  const saved = termsOf(group);
  const dirty = (Object.keys(terms) as (keyof Terms)[]).some((k) => terms[k].trim() !== saved[k].trim());
  useUnsavedGuard(dirty || isPending);

  const draft = group.status === "draft";
  const done = group.status === "completed";
  const problems = termsProblems(terms);
  const hasProblem = Object.keys(problems).length > 0;

  // The figures, live: a Draft follows its costings and its unsaved MOQ / batch;
  // past Draft the stored (frozen) figures are the purchase.
  const kgOf = (it: GroupItemRow) => (draft && it.live_kg != null ? it.live_kg : it.calculated_weight_kg);
  const moq = numOr(terms.moq, group.moq_kg);
  const batch = numOr(terms.batch, group.batch_kg);
  const waste = numOr(terms.waste, 0);
  const net = draft ? groupNetKg(group.items.map(kgOf)) : group.net_required_weight_kg;
  const buy = draft ? moqOrderWeight(net, moq, batch) : group.moq_purchased_weight_kg;
  const styleKg = group.items.map(kgOf);
  const release = groupNetKg(styleKg.map((k) => releasedCuttingKg(k, waste)));
  const toStock = excessToStock(buy, styleKg, waste);
  const shortfall = distributeProblem(buy, styleKg, waste);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, said: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(said);
      router.refresh();
    });

  const save = () => {
    if (hasProblem) {
      toastError(Object.values(problems)[0] as string);
      return;
    }
    run(
      () =>
        saveSampleGroupTerms(group.id, {
          moq_kg: terms.moq,
          batch_kg: terms.batch,
          cutting_waste_pct: terms.waste || "0",
          remarks: terms.remarks,
        }),
      `${group.group_code} saved.`,
    );
  };

  const set = (k: keyof Terms) => (e: React.ChangeEvent<HTMLInputElement>) => setTerms((t) => ({ ...t, [k]: e.target.value }));

  const itemColumns: Column<GroupItemRow>[] = [
    {
      header: "Sample No",
      cell: (it) => (
        <span className="font-mono text-xs">
          {it.sample_no ?? "—"}
          {it.enquiry_no ? <span className="block text-[11px] text-muted-foreground">{it.enquiry_no}</span> : null}
        </span>
      ),
    },
    { header: "Style", cell: (it) => <Truncated className="block max-w-[12rem] text-xs font-medium">{it.style_name || "—"}</Truncated> },
    { header: "Buyer", cell: (it) => <Truncated className="block max-w-[10rem] text-xs">{it.customer ?? "—"}</Truncated> },
    { header: "Components", cell: (it) => <Truncated className="block max-w-[10rem] text-xs">{it.components || "—"}</Truncated> },
    { header: "Qty (pcs)", align: "right", cell: (it) => <span className="block text-right font-mono tabular-nums text-xs">{it.sample_qty_pcs}</span> },
    {
      header: "Net kg",
      align: "right",
      cell: (it) =>
        draft && it.live_missing ? (
          <span className="block text-right text-xs text-danger" title="This style's costing no longer has this fabric — remove it, or fix the costing.">
            Not costed
          </span>
        ) : (
          <span className="block text-right font-mono tabular-nums text-xs">{fmtKg(kgOf(it))}</span>
        ),
    },
    {
      header: "Release kg",
      align: "right",
      cell: (it) => <span className="block text-right font-mono tabular-nums text-xs">{fmtKg(releasedCuttingKg(kgOf(it), waste))}</span>,
    },
    {
      header: "Allocated kg",
      align: "right",
      cell: (it) => (
        <span className="block text-right font-mono tabular-nums text-xs">{it.allocated_fabric_kg != null ? fmtKg(it.allocated_fabric_kg) : "—"}</span>
      ),
    },
  ];
  if (draft && perms.canEdit) {
    itemColumns.push(
      rowActionsColumn((it) => (
        <RowActions
          label={it.sample_no ?? it.style_name}
          view={false}
          lead={
            <RowIconAction
              label="Remove from group"
              name={it.sample_no ?? it.style_name}
              icon={X}
              danger
              disabledReason={group.items.length <= 1 ? "The group's only style — delete the group instead." : null}
              onClick={() => run(() => removeFromSampleGroup(group.id, it.id), `${it.sample_no ?? "Style"} removed from ${group.group_code}.`)}
            />
          }
        />
      )),
    );
  }

  /** The one next step, by status. Hidden while there are unsaved changes. */
  const step = (() => {
    if (!perms.canEdit || dirty) return null;
    switch (group.status) {
      case "draft":
        // ONE CLICK (user 2026-10-09): approve and raise the IW together. Someone
        // who cannot raise IWs still approves — the IW is then raised by
        // someone who can, from the Approved group's own "Raise IW".
        return perms.canRaiseIw ? (
          <Button size="md" disabled={isPending} onClick={() => run(() => approveAndRaiseSampleGroupIw(group.id), `${group.group_code} approved and its IW raised.`)}>
            <Check className="h-4 w-4" />
            Approve &amp; Raise IW
          </Button>
        ) : (
          <Button size="md" disabled={isPending} onClick={() => run(() => approveSampleGroup(group.id), `${group.group_code} approved — the batch is fixed.`)}>
            <Check className="h-4 w-4" />
            Approve group
          </Button>
        );
      case "approved":
        return (
          <>
            <Button variant="outline" size="md" disabled={isPending} onClick={() => run(() => reopenSampleGroup(group.id), `${group.group_code} is a Draft again.`)}>
              <Undo2 className="h-4 w-4" />
              Back to Draft
            </Button>
            {/* Said in words, not as a disabled button's title — a disabled
                control gets no hover, so that reason could never be read. */}
            {perms.canRaiseIw ? (
              <Button size="md" disabled={isPending} onClick={() => run(() => raiseSampleGroupIw(group.id), `IW raised for ${group.group_code}.`)}>
                Raise IW
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Raising its IW needs Orders ▸ Create.</span>
            )}
          </>
        );
      case "po_raised":
        return (
          <Button size="md" disabled={isPending} onClick={() => run(() => markSampleGroupFabricReceived(group.id), `${group.group_code}: fabric received.`)}>
            <PackageCheck className="h-4 w-4" />
            Fabric received
          </Button>
        );
      case "fabric_received":
        return (
          <Button size="md" disabled={isPending || !!shortfall} onClick={() => run(() => distributeSampleGroup(group.id), `${group.group_code} distributed to its styles.`)}>
            <Split className="h-4 w-4" />
            Distribute fabric
          </Button>
        );
      default:
        return null;
    }
  })();

  const facts: [string, string][] = [
    ["Season", `${group.season} ${group.season_year}`],
    ["Structure", group.fabric_structure ?? "—"],
    ["Yarn blend", group.yarn_blend],
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{group.group_code}</span>
          <StatusPill tone={GROUP_STATUS_TONE[group.status]}>{GROUP_STATUS_LABEL[group.status]}</StatusPill>
        </span>
      }
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            {dirty ? "Cancel" : "Close"}
          </Button>
          {dirty ? (
            <Button size="md" disabled={isPending} onClick={save}>
              {isPending ? "Saving…" : "Save group"}
            </Button>
          ) : null}
          {step}
        </>
      }
    >
      <div className="space-y-5">
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex min-w-0 items-baseline gap-2">
              <dt className={label10}>{k}</dt>
              <dd className="m-0 text-sm font-medium">
                <Truncated className="block max-w-[22rem]">{v}</Truncated>
              </dd>
            </div>
          ))}
          {group.iwo_id ? (
            <div className="flex items-baseline gap-2">
              <dt className={label10}>IW</dt>
              <dd className="m-0 text-sm font-medium">
                <Link href={`/sales/sample-fabric-plan?open=${group.iwo_id}`} className="font-mono text-primary hover:underline">
                  {group.iwo_code ?? "Open"}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>

        {/* 88 hug ×2 + 112 range + 288 name + 3 × 12 gap = 612px → max-w-[40rem]. */}
        <section className="max-w-[40rem]">
          <FieldRow align="start">
            <Field label="MOQ (kg)" w="hug" required error={problems.moq} htmlFor="grp-moq">
              <Input id="grp-moq" type="number" inputMode="decimal" min={0} className="text-right tabular-nums" value={terms.moq} onChange={set("moq")} readOnly={!draft || !perms.canEdit} />
            </Field>
            <Field label="Batch (kg)" w="hug" required error={problems.batch} htmlFor="grp-batch">
              <Input id="grp-batch" type="number" inputMode="decimal" min={0} className="text-right tabular-nums" value={terms.batch} onChange={set("batch")} readOnly={!draft || !perms.canEdit} />
            </Field>
            <Field label="Cutting waste %" w="range" error={problems.waste} htmlFor="grp-waste">
              <Input id="grp-waste" type="number" inputMode="decimal" min={0} className="text-right tabular-nums" value={terms.waste} onChange={set("waste")} readOnly={done || !perms.canEdit} />
            </Field>
            <Field label="Remarks" w="name" htmlFor="grp-remarks">
              <Input id="grp-remarks" value={terms.remarks} onChange={set("remarks")} readOnly={done || !perms.canEdit} />
            </Field>
          </FieldRow>
        </section>

        {/* THE BATCH, IN ONE LINE (spec §5): net → bought → released → left in stock. */}
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-y border-border py-3">
          <div className="flex items-baseline gap-2">
            <dt className={label10}>Net</dt>
            <dd className="m-0 font-mono text-sm font-semibold tabular-nums">{fmtKg(net)} kg</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className={label10}>Buy</dt>
            <dd className="m-0 font-mono text-sm font-semibold tabular-nums text-primary">
              {fmtKg(buy, 1)} kg
              <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">{purchaseBasis(net, draft ? moq : group.moq_kg, draft ? batch : group.batch_kg)}</span>
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className={label10}>Release</dt>
            <dd className="m-0 font-mono text-sm tabular-nums">{fmtKg(release)} kg</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className={label10}>To sample stock</dt>
            <dd className={`m-0 font-mono text-sm tabular-nums ${toStock < 0 ? "text-danger" : ""}`}>{fmtKg(toStock)} kg</dd>
          </div>
        </dl>
        {shortfall && group.status !== "completed" ? <p className="text-sm text-danger">{shortfall}</p> : null}

        <div className="w-fit max-w-full">
          <DataTable columns={withCreatedColumns(itemColumns, group.items)} rows={group.items} getKey={(it) => it.id} compact paginate={false} empty="No styles in this group." />
        </div>
      </div>
    </Sheet>
  );
}
