"use client";

/**
 * RAISE REVISION on an approved sample plan — the Fabric Plan (0718, client
 * brief 2026-10-13 §2: "any changes to weights or processes must go through a
 * Fabric Plan Revision") and its twin the Accessories Plan (0720).
 *
 * One field, the reason, and it is mandatory — the revision log keeps it
 * beside the yarn weights that had been approved, and the approver reads it
 * when the revised plan comes back. Raising reopens the plan for editing and
 * pauses purchasing until the revision is approved.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { raiseFabricPlanRevision } from "@/lib/orders/iwo-fabric-bom/approval-actions";
import { raiseAccessoriesPlanRevision } from "@/lib/orders/iwo-material-bom/approval-actions";
import { PLAN_KIND_LABEL, type PlanKind } from "@/lib/sales/plan-reports/types";

/** One approved plan the sheet may raise a revision on (Sample ▸ Revision's header button). */
export type PlanRevisionChoice = { kind: PlanKind; bomId: string; planLabel: string; nextRevision: number };

export function PlanRevisionSheet({
  kind: fixedKind,
  bomId: fixedBomId,
  planLabel: fixedLabel,
  nextRevision: fixedNext,
  choices,
  origin,
  onClose,
  onRaised,
}: {
  /** The plan an editor names — required unless `choices` is given. */
  kind?: PlanKind;
  bomId?: string;
  /** The SWO number — what the operator calls the plan. */
  planLabel?: string;
  nextRevision?: number;
  /**
   * PICK THE PLAN HERE (Sample ▸ Revision's "+ Raise Revision", user
   * 2026-10-14). Given, the sheet opens with a Plan box over the reason and
   * raises on the plan picked; the four props above are then ignored. Absent,
   * it raises on the one plan its editor named — the editors' door, unchanged.
   */
  choices?: PlanRevisionChoice[];
  origin?: SheetOrigin | null;
  onClose: () => void;
  onRaised: (picked: PlanRevisionChoice) => void;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [reason, setReason] = useState("");

  /* THE CATEGORY FIRST, THEN THE SWO (user 2026-10-14: "should ask the kind,
     the category of the revision, like Order Entry revision"). Order Entry's
     Raise Revision opens with "Select Module Category to Revise"; this does the
     same over the two sample plans. Tick one or both: the SWO box then offers
     only SWOs whose every ticked plan is approved, and Raise reopens each. */
  const [cats, setCats] = useState<PlanKind[]>([]);
  const [swo, setSwo] = useState("");
  const swoOptions = choices
    ? [...new Set(choices.map((c) => c.planLabel))].filter((label) =>
        cats.every((k) => choices.some((c) => c.planLabel === label && c.kind === k)),
      )
    : [];
  const toggleCat = (k: PlanKind, on: boolean) => {
    const next = on ? [...cats.filter((x) => x !== k), k] : cats.filter((x) => x !== k);
    setCats(next);
    // A held SWO that no longer carries every ticked plan is cleared, not kept wrong.
    if (swo && !next.every((x) => choices?.some((c) => c.planLabel === swo && c.kind === x))) setSwo("");
  };
  /** The plans this raise reopens — fabric first, as the plans are made. */
  const plans: PlanRevisionChoice[] = choices
    ? swo
      ? (["fabric", "accessories"] as const)
          .filter((k) => cats.includes(k))
          .map((k) => choices.find((c) => c.planLabel === swo && c.kind === k))
          .filter((c): c is PlanRevisionChoice => !!c)
      : []
    : fixedKind && fixedBomId
      ? [{ kind: fixedKind, bomId: fixedBomId, planLabel: fixedLabel ?? "", nextRevision: fixedNext ?? 1 }]
      : [];

  function raise() {
    if (!plans.length) return;
    start(async () => {
      const opened: PlanRevisionChoice[] = [];
      for (const plan of plans) {
        const res = await (plan.kind === "fabric" ? raiseFabricPlanRevision : raiseAccessoriesPlanRevision)(plan.bomId, reason);
        if (!res.ok) {
          // Say which plan failed, and that any before it are already open.
          toastError(
            opened.length
              ? `${PLAN_KIND_LABEL[opened[0].kind]} revision opened, but the ${PLAN_KIND_LABEL[plan.kind]} could not be: ${res.error}`
              : res.error,
          );
          if (opened.length) onRaised(opened[0]);
          return;
        }
        opened.push({ ...plan, nextRevision: res.revisionNo ?? plan.nextRevision });
      }
      success(
        opened.length === 1
          ? `Revision ${opened[0].nextRevision} opened — edit the plan, save, then submit it for approval`
          : `Revisions opened on the ${opened.map((x) => PLAN_KIND_LABEL[x.kind]).join(" and ")} — edit each, save, then submit them for approval`,
      );
      onRaised(opened[0]);
    });
  }

  const single = !choices ? plans[0] : null;
  return (
    <Sheet
      open
      onClose={onClose}
      title={single ? `Raise Revision ${single.nextRevision} · ${single.planLabel}` : "Raise Revision"}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending || !plans.length || !reason.trim()} onClick={raise}>
            {isPending ? "Raising…" : "Raise Revision"}
          </Button>
        </>
      }
    >
      <FieldGrid>
        {choices ? (
          <>
            <Field label="Select Module Category to Revise" required size="full">
              <div className="space-y-2" role="group" aria-label="Module Category">
                {(["fabric", "accessories"] as const).map((k) => {
                  const any = choices.some((c) => c.kind === k);
                  return (
                    <label key={k} className={`flex items-start gap-2 ${any ? "cursor-pointer" : "opacity-50"}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        disabled={!any}
                        checked={cats.includes(k)}
                        onChange={(e) => toggleCat(k, e.target.checked)}
                      />
                      <span>
                        <span className="block text-sm font-medium">{PLAN_KIND_LABEL[k]}</span>
                        <span className="block text-xs text-muted-foreground">
                          {any ? CATEGORY_HINT[k] : `No approved ${PLAN_KIND_LABEL[k]} to revise.`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>
            <Field label="SWO No" required size="full" htmlFor="fp-rev-swo">
              <Select id="fp-rev-swo" required disabled={!cats.length} value={swo} onChange={(e) => setSwo(e.target.value)}>
                <option value="">{!cats.length ? "Tick a category first" : swoOptions.length ? "" : "No SWO has every ticked plan approved"}</option>
                {swoOptions.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
        <Field label="Why is the plan being revised?" required size="full" htmlFor="fp-rev-reason">
          <Textarea id="fp-rev-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </FieldGrid>
      <p className="mt-3 text-xs text-muted-foreground">
        {`The ${plans.length ? plans.map((x) => PLAN_KIND_LABEL[x.kind]).join(" and ") : "plan"} ${plans.length > 1 ? "open" : "opens"} for editing and purchasing pauses until the revised plan is approved. The quantities approved so far are kept on record.`}
      </p>
    </Sheet>
  );
}

/** What each category reopens — the line under its tick. */
const CATEGORY_HINT: Record<PlanKind, string> = {
  fabric: "Yarn, fabric weights, dyeing shades and processes of the SWO's Fabric Plan.",
  accessories: "Trims, consumption and purchase quantities of the SWO's Accessories Plan.",
};
