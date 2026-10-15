"use client";

/**
 * Sample ▸ Revision ▸ Raise Revision — the door, as a PAGE, laid out after
 * Orders ▸ Order Revisions ▸ Raise Revision (user 2026-10-14: "like the order
 * entry revision, which is very clear and good — take reference from there").
 *
 * Four answers and the revision exists: WHICH SWO, WHO asked (origin — Orders'
 * own two, `AMENDMENT_ORIGINS`), WHICH PLANS (the module category — Fabric
 * Plan · Accessories Plan, ticked like Order Entry's four) and WHY (remarks,
 * mandatory). The revision number and the date are the server's.
 *
 * ONE RAISE, ONE TRANSACTION (0730 `raise_sample_plan_revisions`): both plans
 * reopen, or neither does — two calls from here used to leave the Fabric Plan
 * open when the Accessories Plan then refused. Raising lands on the revision's
 * WORKSPACE (`/sales/sample-revision/plan/<entry>`), on the first plan's tab,
 * as Order Entry's raise lands on the module picked.
 *
 * A plan can only be ticked while it is APPROVED: one never approved has
 * nothing to revise (Plan Approval is where it waits), and one already under a
 * revision must finish that one first. The box says which, rather than hiding.
 *
 * A page-level editor with its own Save: `data-focus-scope` on the form so Tab
 * stays inside it, and `useUnsavedGuard` while anything is typed.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate } from "@/lib/format";
import { today } from "@/lib/calendar";
import { AMENDMENT_ORIGINS, type AmendmentOrigin } from "@/lib/orders/amendments/amendment-entry";
import { raisePlanRevision } from "@/lib/sales/plan-revisions/actions";
import { planRevisionHref } from "@/lib/sales/plan-revisions/types";
import type { PlanApprovalRow } from "@/lib/sales/plan-reports/service";
import { PLAN_KIND_LABEL, type PlanKind } from "@/lib/sales/plan-reports/types";
import { planStatusText } from "../../plan-approval/plan-words";

const LIST = "/sales/sample-revision";

/** The module category, in the order the plans are made, with what each reopens. */
const PLAN_MODULES: { key: PlanKind; hint: string }[] = [
  { key: "fabric", hint: "yarn, fabric weights, dyeing shades and processes" },
  { key: "accessories", hint: "trims, consumption and purchase quantities" },
];

/** The SWO a plan belongs to — what the picker lists and the operator calls it. */
const swoOf = (r: PlanApprovalRow) => r.swoCode ?? r.iwoCode ?? r.bomId;

export function RaisePlanRevisionScreen({
  plans,
  initialPlanKey,
}: {
  /** Every sample plan at this unit, both kinds (`listPlanApprovals`). */
  plans: PlanApprovalRow[];
  /** `?plan=<kind>:<plan id>` — a row's Revise: its SWO picked and its plan ticked. */
  initialPlanKey?: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const initial = plans.find((p) => p.key === initialPlanKey && p.status === "approved") ?? null;
  const [swo, setSwo] = useState<string | null>(initial ? swoOf(initial) : null);
  const [modules, setModules] = useState<PlanKind[]>(initial ? [initial.kind] : []);
  const [origin, setOrigin] = useState<AmendmentOrigin>(AMENDMENT_ORIGINS[0].value);
  const [remarks, setRemarks] = useState("");
  const [tried, setTried] = useState(false);

  const dirty = !!swo || modules.length > 0 || remarks.trim() !== "";
  useUnsavedGuard(dirty || isPending);

  /** The SWO's plan of each kind, if it has one. */
  const planOf = (s: string | null, k: PlanKind) => (s ? (plans.find((p) => swoOf(p) === s && p.kind === k) ?? null) : null);
  const canRevise = (p: PlanApprovalRow | null) => !!p && p.status === "approved";

  /* Only SWOs with at least one APPROVED plan — anything else has nothing to revise. */
  const pickerRows = useMemo<PickerRow[]>(() => {
    const swos = [...new Set(plans.filter((p) => p.status === "approved").map(swoOf))];
    return swos.map((s) => {
      const mine = plans.filter((p) => swoOf(p) === s);
      return {
        id: s,
        label: s,
        sublabel: [mine[0]?.smpNos.join(", "), mine[0]?.season].filter(Boolean).join(" · ") || null,
      };
    });
  }, [plans]);

  const pickSwo = (s: string | null) => {
    setSwo(s);
    // A tick the new SWO cannot honour is dropped, not carried across.
    setModules((prev) => prev.filter((k) => canRevise(planOf(s, k))));
  };
  function toggleModule(k: PlanKind, on: boolean) {
    setModules((prev) => (on ? (prev.includes(k) ? prev : [...prev, k]) : prev.filter((x) => x !== k)));
  }

  /** Fabric first, as the plans are made — and the page lands on the first. */
  const picked = PLAN_MODULES.map((m) => m.key)
    .filter((k) => modules.includes(k))
    .map((k) => planOf(swo, k))
    .filter((p): p is PlanApprovalRow => canRevise(p));

  const swoError = tried && !swo ? "Pick the SWO to revise" : undefined;
  const modulesError = tried && swo && !picked.length ? "Tick at least one plan to revise" : undefined;
  const remarksError = tried && remarks.trim() === "" ? "Say why the plan is being revised" : undefined;
  const ready = !!swo && picked.length > 0 && remarks.trim() !== "";

  function raise() {
    if (!ready) {
      setTried(true);
      return;
    }
    const fabric = picked.find((p) => p.kind === "fabric") ?? null;
    const accessories = picked.find((p) => p.kind === "accessories") ?? null;
    startTransition(async () => {
      const res = await raisePlanRevision({
        fabricBomId: fabric?.bomId ?? null,
        accessoriesBomId: accessories?.bomId ?? null,
        reason: remarks.trim(),
        origin,
      });
      // Refused = nothing was reopened, so the page stays as typed.
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        picked.length === 1
          ? `Revision raised on ${swo} — the ${PLAN_KIND_LABEL[picked[0].kind]} is open for editing`
          : `Revision raised on ${swo} — the ${picked.map((x) => PLAN_KIND_LABEL[x.kind]).join(" and ")} are open for editing`,
      );
      // STRAIGHT TO THE WORK — the workspace, on the first plan's tab.
      router.push(planRevisionHref(res.entryId, picked[0].kind));
    });
  }

  const head = swo ? (plans.find((p) => swoOf(p) === swo) ?? null) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Raise Revision"
        description="Name the SWO, which plans change and why. Only the plans picked are unlocked and their purchasing pauses; the revised plan then goes back for approval."
      />

      {/* ONE CARD, WIDTH-LAID-OUT (Order Entry's raise, raagam-screen-layout):
          row 1 is Revision No `code` 144 + Date `code` 144 + SWO No `party` 200
          + Origin `code` 144, three 12px gaps = 668px — inside the same
          `max-w-[46rem]` (736px) cap, Order Entry's raise to the pixel;
          the category list and the remarks take the full card width beneath. */}
      <Card className="max-w-[46rem]">
        <CardBody>
          <form
            data-focus-scope
            onSubmit={(e) => {
              e.preventDefault();
              raise();
            }}
          >
            <FieldRow>
              <Field label="Revision No" w="code" htmlFor="rp-no">
                <Input id="rp-no" readOnly value="(auto)" />
              </Field>
              <Field label="Date" w="code" htmlFor="rp-date">
                <Input id="rp-date" readOnly value={fmtDate(today())} />
              </Field>
              <Field label="SWO No" required w="party" htmlFor="rp-swo" error={swoError}>
                <DataPicker
                  id="rp-swo"
                  label="SWO No"
                  title="SWOs with an approved plan"
                  compact
                  rows={pickerRows}
                  value={swo}
                  onChange={pickSwo}
                  required
                  invalid={!!swoError}
                  emptyHint="No SWO to revise — a revision is raised on a Fabric or Accessories Plan that Plan Approval has approved."
                />
              </Field>
              <Field label="Origin" required w="code" htmlFor="rp-origin">
                <Select id="rp-origin" required value={origin} onChange={(e) => setOrigin(e.target.value as AmendmentOrigin)}>
                  {AMENDMENT_ORIGINS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
            {head && (
              <p className="mt-1 text-xs text-muted-foreground">
                {[head.smpNos.join(", ") || null, head.season, head.iwoCode ? `IW ${head.iwoCode}` : null].filter(Boolean).join(" · ")}
              </p>
            )}

            {/* THE MODULE CATEGORY — Order Entry's numbered list, one per plan,
                each with what it reopens. A plan that cannot be revised stays
                listed, greyed, with the reason in the plan's own words. */}
            <Field label="Select Module Category to Revise" required className="mt-4" error={modulesError}>
              <div className="space-y-2" role="group" aria-label="Module Category">
                {PLAN_MODULES.map((m, i) => {
                  const p = planOf(swo, m.key);
                  const ok = canRevise(p);
                  const why = !swo
                    ? null
                    : !p
                      ? "no plan on this SWO"
                      : !ok
                        ? `${planStatusText(p).toLowerCase()} — ${p.revisionNo > 0 && p.status !== "approved" ? "finish that revision first" : "nothing approved to revise yet"}`
                        : `approved${p.revisionNo ? `, Rev #${p.revisionNo}` : ""} — next is Rev #${p.revisionNo + 1}`;
                  return (
                    <label key={m.key} className={`flex items-start gap-2 text-sm ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-primary"
                        checked={ok && modules.includes(m.key)}
                        disabled={!ok}
                        onChange={(e) => toggleModule(m.key, e.target.checked)}
                      />
                      <span>
                        <span className="font-medium">
                          {i + 1}. {PLAN_KIND_LABEL[m.key]}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">({m.hint})</span>
                        {why && <span className="block text-xs text-muted-foreground">{why}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>
            {picked.length > 0 && (
              <div className="mt-2 space-y-1 rounded-md border border-info bg-info-soft px-3 py-2 text-xs text-info" role="status">
                <p>
                  Unlocks the {picked.map((p) => PLAN_KIND_LABEL[p.kind]).join(" and ")} of {swo} — everything else stays as
                  approved.
                </p>
                <p>Purchasing on {picked.length === 1 ? "it" : "them"} pauses until the revised plan is approved; the quantities approved so far are kept on record.</p>
              </div>
            )}

            {/* Mandatory, holds the cursor while blank. Capitals stay the
                default: the Textarea exemption is withdrawn (AGENTS.md).
                spell-suggest: exempt -- a Textarea: ↓ and Enter mean next line / new line. */}
            <Field label="Revision Remarks" required htmlFor="rp-remarks" className="mt-4" error={remarksError}>
              <Textarea id="rp-remarks" rows={3} required value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3" data-focus-region="footer">
              <Button type="button" variant="outline" size="md" onClick={() => router.push(LIST)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" size="md" disabled={isPending}>
                {isPending ? "Raising…" : "Raise Revision"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
