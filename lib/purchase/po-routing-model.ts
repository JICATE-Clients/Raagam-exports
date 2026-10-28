import type { ApprovalCriteria, ApprovalFlow, ApprovalFlowDraft, ApprovalStep } from "@/lib/approvals/types";

/**
 * PO APPROVAL ROUTING, AS ONE SCREEN READS IT (user 2026-10-28).
 *
 * Purchase ▸ PO Approval Routing shows who approves a PO — per item class, above
 * budget, and everything else — and which approver outranks which when a PO mixes
 * classes. It is NOT a second store: it reads and writes the `purchase_order`
 * approval flows the engine routes by (0765), so Approvals ▸ Flows and this screen
 * are two views of the same rows and can never disagree.
 *
 * The mapping, one way and back:
 *   above budget  ↔ the flow whose criteria are exactly {above_budget: true}, priority 100
 *   a class       ↔ a flow per APPROVER: {item_classes: {any: [its classes]}}
 *   seniority     ↔ those flows' priority order (200, 210, 220 …) — first match wins,
 *                   so the most senior approver's flow is checked first
 *   anything else ↔ the catch-all, criteria {}, priority 900
 *
 * Client-safe on purpose: the screen's "Try it" preview builds the drafts with the
 * same function the save sends, and resolves them with the engine's own preview
 * matcher (`resolveFlowPreview`), so the preview cannot describe a routing other
 * than the one Save would write.
 */

export const PO_WORKFLOW = "purchase_order";

export type PoRouting = {
  aboveBudgetRole: string;
  /** Item class code → approver role. "" = no approver of its own (the catch-all takes it). */
  classRoles: Record<string, string>;
  /** Approver roles in use for classes, most senior first. */
  seniority: string[];
  defaultRole: string;
};

export const ABOVE_BUDGET_NAME = "Purchase Order — above budget";
export const DEFAULT_NAME = "Purchase Order — default";
export const classFlowName = (role: string) => `Purchase Order — ${role}`;

const ABOVE_PRIORITY = 100;
const CLASS_PRIORITY = 200;
const CLASS_STEP = 10;
const DEFAULT_PRIORITY = 900;

const keysOf = (c: ApprovalCriteria | null | undefined) => Object.keys(c ?? {});
const isAbove = (f: ApprovalFlow) => keysOf(f.criteria).length === 1 && f.criteria.above_budget === true;
const isDefault = (f: ApprovalFlow) => keysOf(f.criteria).length === 0;
/** A flow this screen can express for classes: ONLY an `item_classes` "includes any of". */
function classesOf(f: ApprovalFlow): string[] | null {
  const c = f.criteria ?? {};
  if (keysOf(c).length !== 1) return null;
  const cond = c.item_classes;
  if (!cond || typeof cond !== "object" || !("any" in cond) || !Array.isArray(cond.any)) return null;
  return cond.any.map(String);
}
const firstRole = (f: ApprovalFlow) => f.steps?.[0]?.approver_role_key ?? "";
const byPriority = (a: ApprovalFlow, b: ApprovalFlow) =>
  a.priority - b.priority || a.created_at.localeCompare(b.created_at);

/**
 * Read the active flows into the screen's shape. A class claimed by two flows
 * belongs to the earlier one — the same first-match-wins the engine uses.
 * `others` are active flows this screen cannot express (an amount rule, a
 * two-condition rule); they are left exactly as they are and counted on screen.
 */
export function routingFromFlows(flows: ApprovalFlow[], classCodes: string[]): { routing: PoRouting; others: ApprovalFlow[] } {
  const active = flows.filter((f) => f.workflow_key === PO_WORKFLOW && f.is_active).sort(byPriority);
  const classRoles: Record<string, string> = Object.fromEntries(classCodes.map((c) => [c, ""]));
  const seniority: string[] = [];
  const others: ApprovalFlow[] = [];
  let aboveBudgetRole = "";
  let defaultRole = "";
  for (const f of active) {
    const classes = classesOf(f);
    if (isAbove(f) && !aboveBudgetRole) aboveBudgetRole = firstRole(f);
    else if (isDefault(f) && !defaultRole) defaultRole = firstRole(f);
    else if (classes) {
      const role = firstRole(f);
      let claimed = false;
      for (const code of classes) {
        if (code in classRoles && !classRoles[code]) {
          classRoles[code] = role;
          claimed = true;
        }
      }
      if (claimed && role && !seniority.includes(role)) seniority.push(role);
    } else others.push(f);
  }
  return { routing: { aboveBudgetRole, classRoles, seniority, defaultRole }, others };
}

/** Keep `seniority` to the roles actually in use: new ones join at the bottom, unused ones leave. */
export function syncSeniority(classRoles: Record<string, string>, seniority: string[]): string[] {
  const used = new Set(Object.values(classRoles).filter(Boolean));
  const kept = seniority.filter((r) => used.has(r));
  for (const r of Object.values(classRoles)) if (r && !kept.includes(r)) kept.push(r);
  return kept;
}

/** One single-step flow to `role` — or the existing steps unchanged when they already go there
 *  (an SLA set on Approvals ▸ Flows survives a save here). */
function stepsFor(role: string, existing: ApprovalFlow | undefined): ApprovalStep[] {
  if (existing && existing.steps?.length && firstRole(existing) === role) return existing.steps;
  return [{ step_order: 1, step_label: role, step_type: "final", approver_role_key: role } as ApprovalStep];
}

export type RoutingPlan = {
  /** Upserted, in this order. */
  save: ApprovalFlowDraft[];
  /** Existing class flows the new routing no longer uses — switched off, never deleted. */
  retire: string[];
};

/**
 * The flows a routing becomes. `flows` is every purchase_order flow, active or not,
 * so a name used before is reused (switched back on) rather than duplicated.
 */
export function planRouting(routing: PoRouting, flows: ApprovalFlow[]): RoutingPlan {
  const po = flows.filter((f) => f.workflow_key === PO_WORKFLOW);
  const named = (name: string) => po.find((f) => f.flow_name === name);
  const draft = (
    name: string,
    description: string,
    criteria: ApprovalCriteria,
    role: string,
    priority: number,
  ): ApprovalFlowDraft => {
    const existing = named(name);
    return {
      ...(existing ? { id: existing.id } : {}),
      workflow_key: PO_WORKFLOW,
      flow_name: name,
      description,
      tenant_id: existing?.tenant_id ?? null,
      location_id: existing?.location_id ?? null,
      criteria,
      steps: stepsFor(role, existing),
      priority,
      is_active: true,
    } as ApprovalFlowDraft;
  };

  const save: ApprovalFlowDraft[] = [
    draft(
      ABOVE_BUDGET_NAME,
      "A rate above the approved order budget, or a line with no approved budget. Set on Purchase ▸ PO Approval Routing.",
      { above_budget: true },
      routing.aboveBudgetRole,
      ABOVE_PRIORITY,
    ),
  ];
  routing.seniority.forEach((role, i) => {
    const classes = Object.entries(routing.classRoles)
      .filter(([, r]) => r === role)
      .map(([code]) => code)
      .sort();
    if (classes.length === 0) return;
    save.push(
      draft(
        classFlowName(role),
        `Within budget: ${classes.join(", ")}. Seniority ${i + 1} — a PO mixing classes goes to the most senior approver. Set on Purchase ▸ PO Approval Routing.`,
        { item_classes: { any: classes } },
        role,
        CLASS_PRIORITY + i * CLASS_STEP,
      ),
    );
  });
  save.push(
    draft(
      DEFAULT_NAME,
      "Every PO no other flow takes. Set on Purchase ▸ PO Approval Routing.",
      {},
      routing.defaultRole,
      DEFAULT_PRIORITY,
    ),
  );

  const keep = new Set(save.map((d) => d.flow_name));
  const retire = po.filter((f) => f.is_active && classesOf(f) && !keep.has(f.flow_name)).map((f) => f.id);
  return { save, retire };
}

/** What the screen must refuse to save. "" = fine. */
export function routingProblem(r: PoRouting): string {
  if (!r.aboveBudgetRole) return "Choose who approves a PO above budget";
  if (!r.defaultRole) return "Choose who approves every other PO";
  return "";
}
