/**
 * "Who may own this T&A line?" — one answer, mirroring
 * `nominatedVendorOptions()` (`lib/masters/vendor-nominations.ts`) exactly in
 * shape: same three-field return, same "blank/unmapped -> empty + hint, never
 * a silent full list" rule, same "held value always survives" `keep()`
 * closure.
 *
 * A Task Owner is an `employees` row, scoped to the department that owns the
 * line's Activity — `ta_department_assign_lines` rows where `is_owner = true`
 * (confirmed 2026-09-09: the flag exists for exactly this purpose). See
 * `getTaOwnerDepartments()` in `lib/orders/amendments/service.ts` for the
 * loader, and its own comment for why the T&A worklist's `activityDepartments()`
 * is deliberately NOT reused here — that helper ignores `is_owner` on purpose,
 * because it answers a different question ("which departments touch this
 * activity at all", for the worklist) than this one does ("which department
 * OWNS it", for who may be assigned the task).
 *
 * Client-safe on purpose (no `server-only`, same shape as `inactive.ts` and
 * `vendor-nominations.ts`): the rule runs in the browser, inside the picker,
 * so the option list narrows as the operator fills in the row.
 *
 * ## The rule
 *
 *   activity              employees offered
 *   ---------------------  ---------------------------------------------------
 *   blank                  NONE — "pick an Activity first"
 *   no department mapped   NONE — "set one on T&A Department Assign"
 *   mapped                 that department's (or departments') active employees
 *
 * Empty-and-explain rather than falling back to the full employee list: a
 * silent fallback makes the department scoping advisory, and the operator
 * never learns the activity needs a department set on T&A Department Assign.
 */
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";

export type TaOwnerOption = { id: string; code: string | null; name: string } & Deactivatable;

export type TaOwnerEmployee = {
  id: string;
  code: string | null;
  name: string;
  department_id: string | null;
} & Deactivatable;

export type TaOwnerOptionsArgs = {
  activityId: string | null;
  /** activity_id -> department_id[], from `getTaOwnerDepartments()` — only
   *  `ta_department_assign_lines` rows marked `is_owner = true` (confirmed
   *  2026-09-09: the flag exists for exactly this purpose; the T&A worklist's
   *  own `activityDepartments()` deliberately ignores it and is NOT reused
   *  here for that reason). */
  departmentsByActivity: Record<string, string[]>;
  employees: TaOwnerEmployee[];
  currentValue?: string | null;
};

export type TaOwnerOptions = {
  items: TaOwnerOption[];
  hint: string | null;
  shortHint: string | null;
};

/**
 * The option list for ONE T&A line, plus the line to show when there are
 * none.
 *
 * **The employee a row already holds always survives** (`currentValue`),
 * even when the rule would exclude it — a department reassignment after the
 * line was saved, or an employee since deactivated. Dropping it renders a
 * filled field as empty and blanks the FK on the next save; silent data loss
 * dressed up as tidiness (AGENTS.md, "Disabled rows").
 */
export function taOwnerOptions({
  activityId,
  departmentsByActivity,
  employees,
  currentValue,
}: TaOwnerOptionsArgs): TaOwnerOptions {
  const keep = (items: TaOwnerOption[]): TaOwnerOption[] => {
    if (!currentValue || items.some((e) => e.id === currentValue)) return items;
    const held = employees.find((e) => e.id === currentValue);
    return held
      ? [...items, { id: held.id, code: held.code, name: held.name, inactive: held.inactive }]
      : items;
  };

  if (!activityId) {
    return {
      items: keep([]),
      hint: "Pick an Activity first — Task Owner is scoped to its department.",
      shortHint: "Pick Activity first",
    };
  }

  const deptIds = departmentsByActivity[activityId] ?? [];
  if (!deptIds.length) {
    return {
      items: keep([]),
      hint: "This activity has no department assigned yet — set one on T&A ▸ Department Assign.",
      shortHint: "No department assigned",
    };
  }

  const deptSet = new Set(deptIds);
  const items = employees
    .filter((e) => !isInactive(e) && !!e.department_id && deptSet.has(e.department_id))
    .map((e) => ({ id: e.id, code: e.code, name: e.name, inactive: e.inactive }));

  return { items: keep(items), hint: null, shortHint: null };
}
