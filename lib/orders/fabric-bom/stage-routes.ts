/**
 * "May this process run in the stage this row names, and is it allowed to be
 * the FIRST step of it?" — the Fabric Process route rule (0563).
 *
 * doc/order/fabriprocess.md §1 and §3, client recording 2026-09-16.
 *
 * Client-safe on purpose (no `server-only`), exactly like `./processes.ts`
 * which this file extends: the narrowing runs in the browser inside the
 * picker, so nothing about it costs a round trip. The server half is
 * `getFabricProcessOptions()` in `service.ts`, which reads
 * `process_fabric_stages` into each option's `stage_roles`.
 *
 * ## WHAT IT REFUSES, AND WHY THAT IS A LEDGER RULE RATHER THAN A TIDINESS ONE
 *
 * Fabric inventory is four physically distinct stock ledgers — Greige, Dyed,
 * Washed, Printed — and the STAGE on a route row is what decides which of them
 * a step's weight is logged against. So `Stage = Dyed, Process = Knitting` is
 * not a cosmetic slip: the weight lands in the Dyed ledger while the cloth is
 * still greige, and warehouse stock, material availability and financial
 * valuation are all wrong from there on. Nothing in 0492 constrained the pair —
 * Stage and Process are two independent ▾ columns and every combination of them
 * saved. This file is what makes the pair answerable.
 *
 * The refusal is spelled the way every other narrowing in this module is
 * spelled, and that is not a style choice — see `printBlocked` (0528) and
 * `dyeingBlocked` (0557) next door:
 *
 * - WITHHELD FROM THE OFFERED LIST, never blocked after the fact with a toast.
 * - THE VALUE A ROW ALREADY HOLDS ALWAYS SURVIVES (`currentValue`), because
 *   dropping it would show a filled field as empty and blank the FK on the next
 *   save — AGENTS.md "Disabled rows", the same rule for the same reason.
 * - AN INLINE TWIN NAMES WHY a held value is showing something the operator
 *   could not pick again today (`stageMismatchBlocked`, `baseProcessMissing`).
 *
 * ## WHY MANY-TO-MANY, AND NOT ONE FLAG PER PROCESS
 *
 * 0528's `is_print` and 0557's `is_dyeing` are both a single boolean because
 * both answer a question about the process ALONE. "Which stage does this
 * process belong to" is not such a question. §3's own table puts **Stentering**
 * in Dyed and Washed, and **Compacting** in Dyed, Washed and Printed — a
 * `processes.fabric_stage_id` column can hold one answer, so it would have to
 * pick one of the three and silently refuse the other two, and it would be
 * wrong for precisely the processes that occur most often. `is_base` rides on
 * the PAIRING for the same reason: a process is the base of at most one stage
 * while being a secondary step in several, so "is this the mandatory entry
 * step" is a property of the pair, not of either end.
 *
 * ## AN UNCLASSIFIED PROCESS IS OFFERED IN EVERY STAGE — AND THAT IS THE CALL
 *
 * A `for_fabric` process with no row in `process_fabric_stages` could mean
 * either "allowed everywhere" or "allowed nowhere", and the two readings are a
 * genuine fork rather than a detail. THIS FILE READS IT AS **EVERYWHERE**.
 *
 * The deciding argument is that the other reading strands the operator on day
 * one, and the numbers are not close. 0563 classifies what §3's table names,
 * by matching the master's own names; **on the live master that is 11 pairings
 * over 6 of the 7 `for_fabric` processes, and every process the seed does not
 * name would become unpickable in every stage the moment the migration
 * applied** — with the only way to restore it being a Process-master screen
 * that is being built in the same change. On a database carrying 0294's
 * 438-row legacy import the same arithmetic is far worse: 55 `for_fabric`
 * processes, ~10 named by §3, and BLEACHING, MERCERISING, BRUSHING, PEACHING,
 * RAISING, RELAX DRIER and the rest — all real finishing steps, all in daily
 * use — gone from every route at once. A rule whose first act is to make most
 * of the master unreachable is not enforcement; it is an outage.
 *
 * Reading it as "everywhere" costs nothing that matters, because **enforcement
 * comes from CLASSIFYING, not from withholding by default.** §1's headline bug
 * is `Stage = Dyed, Process = Knitting`, and KNITTING *is* classified — Greige
 * only — so it is refused under Dyed from the day 0563 applies. Every process
 * the operator classifies afterwards tightens the rule by exactly that much,
 * and nothing they have not yet reached breaks in the meantime. It is also the
 * reading the rest of this module already takes: `is_print` and `is_dyeing`
 * both default `false` (= no special treatment), and every opt in
 * `processesForFabric` defaults to NOT narrowing, so that an unfilled call site
 * sees every process it always has.
 *
 * The honest cost is stated rather than hidden: until a fabric process is
 * classified, this rule says nothing about it. That is a rule that grows, not
 * a rule that leaks — and the Process master's own grid is where it grows.
 *
 * ## A RESTRICTION THAT OFFERS NOTHING IS UNSATISFIABLE, SO IT STANDS DOWN
 *
 * `isFirstOfStage` narrows the first step of a stage to that stage's mandatory
 * BASE process. If no base survives, the restriction stands down and the
 * stage's ordinary allowed list is offered instead. This is the same lesson
 * AGENTS.md records under "Mandatory fields" — refusing the key that FILLS a
 * field does not make the rule stricter, it makes it unsatisfiable, and the
 * only way on is the mouse. Here the operator could not even reach the mouse:
 * an empty ▾ has nothing in it to click.
 *
 * IT IS NOT A HYPOTHETICAL. It is the day-one state of this database, twice
 * over:
 *
 * - **The stage has no base at all.** The live master holds no WASHING and no
 *   `for_fabric` PRINTING, so 0563 seeds the Washed and Printed stages with
 *   secondary steps and no base. Without the stand-down, choosing Stage = WASH
 *   would offer the operator an empty list and the route could not be entered.
 * - **Every base is withheld by another gate.** DYEING is the only base of the
 *   Dyed stage and it carries 0557's `is_dyeing`, so on a Yarn-Dyed fabric it
 *   is already withheld — correctly, since that fabric's dyeing loss is carried
 *   on the yarn side. The Dyed stage is still the right ledger for yarn-dyed
 *   cloth (§1 counts yarn dyeing as Dyed stock), so the operator must be able
 *   to enter it; §3's other candidate base, YARN DYEING, is `for_yarn` and is
 *   never offered on a fabric route at all.
 *
 * Which is why the stand-down is computed from the list ALREADY GATED by
 * `for_fabric` / print / yarn-dyed, not from the raw master: the question is
 * "is there a base the operator can actually pick", and only the gated list can
 * answer it.
 *
 * ## THE SAME SENTENCE ONE LEVEL UP — THE FLOOR, AND HOW IT IS REACHED
 *
 * The stand-down answers "this stage has no pickable BASE". The floor answers
 * "this stage has no pickable PROCESS AT ALL", and it is the same principle
 * with the same phrasing: **when the rule knows nothing about a stage, it says
 * nothing about it.** `narrowToStage` falls back to the full gated list rather
 * than returning `[]`, and `stageMismatchBlocked` goes silent for that stage
 * in step, or the twin would report every row the widened list just offered.
 * Two guards, one principle, deliberately worded alike.
 *
 * **DO NOT DELETE THIS AS UNREACHABLE DEFENSIVE CODE.** It reads that way
 * today only because ONE unclassified process happens to exist, and the
 * reproduction is two ordinary, correct operator actions:
 *
 *   1. **Classify `FABRIC PURCHASE` to Greige.** It is the live master's only
 *      unclassified `for_fabric` process, and it is what silently lands in
 *      every stage and keeps every list non-empty. Classifying it is not a
 *      mistake — it IS a greige entry (§2's Default Rule 2), so the Process
 *      master's own grid invites exactly this. Zero unclassified processes
 *      remain.
 *   2. **Create a new `fabric_stage` lookup.** The Stage cell is a
 *      `LookupDialogPicker` with inline create, and this is not hypothetical
 *      either — it is how `WASH` and `PRINT` came to be in this database at
 *      all, added by hand under their own uppercase codes rather than by any
 *      migration.
 *
 * No process is classified against the new stage, nothing is unclassified, and
 * without the floor the Process ▾ comes back EMPTY under a cell the screen
 * marks `required`: `useRequiredHold` stamps `data-required-empty`, Tab and the
 * arrows refuse, and there is no value in the list to fill it with. Escape and
 * Ctrl+Del still work (AGENTS.md keeps Ctrl+Del live for exactly this dead
 * end), so it is not an absolute cage — it is a mandatory field with no
 * satisfying value, which is the same defect one door along.
 *
 * Covered by §12 of `scripts/check-fabric-stage-routes.mts`, whose fixture
 * reaches that state by the short route (a stage nothing is classified against,
 * on a master with nothing unclassified) rather than by modelling inline
 * create. Verified by being made to FAIL first.
 *
 * ## THE TWIN AND THE NARROWING MUST NEVER DISAGREE
 *
 * `baseProcessMissing` has to reach the same verdict as the narrowing or it
 * warns about a row the rule itself permitted — and the yarn-dyed case above is
 * exactly where a naive twin does that. So it takes the same two gates, and
 * `gatedForStage` below is the single predicate both paths run through.
 *
 * It mirrors the flag test in `processesForFabric` rather than importing it:
 * that function lives in `./processes.ts`, which imports THIS file, so sharing
 * the predicate the other way would be a runtime import cycle. The mirror is
 * held in place by a vector instead of by a comment —
 * `scripts/check-fabric-stage-routes.mts` §6 walks every (stage × gate × row)
 * combination and asserts the twin is silent on every process the narrowing
 * offered. Drift fails that check rather than shipping.
 */

import type { FabricProcessOption, FabricProcessRow } from "./processes";

/** One (stage, process) pairing from `process_fabric_stages` (0563). */
export type FabricStageRole = { stage_id: string; is_base: boolean };

/** The two gates `processesForFabric` applies before this file sees a list.
 *  Defaults match that function's exactly — `printDeclared` true and
 *  `fabricIsYarnDyed` false both mean "withhold nothing", so an unfilled call
 *  site keeps the behaviour it has always had. */
export type FabricStageGates = { printDeclared?: boolean; fabricIsYarnDyed?: boolean };

/**
 * MIRROR OF THE FLAG TEST IN `processesForFabric` — see the header's last
 * section for why it is a mirror and what holds it in place. Change one, change
 * the other; `check-fabric-stage-routes.mts` §6 fails if they disagree.
 */
function gatedForStage(
  options: readonly FabricProcessOption[],
  gates: FabricStageGates = {},
): FabricProcessOption[] {
  const printDeclared = gates.printDeclared ?? true;
  const fabricIsYarnDyed = gates.fabricIsYarnDyed ?? false;
  return options.filter(
    (p) => p.for_fabric && (printDeclared || !p.is_print) && (!fabricIsYarnDyed || !p.is_dyeing),
  );
}

/**
 * May this process run in this stage?
 *
 * An UNCLASSIFIED process (no `stage_roles` at all) answers yes for every
 * stage — the call the header sets out at length. A classified one answers yes
 * only for the stages it names, which is what refuses Knitting under Dyed.
 */
export function stageAllowsProcess(p: FabricProcessOption, stageId: string): boolean {
  if (!p.stage_roles.length) return true;
  return p.stage_roles.some((r) => r.stage_id === stageId);
}

/**
 * The mandatory base process(es) for a stage — what `isFirstOfStage` offers.
 *
 * PLURAL BECAUSE §3 IS PLURAL: "Dyeing (or Yarn Dyeing)" opens the Dyed stage,
 * so nothing here assumes one answer, and `process_fabric_stages` has no
 * constraint making `is_base` unique per stage.
 *
 * RETURNS `[]` HONESTLY. An empty answer is the SIGNAL that this stage has no
 * base the operator could pick — either none is classified (the live Washed and
 * Printed stages today) or every one is withheld by another gate (Dyeing on a
 * yarn-dyed fabric). It is not smoothed over into "then everything is a base";
 * the stand-down that handles it lives in `narrowToStage`, where the fallback
 * list is in scope, so that this function stays a question about the data and
 * not about what the picker should do next.
 */
export function baseProcessesForStage(
  options: readonly FabricProcessOption[],
  stageId: string | null,
): FabricProcessOption[] {
  if (!stageId) return [];
  return options.filter((p) => p.stage_roles.some((r) => r.stage_id === stageId && r.is_base));
}

/**
 * The stage half of the Fabric Process narrowing — what `processesForFabric`
 * delegates to once its own flag gates have run.
 *
 * TAKES THE ALREADY-GATED LIST, and the order matters: the stand-down asks "is
 * there a base the operator can actually pick", which the raw master cannot
 * answer. It also does NOT re-admit `currentValue` — that stays with
 * `processesForFabric`, after every narrowing, so a held value is re-admitted
 * once rather than by each rule in turn.
 *
 * NO STAGE = NO NARROWING. `stageId` null or undefined returns the list
 * untouched, which is what keeps every existing call site behaving exactly as
 * it did before 0563 — the same default reasoning `fabricIsYarnDyed` records.
 */
export function narrowToStage(
  options: readonly FabricProcessOption[],
  opts: { stageId?: string | null; isFirstOfStage?: boolean } = {},
): FabricProcessOption[] {
  const stageId = opts.stageId ?? null;
  if (!stageId) return [...options];
  const allowed = options.filter((p) => stageAllowsProcess(p, stageId));
  // THE FLOOR — the same sentence as the stand-down below, one level up: when
  // the rule knows nothing about a stage it says nothing about it. A stage no
  // process is classified against narrows to NOTHING, and an empty ▾ under a
  // mandatory cell is a field with no satisfying value. See the header.
  if (!allowed.length) return [...options];
  if (!opts.isFirstOfStage) return allowed;
  const bases = baseProcessesForStage(allowed, stageId);
  // THE STAND-DOWN. See the header: a first-step restriction with nothing in it
  // is unsatisfiable, and an empty ▾ cannot even be worked around with the
  // mouse. Falling back to the stage's own allowed list keeps the ledger rule
  // (Knitting is still refused under Dyed) while leaving the route enterable.
  return bases.length ? bases : allowed;
}

/**
 * INLINE TWIN of the `stageId` narrowing, same idiom as `printBlocked` /
 * `dyeingBlocked`: this row already holds a process its stage does not allow —
 * saved before the mapping existed, or classified differently since.
 *
 * SILENT ON AN UNCLASSIFIED PROCESS, because the narrowing offers it. Silent
 * too on a row that names no stage or no process: there is nothing to judge
 * yet, and the blank itself is the `required` rule's business, not this one's.
 *
 * AND SILENT WHEREVER THE FLOOR IS IN EFFECT. When no process at all is
 * classified against a stage, `narrowToStage` offers the whole gated list — so
 * every row in that stage holds something the narrowing just offered, and a
 * twin that reported them would contradict the rule it exists to explain. The
 * floor is tested here on the same GATED list `narrowToStage` sees, which is
 * why this takes `gates` at all.
 */
export function stageMismatchBlocked(
  row: Pick<FabricProcessRow, "process_id" | "stage_id">,
  options: readonly FabricProcessOption[],
  gates: FabricStageGates = {},
): boolean {
  if (!row.stage_id || !row.process_id) return false;
  const held = options.find((p) => p.id === row.process_id);
  // AN UNRESOLVABLE ID IS NOT THIS RULE'S BUSINESS. A process deleted from the
  // master is a different defect with a different message; claiming "wrong
  // stage" about it would send the operator to fix the stage instead.
  if (!held) return false;
  if (stageAllowsProcess(held, row.stage_id)) return false;
  const stageId = row.stage_id;
  return gatedForStage(options, gates).some((p) => stageAllowsProcess(p, stageId));
}

/**
 * INLINE TWIN of `isFirstOfStage`: this row opens a stage and does not hold
 * that stage's base process. `rows` are the fabric's steps IN ORDER, already
 * filtered to one group (combo + component_id).
 *
 * "OPENS A STAGE" IS THE FIRST ROW CARRYING THAT `stage_id`, filled or not. A
 * later row of the same stage is a secondary step and is judged by
 * `stageMismatchBlocked` alone — so an operator who has typed the stage into
 * two rows and the process into the second gets the warning on the row that
 * actually opens the stage, once, rather than on both.
 *
 * `gates` MUST MATCH WHAT THE SCREEN PASSED `processesForFabric`, or this twin
 * warns about a row the narrowing permitted — see the header's last section.
 * It is optional only so that a call site with no gates behaves as an unfilled
 * call site does everywhere else in this module.
 */
export function baseProcessMissing(
  rows: readonly FabricProcessRow[],
  index: number,
  options: readonly FabricProcessOption[],
  gates: FabricStageGates = {},
): boolean {
  const row = rows[index];
  if (!row?.stage_id || !row.process_id) return false;
  // Not the row that opens this stage — nothing here demands a base.
  if (rows.slice(0, index).some((r) => r.stage_id === row.stage_id)) return false;
  const bases = baseProcessesForStage(gatedForStage(options, gates), row.stage_id);
  // THE SAME STAND-DOWN `narrowToStage` MAKES. With no pickable base the
  // narrowing offered the whole stage, so there is nothing to have got wrong.
  if (!bases.length) return false;
  return !bases.some((b) => b.id === row.process_id);
}
