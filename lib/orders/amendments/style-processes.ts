/**
 * "Which processes may this order line name?" — the Style(s) ▸ Process screen.
 *
 * Client spec, 2026-08-12: the Process button on a Style line opens a screen
 * whose **Type** field offers two values — **Garment Process** and **Component
 * Process** — and whose process list is wired to the Process master.
 *
 * Client-safe on purpose (no `server-only`, the same shape as
 * `style-options.ts` beside it and `lib/masters/vendor-nominations.ts` that both
 * are modelled on): the narrowing runs in the browser inside the picker, so the
 * list changes as the operator changes Type. The server half is
 * `getProcessRows()` in `service.ts`, which is where the Supabase client is.
 *
 * ## Type is not a lookup, and must never become one
 *
 * `processes` (0227) already carries `for_garments` and `for_components` — the
 * master's own applicability flags, answering the very question Type asks. Type
 * therefore CHOOSES WHICH FLAG FILTERS THE LIST; it is not a vocabulary to seed.
 * Two `config_lookups` rows would be a second home for the same fact, and the
 * two would drift the moment someone ticked a flag on the master. 0411 records
 * the same decision on the database side, as a CHECK rather than an FK.
 *
 * ## A blank Type offers NOTHING, and says so
 *
 * This is the half that is easy to get wrong, and this repo has got it wrong
 * twice on the same shape — see the nominated-vendor rule, where a guard phrased
 * as "restrict only in case X" leaked the full list through every state that was
 * not X, and the first dropdown an operator opened listed every vendor.
 *
 * Here the leak would be worse than untidy. `kind` is part of 0411's unique key
 * and part of what the row MEANS, so a process chosen before Type is answered
 * can be left invalid by the answer: pick a garment-only process, then set Type
 * to Component, and the row now names a process the master says does not apply.
 * Empty-and-explain is the honest state, and the screen says "Pick a Type first"
 * rather than falling back to everything.
 *
 * That is deliberately the OPPOSITE of `componentsForCoordinate`, where a blank
 * coordinate offers every component. The difference is what the parent field
 * does: a coordinate NARROWS an otherwise-valid list, while Type DECIDES WHICH
 * LIST. Read the reasoning in both places before making them agree.
 *
 * ## The row's own value always survives
 *
 * Same reason as every other picker here (AGENTS.md "Disabled rows"): dropping
 * the held value would show a filled field as empty and blank the FK on the next
 * save. So a switched-off process, or one whose flag was unticked on the master
 * after this order named it, stays visible on the row that holds it — and only
 * there.
 */

import { z } from "zod";

/** The two values the client named. Stored in `..._style_processes.kind`. */
export type ProcessKind = "garment" | "component";

/**
 * Type's options, in the client's order.
 *
 * The VALUE is the storage token and the LABEL is the words on screen; they are
 * deliberately not the same string. `kind` is compared in SQL and in 0411's
 * CHECK, so it stays lower-case and stable, while the label is free to be
 * re-worded without a migration.
 */
export const PROCESS_KIND_OPTIONS: { value: ProcessKind; label: string }[] = [
  { value: "garment", label: "Garment Process" },
  { value: "component", label: "Component Process" },
];

export function isProcessKind(v: unknown): v is ProcessKind {
  return v === "garment" || v === "component";
}

export function processKindLabel(kind: ProcessKind | null): string {
  return PROCESS_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? "";
}

/**
 * A process as the picker needs it: identity, the disable flag, and the two
 * applicability flags the narrowing reads.
 *
 * The flags come down to the browser rather than being filtered in SQL for the
 * same reason the disable flag does — one fetch serves BOTH Types, so switching
 * Type must not cost a round trip, and a row the order already holds must stay
 * resolvable whatever its flags say now.
 */
export type ProcessOption = {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean;
  for_garments: boolean;
  for_components: boolean;
};

/** One row of the Process screen's grid, in client state. */
export type StyleProcessRow = {
  key: string;
  kind: ProcessKind | null;
  process_id: string | null;
  /**
   * The legacy grid's fourth column (0412). FREE TEXT, not a lookup — in the
   * client's screenshot the Process cell carries the ⓘ glyph and this one does
   * not, which on this app's icon-field convention is the difference between a
   * dropdown and a box you type in.
   *
   * `string` and not `string | null` because it is bound to an `<Input>`, whose
   * empty state is "". The null lives in the database and at the boundary.
   */
  details: string;
};

/**
 * The processes offered for a Type.
 *
 * `currentValue` is the id this row already holds; it is re-admitted after the
 * filter, never before it, so it survives without widening the list for any
 * other row.
 */
export function processesForKind(
  options: ProcessOption[],
  opts: { kind: ProcessKind | null; currentValue?: string | null },
): ProcessOption[] {
  const { kind, currentValue = null } = opts;

  // Blank Type offers nothing — see the header. The held value is still
  // returned, so an existing row never renders as empty while Type is being
  // re-answered.
  if (!kind) {
    const held = currentValue ? options.find((p) => p.id === currentValue) : undefined;
    return held ? [held] : [];
  }

  const flagged = options.filter((p) =>
    kind === "garment" ? p.for_garments : p.for_components,
  );
  if (!currentValue || flagged.some((p) => p.id === currentValue)) return flagged;

  const held = options.find((p) => p.id === currentValue);
  return held ? [...flagged, held] : flagged;
}

/**
 * Has the operator started this row?
 *
 * Two readers, as everywhere else in this repo: the save path drops a row this
 * calls false, and the screen marks a row's cells required only when it calls
 * true. One function so they cannot disagree — a disagreement is either a caged
 * operator on a row about to be discarded, or a half-filled row vanishing.
 */
export function styleProcessRowStarted(
  r: Pick<StyleProcessRow, "kind" | "process_id" | "details">,
): boolean {
  return !!r.kind || !!r.process_id || !!r.details.trim();
}

export const styleProcessInput = z.object({
  style_ref_no: z.string().optional().nullable(),
  sno: z.coerce.number().default(0),
  kind: z.enum(["garment", "component"]).nullable().default(null),
  process_id: z.string().uuid().nullable().default(null),
  /* Not capsed: a free-text remark, the same category `<Textarea>` content is
     exempted under in LAYOUT.md §11. Capsing an operator's note shouts it back. */
  details: z.string().optional().nullable(),
});
export type StyleProcessInput = z.infer<typeof styleProcessInput>;

/* THE NORMALIZER IS NOT HERE, DELIBERATELY. Dropping blank and orphaned rows,
   de-duplicating on (kind, process) and renumbering `sno` per style all live in
   `normalizeStyleProcesses` in actions.ts, beside `normalizeStyleSizes`, which
   answers the identical question for 0407 and needs the same `styleKey` and the
   same list of styles being written in this pass. A second copy here would be a
   second answer to "which rows is this save keeping?" — and the two would drift
   the first time an orphan rule changed on one side only. */

