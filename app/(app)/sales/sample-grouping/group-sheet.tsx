"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  GROUP_STATUS_LABEL,
  GROUP_STATUS_TONE,
  type GroupingCandidate,
  type GroupItemRow,
  type GroupRow,
} from "@/lib/sales/sample-grouping/types";
import {
  addToSampleGroup,
  approveAndRaiseSampleGroupIw,
  approveSampleGroup,
  raiseSampleGroupIw,
  removeFromSampleGroup,
  reopenSampleGroup,
  saveSampleGroupDescription,
} from "@/lib/sales/sample-grouping/actions";

/**
 * ONE GROUP — its description, its samples and the one next step.
 *
 * THE SWO IS MADE HERE AND ENDS AT ITS IW (user 2026-10-12: "remove that
 * distribute to fabric — no need that route — just here the group will be
 * created"). Fabric received → Distribute are gone; the fabric is followed on
 * the SWO's Fabric Plan. The terms (MOQ / batch / cutting waste) and the kg
 * figures came off the sheet the same day — the stored defaults (0702: 60 /
 * 30 / 0) still size the purchase on the server.
 *
 * NO FACTS LINE (user 2026-10-12, "remove it"): Season / Structure / Yarn
 * blend / IW are gone from the top; the IW opens from the list's row icon.
 *
 * ONE TYPED FIELD: Description (0712). It opens on the SWO number and the
 * operator may rewrite it; saving the number unchanged stores NULL, so the
 * number is a default, never a stale copy.
 *
 * ONE FILLED BUTTON (AGENTS.md "Buttons"): Save while the description is
 * changed, else the next step — hidden while dirty, so a step never runs over
 * an unsaved edit.
 */

export function GroupSheet({
  group,
  addable,
  perms,
  onClose,
}: {
  group: GroupRow;
  /** Ungrouped, weighed samples of this SWO's season — what "+ Add" offers. */
  addable: GroupingCandidate[];
  perms: { canEdit: boolean; canRaiseIw: boolean };
  onClose: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const savedDesc = group.description ?? group.group_code;
  const [desc, setDesc] = useState(savedDesc);
  const dirty = desc.trim().toUpperCase() !== savedDesc.trim().toUpperCase();
  useUnsavedGuard(dirty || isPending);

  const [adding, setAdding] = useState("");

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

  /** An SWO may mix structures or blends (0707, the planner's call) — then
   *  each sample says which fabric its kilos are of. */
  const mixed = new Set(group.items.map((it) => `${it.fabric_structure_id ?? ""}|${it.blend_key}`)).size > 1;
  const itemColumns: Column<GroupItemRow>[] = [
    {
      // The SMP number, and only it (client spec 2026-10-12 §5: "replace all
      // instances of PRD Number with SMP Number") — the PRD sub-line is gone.
      header: "SMP No",
      cell: (it) => <span className="font-mono text-xs">{it.enquiry_no ?? "—"}</span>,
    },
    { header: "Style", cell: (it) => <Truncated className="block max-w-[12rem] text-xs font-medium">{it.style_name || "—"}</Truncated> },
    ...(mixed
      ? [
          {
            header: "Fabric · yarn",
            cell: (it: GroupItemRow) => (
              <Truncated className="block max-w-[14rem] text-xs">
                {[it.fabric_structure, it.yarn_blend ?? it.blend_key].filter(Boolean).join(" · ")}
              </Truncated>
            ),
          },
        ]
      : []),
    { header: "Qty (pcs)", align: "right", cell: (it) => <span className="block text-right font-mono tabular-nums text-xs">{it.sample_qty_pcs}</span> },
  ];
  // Samples stay editable at every status (0713, user 2026-10-12).
  if (perms.canEdit) {
    itemColumns.push(
      rowActionsColumn((it) => (
        <RowActions
          label={it.enquiry_no ?? it.style_name}
          view={false}
          lead={
            <RowIconAction
              label="Remove from group"
              name={it.enquiry_no ?? it.style_name}
              icon={X}
              danger
              disabledReason={group.items.length <= 1 ? "The group's only style — delete the group instead." : null}
              onClick={() => run(() => removeFromSampleGroup(group.id, it.id), `${it.enquiry_no ?? "Style"} removed from ${group.group_code}.`)}
            />
          }
        />
      )),
    );
  }

  /** The one next step, by status. Hidden while the description is unsaved. */
  const step = (() => {
    if (!perms.canEdit || dirty) return null;
    switch (group.status) {
      case "draft":
        // ONE CLICK (user 2026-10-09): approve and raise the IW together. Someone
        // who cannot raise IWs still approves — the IW is then raised by
        // someone who can, from the Approved group's own "Raise SWO".
        // Labelled SWO, not IW (user 2026-10-12): the operator knows the batch by
        // its SWO number; the SIW work order stays underneath.
        return perms.canRaiseIw ? (
          <Button size="md" disabled={isPending} onClick={() => run(() => approveAndRaiseSampleGroupIw(group.id), `${group.group_code} approved and raised.`)}>
            <Check className="h-4 w-4" />
            Approve &amp; Raise SWO
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
              <Button size="md" disabled={isPending} onClick={() => run(() => raiseSampleGroupIw(group.id), `${group.group_code} raised.`)}>
                Raise SWO
              </Button>
            ) : (
              // nav-path: exempt -- "Orders ▸ Create" names the permission, not a menu row
              <span className="text-sm text-muted-foreground">Raising the SWO needs Orders ▸ Create.</span>
            )}
          </>
        );
      default:
        return null;
    }
  })();

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
            <Button size="md" disabled={isPending} onClick={() => run(() => saveSampleGroupDescription(group.id, desc), `${group.group_code} saved.`)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {step}
        </>
      }
    >
      <div className="space-y-5">
        {/* name-step width: a short batch name, not prose. */}
        <section className="max-w-[24rem]">
          <Field label="Description" w="name" htmlFor="grp-desc">
            <Input id="grp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} readOnly={!perms.canEdit} maxLength={500} />
          </Field>
        </section>


        {perms.canEdit && addable.length ? (
          <div className="flex items-center gap-2">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a sample" className="w-72">
              <option value="">Add a sample…</option>
              {addable.map((c) => (
                <option key={c.key} value={c.key}>
                  {[c.enquiry_no, c.style_name].filter(Boolean).join(" · ")}
                </option>
              ))}
            </Select>
            {/* toolbar-size: exempt -- an inline add beside a picker inside the sheet, not a header row */}
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || !adding}
              onClick={() =>
                run(async () => {
                  const res = await addToSampleGroup(group.id, [adding]);
                  if (res.ok) setAdding("");
                  return res;
                }, `Added to ${group.group_code}.`)
              }
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        ) : null}

        <div className="w-fit max-w-full">
          <DataTable columns={withCreatedColumns(itemColumns, group.items)} rows={group.items} getKey={(it) => it.id} compact paginate={false} empty="No styles in this group." />
        </div>
      </div>
    </Sheet>
  );
}
