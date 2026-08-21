/**
 * Copying a TA Style template into a TA Plan.
 *
 * `ta_styles` + `ta_style_activities` (0133) is the reusable ladder; `ta_plan_docs`
 * + `ta_plan_activities` (0271 · 0401) is the document a planner fills in for one
 * order. Until 0453 NOTHING connected them — both had existed for months and the
 * only way to get one into the other was to retype it.
 *
 * ## THE COPY IS A SNAPSHOT
 *
 * The rows are WRITTEN into the plan and the plan then owns them. A later edit to
 * the template does not reach back, and there is deliberately no staleness check
 * of the kind `basisFingerprint` gives the Material BOM: a plan is a commitment
 * with real dates on it, and a template edit silently moving them is how a floor
 * comes to work to dates nobody agreed. `ta_plan_docs.ta_style_id` records where
 * the ladder came from and nothing more.
 *
 * ## WHAT IS COPIED AND WHAT IS NOT
 *
 * The template carries `activity_id`, `from_activity_id` and `days_required` —
 * the SHAPE of the work. It carries no dates at all, and cannot: a template is
 * reusable precisely because it is not tied to one delivery date. So the copy
 * produces rows with `start_date` and `end_date` NULL, and the dates arrive
 * separately from `backwardSchedule` once the plan has a delivery date.
 *
 * That separation is the point. Two operations the planner can see and re-run
 * independently — "fill the ladder" and "date it" — rather than one button that
 * does both and cannot be partly undone.
 *
 * ## `lead_days` AND `start_days` HAVE NOWHERE TO GO, AND SAYING SO IS THE HONEST
 * ## ANSWER
 *
 * `ta_styles` carries both, and `ta_plan_docs` has no column for either — it has
 * `start_date`, `target_date` and `no_of_days`, which are outputs rather than
 * inputs. They are therefore reported by `templateSummary` for the screen to
 * show, and NOT silently folded into a date. Folding them in would invent an
 * arithmetic the template's own screen does not perform (`ta-style-screen`
 * computes `target_days = lead + start + Σ days` and stops there), and inventing
 * one here would make the two screens disagree about a number they both display.
 */

import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";

export type { Refusal };
export { isRefusal };

/** One template row, as much of it as the copy needs. */
export type TemplateActivity = {
  sno: number;
  activity_id: string | null;
  from_activity_id: string | null;
  days_required: number | null;
};

/** The template header, as much of it as the copy needs. */
export type TemplateHeader = {
  id: string;
  code: string | null;
  description: string | null;
  lead_days: number | null;
  start_days: number | null;
  activities: readonly TemplateActivity[];
};

/** One plan row, in the shape `taPlanActivityInput` accepts. */
export type PlanActivity = {
  sno: number;
  activity_id: string | null;
  from_activity_id: string | null;
  details: string | null;
  start_date: string | null;
  days_required: number | null;
  end_date: string | null;
};

/**
 * The template's rows, as plan rows.
 *
 * ## IT REFUSES ON AN UNUSABLE TEMPLATE RATHER THAN COPYING A HOLE
 *
 * The convention every engine in this app follows, and the reason is the same
 * here as for a BOM quantity: a ladder half-copied still LOOKS like a ladder.
 * A template row with no activity produces a plan row with an empty Activity
 * cell, which reads as a row the planner forgot to fill in rather than one the
 * template could not supply — and the planner will fill it in, silently
 * diverging from the template they thought they applied.
 *
 * A row with no `days_required` is NOT refused. Zero is a real answer there: two
 * activities can legitimately share a date (cut and issue on the same day), and
 * `ta_style_activities.days_required` is `not null default 0`, so a template
 * that never touched the field is the ordinary case rather than a broken one.
 * `backwardSchedule` refuses a NULL later if one reaches it, which is the right
 * place — by then the operator is asking for dates.
 *
 * ## SNO IS RE-NUMBERED FROM 1, NOT CARRIED
 *
 * A template's `sno` can have gaps — rows get deleted and the remainder are not
 * re-numbered. Carried across, those gaps become gaps in the plan's own ordering,
 * and `ta_plan_activities` is read back `.sort((a, b) => a.sno - b.sno)`, so the
 * grid would still LOOK right while every subsequent insert had to guess a free
 * number. Re-numbering makes the plan's ladder self-consistent from the start.
 */
export function templateActivities(t: TemplateHeader): PlanActivity[] | Refusal {
  const rows = [...(t.activities ?? [])].sort((a, b) => a.sno - b.sno);

  if (rows.length === 0) {
    return {
      refused: `${t.code || "That template"} has no activities to copy`,
    };
  }

  const out: PlanActivity[] = [];
  for (const [i, r] of rows.entries()) {
    if (!r.activity_id) {
      return {
        refused: `${t.code || "That template"} has a row with no activity (row ${i + 1}) — fix the template first`,
      };
    }
    out.push({
      sno: i + 1,
      activity_id: r.activity_id,
      from_activity_id: r.from_activity_id,
      // The template has no Details field. NULL rather than "" so the plan's own
      // column reads as never-filled rather than deliberately cleared.
      details: null,
      // NO DATES. See the header — a template is not tied to a delivery date, and
      // dating the ladder is `backwardSchedule`'s separate, re-runnable job.
      start_date: null,
      days_required: r.days_required ?? 0,
      end_date: null,
    });
  }
  return out;
}

/**
 * What the screen says before it overwrites anything.
 *
 * ## THE CONFIRM IS PART OF THE FEATURE, NOT DECORATION
 *
 * Applying REPLACES the grid, and the rows it replaces may carry dates the
 * planner typed or scheduled. A confirm that says "are you sure?" tells them
 * nothing they did not already know; one that names HOW MANY rows are about to
 * go, and what arrives instead, is the difference between a decision and a
 * reflex. So the counts are computed here rather than phrased at the call site,
 * where the next screen to use this would word it differently.
 */
export function applyWarning(t: TemplateHeader, existingRows: number): string | null {
  if (existingRows <= 0) return null;
  const incoming = t.activities?.length ?? 0;
  return (
    `This replaces the ${existingRows} activit${existingRows === 1 ? "y" : "ies"} already on ` +
    `this plan with the ${incoming} from ${t.code || "the template"}. ` +
    `Any dates typed against them are lost.`
  );
}

/**
 * The template's own figures, for the screen to show beside the picker.
 *
 * `lead_days` and `start_days` have no column on the plan (see the header), so
 * they are SHOWN rather than stored. `targetDays` is the same sum
 * `ta-style-screen` puts in its footer — reproduced here so the two screens
 * cannot print different totals for one template, which is the drift this
 * codebase records under `created_by` and nominated vendors alike.
 */
export function templateSummary(t: TemplateHeader): {
  activities: number;
  workDays: number;
  leadDays: number;
  startDays: number;
  targetDays: number;
} {
  const workDays = (t.activities ?? []).reduce((sum, a) => sum + (Number(a.days_required) || 0), 0);
  const leadDays = Number(t.lead_days) || 0;
  const startDays = Number(t.start_days) || 0;
  return {
    activities: t.activities?.length ?? 0,
    workDays,
    leadDays,
    startDays,
    targetDays: leadDays + startDays + workDays,
  };
}
