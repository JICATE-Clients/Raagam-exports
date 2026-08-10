/* =============================================================================
 * WHAT IS WRONG WITH THIS RECORD, AND WHICH SECTION IT IS IN.
 *
 * BOUNDARY CONTRACT — see the header of `./workflow.ts`. Pure, JSX-free,
 * loadable by plain Node. The React hook that wraps this lives in
 * `components/screens/use-section-validity.ts`; the computation is here because
 * the SERVER runs it too (`checkRules`), and a screen and its action deciding
 * "is this complete" by two different code paths is the drift AGENTS.md's
 * "one declaration, four enforcers" rule exists to prevent.
 *
 * WHY IT CANNOT BE READ OFF THE DOM. The obvious implementation — on Save,
 * `querySelector('[data-required-empty], [data-dup-error]')` and focus it —
 * cannot work on a rail editor. `MasterFullScreen` renders `{active?.content}`:
 * exactly ONE section is mounted at a time. A blank mandatory field on an
 * inactive section has no DOM node, so it carries no marker, so the query finds
 * nothing and Save stays mysteriously dead. Validity is computed from state;
 * the DOM is consulted only AFTER the target section has mounted.
 *
 * The bug this closes, verified: `customer-master-screen.tsx:1649` and
 * `vendor-master-screen.tsx:2240` both read
 *   canSave: !!form.name.trim() && !gstDupError && !nameDupError
 * where the two errors render in two DIFFERENT sections. The rail shows a
 * "has data" dot per section and nothing else, and `MasterFullScreen` exposes no
 * way for a parent to switch section — so Save goes dead with no error on screen
 * and no route to the one that caused it.
 * ========================================================================== */

import { validateFormat, type FormatKind } from "@/lib/validation/formats";

/**
 * Ordered most-specific first. This is the same precedence `holdReason()` in
 * `components/shell/keyboard-nav-provider.tsx` already applies when a field is
 * somehow both: "already exists" is the more useful thing to say than "this is
 * required", because it tells the operator what to do differently.
 */
export const PROBLEM_ORDER = ["duplicate", "required", "format", "custom"] as const;

export type ProblemKind = (typeof PROBLEM_ORDER)[number];

export type Problem = {
  /** Which section it lives in — the one thing the current screens never record. */
  section: string;
  /** DOM id of the offending control, when the field declares one. Without it
   *  the reveal falls back to the first marker in the section, which is right
   *  far more often than not but is not the same promise. */
  fieldId?: string;
  /** The field's label, for a summary line that names fields rather than counts. */
  label: string;
  /** What the operator is told. "GST number already exists." */
  message: string;
  kind: ProblemKind;
};

/**
 * One field's contribution, declared WITH its section.
 *
 * `empty` is the caller's judgement because only it knows what empty means: a
 * `<Select>` is its value being `""`, a picker its id being `null`, a checkbox
 * is never empty. This mirrors `useRequiredHold`'s `empty` argument in
 * `components/ui/field.tsx` for the same reason.
 */
export type FieldCheck<V> = {
  section: string;
  id?: string;
  label: string;
  /**
   * Mandatory. A field HIDDEN by its section's or its own `when` must not reach
   * this list at all — the caller filters first, so "requiring a hidden field"
   * is unrepresentable here rather than merely discouraged. AGENTS.md:
   * "requiring a hidden field is a record that cannot be saved with nothing on
   * screen to say why."
   */
  required?: boolean;
  empty: (v: V) => boolean;
  /** Checked only when the value is non-empty — a blank optional field is not a
   *  malformed one, and reporting it as such is how a form starts shouting at an
   *  operator who has not typed anything yet. */
  format?: FormatKind;
  /** The raw string to run `format` against. Omit when `format` is omitted. */
  text?: (v: V) => string | null | undefined;
};

/**
 * Every problem in the record, ordered by kind then by declaration order.
 *
 * `extra` is for the live answers a screen already computes and this module
 * cannot: `useDuplicateName`'s return value, `missingRequiredMaterialFields`,
 * a cross-field rule. They arrive already carrying their section, which is the
 * whole point — the current screens compute exactly these and then throw the
 * location away.
 */
export function collectProblems<V>(args: {
  sections: readonly { key: string; when?: (v: V) => boolean }[];
  values: V;
  fields: readonly FieldCheck<V>[];
  extra?: readonly Problem[];
}): Problem[] {
  const { sections, values, fields, extra } = args;

  const visible = new Set(
    sections.filter((s) => s.when?.(values) !== false).map((s) => s.key),
  );

  const found: Problem[] = [];

  for (const f of fields) {
    if (!visible.has(f.section)) continue;

    if (f.required && f.empty(values)) {
      found.push({
        section: f.section,
        fieldId: f.id,
        label: f.label,
        // The same wording `useRequiredHold` puts in `data-required-empty`, so
        // the rail badge, the toast and the cursor hold all say one thing.
        message: `${f.label} is required.`,
        kind: "required",
      });
      // A blank field is not also a malformed one.
      continue;
    }

    if (f.format && f.text) {
      const raw = f.text(values);
      if (raw != null && raw !== "") {
        const err = validateFormat(f.format, raw);
        if (err) {
          found.push({ section: f.section, fieldId: f.id, label: f.label, message: err, kind: "format" });
        }
      }
    }
  }

  for (const p of extra ?? []) {
    if (visible.has(p.section)) found.push(p);
  }

  const sectionRank = new Map(sections.map((s, i) => [s.key, i]));
  return found.sort((a, b) => {
    const byKind = PROBLEM_ORDER.indexOf(a.kind) - PROBLEM_ORDER.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    return (sectionRank.get(a.section) ?? 0) - (sectionRank.get(b.section) ?? 0);
  });
}

/**
 * Does this problem STOP the record being saved?
 *
 * TODO(you): implement this — see the note below. It decides two visible things
 * at once, which is why it is worth deciding rather than defaulting:
 *   1. `canSave` — a non-blocking problem must not deaden the Save button.
 *   2. the rail's red count — a section badge counts BLOCKING problems only, so
 *      a red "2" always means "two things are stopping you", never "two things
 *      you might want to look at".
 *
 * The interesting case is `"format"`. AGENTS.md pulls both ways on purpose:
 *
 *   - `data-dup-error` and `data-required-empty` HOLD the cursor, and the rule
 *     is explicit that a hold is only ever for an error that genuinely blocks
 *     Save. So `"duplicate"` and `"required"` are certainly blocking.
 *   - But a format error is live for a HALF-TYPED value. The GSTIN note in
 *     `consignee-master-screen.tsx` is the precedent: it is deliberately a plain
 *     amber advisory, NOT wired through `dupFieldProps`, precisely so it cannot
 *     cage an operator on a value they are in the middle of getting right.
 *   - Yet a saved record holding a malformed GSTIN is a real data problem, and
 *     the Zod schema will reject it at the server anyway — so treating format as
 *     non-blocking means the operator gets a server round trip and a toast
 *     instead of a rail badge.
 *
 * Roughly: blocking-format = catch it early but risk nagging mid-keystroke;
 * non-blocking-format = never nag, but the failure surfaces later and further
 * from the field. `"custom"` is the other open one — those come from a screen's
 * own cross-field rules, so they may deserve to always block.
 */
export function isBlocking(problem: Problem): boolean {
  // EVERYTHING BLOCKS EXCEPT `format`, and the line is drawn by one question:
  // is this a statement that the RECORD is incomplete, or that a VALUE is
  // malformed while it is still being typed?
  //
  //   required  — incomplete. Already holds the cursor (`data-required-empty`).
  //   duplicate — will be refused at Save either way. Already holds
  //               (`data-dup-error`).
  //   custom    — a screen's own cross-field rule, and those are completeness
  //               claims about the whole record: Material's mixing percentages
  //               "must add up to exactly 100%" is not a warning, it is the
  //               record not being finished. A screen that wants an advisory
  //               uses a field's `advisory` slot, which produces no Problem at
  //               all — so anything that reaches here was opted into.
  //
  // `format` is the exception because it alone fires against a HALF-TYPED
  // value. `consignee-master-screen.tsx` is the precedent: its GSTIN check is
  // deliberately plain amber text, never wired through `dupFieldProps`,
  // precisely so it cannot cage an operator on a value they are in the middle
  // of getting right. Nothing malformed reaches the database as a result —
  // `schemaFor`'s Zod rejects it at Save, on the server, where the lib/data-io
  // importers hit the same guard.
  //
  // Keeping this list identical to the two kinds that HOLD the cursor is the
  // property that matters: a red count on the rail and a cursor that will not
  // leave a field have to mean the same thing, or the operator learns to
  // distrust one of them.
  return problem.kind !== "format";
}

/** Blocking problems per section, for the rail's red count. Sections with none
 *  are absent rather than zero, so a caller can use `?? 0` and never render a
 *  badge reading "0". */
export function blockingBySection(problems: readonly Problem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of problems) {
    if (!isBlocking(p)) continue;
    out[p.section] = (out[p.section] ?? 0) + 1;
  }
  return out;
}

/**
 * Everything a record editor needs to know about its own state, in one call.
 *
 * DELIBERATELY NOT A HOOK. There is no state here — it is a derivation of
 * `values`, and a screen calls it during render. Wrapping it in `useMemo` would
 * be cargo cult: every caller builds its `fields` and `extra` arrays inline, so
 * the dependency array changes identity on every render anyway and the memo
 * would never hit. The work is O(fields) with a couple of `Set` lookups —
 * cheaper than the render it feeds.
 *
 * Staying a plain function is also what keeps this file loadable by plain Node,
 * so the server's `checkRules` reaches the same answer by the same code.
 *
 * `canSave` being DERIVED is the point. Every screen today hand-assembles it
 * (`!!form.name.trim() && !gstDupError && !nameDupError`), which is a list a
 * screen can forget to extend — and two of them already gate on errors from a
 * section the operator cannot see.
 */
export function sectionValidity<V>(args: {
  sections: readonly { key: string; when?: (v: V) => boolean }[];
  values: V;
  fields: readonly FieldCheck<V>[];
  extra?: readonly Problem[];
}): {
  /** Everything found, blocking or not, in precedence order. */
  problems: Problem[];
  /** Just the ones that stop a save. */
  blocking: Problem[];
  /** Section key → blocking count, for the rail badge. */
  bySection: Record<string, number>;
  canSave: boolean;
  /** What Save should reveal when it is blocked. Null when nothing blocks. */
  first: Problem | null;
} {
  const problems = collectProblems(args);
  const blocking = problems.filter(isBlocking);
  return {
    problems,
    blocking,
    bySection: blockingBySection(problems),
    canSave: blocking.length === 0,
    first: blocking[0] ?? null,
  };
}
