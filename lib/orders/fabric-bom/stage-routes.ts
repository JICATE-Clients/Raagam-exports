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

/** The gates `processesForFabric` applies before this file sees a list.
 *  Defaults match that function's exactly — `printDeclared` true,
 *  `fabricIsYarnDyed` false and `purchaseAllowed` true all mean "withhold
 *  nothing", so an unfilled call site keeps the behaviour it has always had.
 *
 *  `purchaseAllowed` (client 2026-09-19, "Fabric Purchase must be Step 1") is
 *  POSITIONAL where the other two are facts about the fabric: it is false on
 *  any row with a step above it, and `clothPurchaseAllowedAt` is the one place
 *  that answers it. */
export type FabricStageGates = {
  printDeclared?: boolean;
  fabricIsYarnDyed?: boolean;
  purchaseAllowed?: boolean;
};

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
  const purchaseAllowed = gates.purchaseAllowed ?? true;
  return options.filter(
    (p) =>
      p.for_fabric &&
      (printDeclared || !p.is_print) &&
      (!fabricIsYarnDyed || !p.is_dyeing) &&
      (purchaseAllowed || !p.is_cloth_purchase),
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

/* ==========================================================================
 * THE SECOND HALF OF THE LEDGER RULE: A ROUTE ONLY EVER MOVES FORWARD (0570)
 *
 * Client spec 2026-09-18 §2, "Irreversible State Transitions": once a fabric
 * line has moved from GREY to DYED, WASH or PRINT it cannot revert to GREY.
 * doc/order/fabriprocess.md §3 says the same thing one stage narrower ("once
 * dyed, all downstream steps remain in the Dyed stage") and NEITHER was
 * implemented: every stage comparison in this file above is an EQUALITY test,
 * so nothing could tell forwards from backwards. A live route proves the cost —
 * `[DYED] DYEING → [GREIGE] HEAT SETTING → [DYED] DYEING`, with the heat-set
 * roll's weight booked to the Greige ledger after the cloth was dyed.
 *
 * ## THE ORDER IS DERIVED BY MEANING, AND IS NOT A COLUMN
 *
 * `fabric_stage` is a `config_lookups` kind with no ordinal column, and this
 * deliberately does not add one. The four stages are the client's fixed
 * vocabulary; a fifth an operator invents on the Stage cell's own inline create
 * (which is how WASH and PRINT got into this database) has no declared position
 * in the sequence, and a ranked column would force one to be guessed. UNRANKED
 * MEANS UNCONSTRAINED — the same fail-open call this module makes about an
 * unclassified process, for the same reason: the rule says nothing where it
 * knows nothing.
 *
 * Matching on meaning rather than on `code` is 0563's lesson: this database's
 * greige row is `code = 'grey'` renamed to GREIGE, and WASH / PRINT carry
 * operator-typed uppercase codes. Code or name, case-insensitive, prefix where
 * the spelling legitimately varies (WASH/WASHED, PRINT/PRINTED).
 *
 * ## DYED AND WASH SHARE RANK 1, AND THAT IS NOT A SHORTCUT
 *
 * They are siblings, not successors: a fabric reaches colour EITHER by
 * piece-dyeing (chains 1 · 2) OR by washing melange / yarn-dyed cloth (chains
 * 3 · 4 · 5) — §1's own wording, "fabric piece-dyeing is skipped". Equal rank
 * refuses both of them after PRINT and neither of them after the other, which
 * leaves the one real mixed case enterable: §6's 1% exception, where a dark
 * colourway takes a bio-wash after dyeing. Ranking WASH above DYED would have
 * refused that, and ranking it below would have refused a print over a wash.
 * ========================================================================== */

/** A `fabric_stage` lookup, structurally — so this file stays client-safe and
 *  borrows no type from the masters layer. */
export type FabricStageLike = { id: string; code: string | null; name: string };

/**
 * WHERE THIS STAGE SITS IN THE PHYSICAL SEQUENCE — 0 greige, 1 coloured
 * (dyed or washed), 2 printed — or `null` for a stage this rule does not
 * recognise, which is then exempt from it entirely.
 *
 * ORDER OF TESTS MATTERS: `print` is checked before the `wash` prefix so that a
 * hypothetical "PRINT WASH" reads as a print stage, and the greige pair is
 * checked first because it is the only one an operator has already renamed.
 */
export function stageRank(stage: FabricStageLike): number | null {
  const code = (stage.code ?? "").trim().toLowerCase();
  const name = (stage.name ?? "").trim().toLowerCase();
  const is = (...pre: string[]) =>
    pre.some((p) => code === p || code.startsWith(p) || name === p || name.startsWith(p));
  if (is("grey", "greige")) return 0;
  if (is("print")) return 2;
  if (is("dyed", "dye")) return 1;
  if (is("wash")) return 1;
  return null;
}

/**
 * THE COLOURED STAGES (rank 1 or 2) among a stage list — used for the YARN
 * side's `yarn_stage` list (GREY / DYED) as much as the fabric's, since
 * `stageRank` reads meaning (code or name), not the lookup kind. A yarn step
 * in one of these is a dyeing step — see "ONE DYEING LOSS" in
 * `yarnPurchase` (client 2026-09-19). An unranked stage is not coloured.
 */
export function colouredStageIds(stages: readonly FabricStageLike[]): Set<string> {
  return new Set(stages.filter((s) => (stageRank(s) ?? 0) >= 1).map((s) => s.id));
}

/**
 * The highest rank this route has already REACHED above `index` — the floor a
 * row may not sit below. `null` when nothing above it is ranked.
 *
 * `rows` are one branch's steps in order (combo + component_id already
 * filtered), which is the same slice `baseProcessMissing` takes.
 */
function rankReachedBefore(
  rows: readonly FabricProcessRow[],
  index: number,
  stages: readonly FabricStageLike[],
): number | null {
  let top: number | null = null;
  for (const r of rows.slice(0, index)) {
    const stage = stages.find((s) => s.id === r.stage_id);
    const rank = stage ? stageRank(stage) : null;
    if (rank == null) continue;
    if (top == null || rank > top) top = rank;
  }
  return top;
}

/**
 * The stages this row may still name — what the Stage ▾ offers.
 *
 * An UNRANKED stage is always offered (see the block comment above), and so is
 * the stage the row already HOLDS: dropping a held value shows a filled field
 * as empty and blanks the FK on the next save (AGENTS.md "Disabled rows", the
 * rule every narrowing in this module obeys). A held value that is now illegal
 * is named by `stageRegressionBlocked` instead — withheld from the list,
 * explained inline, never silently removed.
 */
export function stagesForRow<T extends FabricStageLike>(
  /* GENERIC OVER THE CALLER'S OWN ROW TYPE, so the narrowed list can be handed
     straight back to the control it came from: the Stage cell feeds
     `LookupDialogPicker`, whose `options` are `ConfigLookup[]`, and a function
     returning the structural minimum would force a cast at the one call site
     this rule has. The constraint is what keeps it a structural type here —
     this module still imports nothing from the masters layer. */
  stages: readonly T[],
  rows: readonly FabricProcessRow[],
  index: number,
): T[] {
  const floor = rankReachedBefore(rows, index, stages);
  if (floor == null) return [...stages];
  const held = rows[index]?.stage_id ?? null;
  const allowed = stages.filter((s) => {
    if (s.id === held) return true;
    const rank = stageRank(s);
    return rank == null || rank >= floor;
  });
  // THE FLOOR, in this rule's own terms — the same sentence `narrowToStage`
  // carries. If every stage were withheld the cell would be a mandatory field
  // with an empty ▾, so the whole list is offered instead.
  return allowed.length ? allowed : [...stages];
}

/**
 * INLINE TWIN of `stagesForRow`: this row names a stage EARLIER than one the
 * route has already reached — saved before this rule existed, or made wrong by
 * a row above it changing since.
 *
 * Silent on a blank stage (that is `required`'s business), on an unranked
 * stage, and wherever nothing above the row is ranked.
 */
export function stageRegressionBlocked(
  rows: readonly FabricProcessRow[],
  index: number,
  stages: readonly FabricStageLike[],
): boolean {
  const row = rows[index];
  if (!row?.stage_id) return false;
  const stage = stages.find((s) => s.id === row.stage_id);
  const rank = stage ? stageRank(stage) : null;
  if (rank == null) return false;
  const floor = rankReachedBefore(rows, index, stages);
  return floor != null && rank < floor;
}

/**
 * INLINE TWIN, and the third refusable fault: this row repeats the step that
 * ALREADY moved the cloth into this stage (client 2026-09-18, rule 2 — "Dyeing
 * appears twice in the same process chain"; the live route repeats Dyeing three
 * times and Knitting three times).
 *
 * ## THE RULE IS DELIBERATELY NARROW, AND THE WIDE ONE IS WRONG
 *
 * "No process twice in a route" is the obvious reading and it would refuse the
 * client's OWN chains 2 and 4: both compact in the Dyed/Washed stage and again
 * after printing, which is §1's "Post-print finishing (Dip-Wash, Compacting)
 * remains tagged as PRINT". `fabric-process-grid.tsx` records the same fact
 * where it explains why no `usedIds` is applied to the Process picker — "a
 * fabric legitimately runs DYEING twice, and compacting before *and* after
 * printing".
 *
 * So the test is the ENTRY step inside ITS OWN stage: a stage is entered once,
 * by the step that moves the cloth into it, and a second Dyeing under Dyed is
 * that transition claimed twice. Compacting repeats freely — it is nobody's
 * base — and a step repeated in a DIFFERENT stage is a different transition and
 * is untouched.
 *
 * SILENT ON AN UNCLASSIFIED PROCESS, like every other rule here: a process with
 * no `stage_roles` is nobody's base, so it cannot repeat one.
 */
export function baseProcessRepeated(
  rows: readonly FabricProcessRow[],
  index: number,
  options: readonly FabricProcessOption[],
): boolean {
  const row = rows[index];
  if (!row?.stage_id || !row.process_id) return false;
  const held = options.find((p) => p.id === row.process_id);
  if (!held) return false;
  const stageId = row.stage_id;
  const isBaseHere = held.stage_roles.some((r) => r.stage_id === stageId && r.is_base);
  if (!isBaseHere) return false;
  return rows
    .slice(0, index)
    .some((r) => r.stage_id === stageId && r.process_id === row.process_id);
}

/**
 * INLINE TWIN, and the fourth refusable fault (client 2026-09-19): a step that
 * BUYS the cloth (`is_cloth_purchase` — FABRIC PURCHASE, DYED FABRIC PURCHASE)
 * sits below another step in its branch.
 *
 * A bought roll is where a route STARTS. Anything above it claims the cloth was
 * knitted or dyed in-house before it was bought, which is the live route
 * `[GREIGE] KNITTING → [DYED] DYEING → [DYED] FABRIC PURCHASE` — the operator
 * reaching for a dyed purchase the Dyed stage could not offer, and the demand
 * engine then charging yarn AND the purchase. `sourceFromRoute` reads only a
 * branch's FIRST step, so a purchase anywhere else would also be silently
 * ignored by the arithmetic; refusing it keeps "what the route says" and "what
 * is bought" one fact.
 *
 * Counts only rows ABOVE that name a process: a blank row the operator has
 * just added is not a step yet.
 */
export function clothPurchaseNotFirst(
  rows: readonly FabricProcessRow[],
  index: number,
  options: readonly FabricProcessOption[],
): boolean {
  const row = rows[index];
  if (!row?.process_id) return false;
  if (!options.find((p) => p.id === row.process_id)?.is_cloth_purchase) return false;
  return !clothPurchaseAllowedAt(rows, index);
}

/**
 * MAY THIS ROW BUY THE CLOTH? — the narrowing half of `clothPurchaseNotFirst`
 * (client 2026-09-19: "Step 1: FABRIC_PURCHASE is enabled. Steps 2+: filtered
 * out of the process dropdown").
 *
 * "Step 1" is read the way the twin reads it — NO ROW ABOVE NAMES A PROCESS —
 * rather than `index === 0`, so a blank row the operator added first and never
 * filled does not push the purchase off the only row it could still go on.
 * One position test, stated once: the twin above is its negation, so the ▾
 * and the warning cannot disagree about which row is Step 1.
 */
export function clothPurchaseAllowedAt(
  rows: readonly Pick<FabricProcessRow, "process_id">[],
  index: number,
): boolean {
  return !rows.slice(0, index).some((r) => !!r.process_id);
}

/**
 * INLINE TWIN of the `fabricIsYarnDyed` gate (0557), and since 2026-09-19 a
 * Save rule too: this row holds a Dyeing process on a fabric that is Yarn-Dyed.
 *
 * The cloth is knitted from yarn that was dyed BEFORE knitting, so a fabric
 * dyeing step is physically wrong, and its loss would be charged twice (the
 * yarn side already carries it — `order_fabric_bom_yarn_stages`, 0493). The ▾
 * has withheld `is_dyeing` processes, sub-categories included, since 0557; what
 * was missing is that a row saved BEFORE the fabric's Type was set to Yarn Dyed
 * kept its Dyeing step and saved again unrefused.
 *
 * THE PROCESS, NOT THE STAGE. The client's sentence is "Fabric Dyeing steps
 * cannot be added", and the Dyed stage stays reachable: DYED FABRIC PURCHASE —
 * buying finished yarn-dyed rolls — is that stage's other base.
 *
 * Moved here from `./processes.ts` (which still re-exports it) because
 * `stageRouteProblems` below needs it, and that file imports this one.
 */
export function dyeingBlocked(
  row: Pick<FabricProcessRow, "process_id">,
  options: readonly FabricProcessOption[],
  fabricIsYarnDyed: boolean,
): boolean {
  if (!fabricIsYarnDyed || !row.process_id) return false;
  return !!options.find((p) => p.id === row.process_id)?.is_dyeing;
}

/**
 * THE PROCESSES OTHER ROWS OF THIS STAGE ALREADY HOLD — what the ▾ withholds
 * (client 2026-09-19, "once a process step is selected it must be removed from
 * selection lists in subsequent steps").
 *
 * ## ONCE PER STAGE, NOT ONCE PER ROUTE (user decision, 2026-09-19)
 *
 * The literal request was once per ROUTE, and that refuses the client's own
 * chains 2 and 4 (`./standard-routes.ts`): they compact under DYED/WASH and
 * again after printing, under PRINT. A saved live route already does exactly
 * that. So the set is scoped to rows of the SAME stage in the same branch —
 * STENTERING picked under DYED leaves every other DYED row's list, and is still
 * offered under WASH or PRINT. A row with no stage yet withholds nothing: until
 * the stage is named there is no stage to be a repeat within.
 *
 * Keyed by `process_id` only, so a process and its sub-categories go together:
 * DYEING [WITH BIOWASH] under DYED is DYEING under DYED.
 *
 * FED TO THE PICKER'S `usedIds`, NOT FILTERED OUT OF THE LIST. A taken process
 * stays visible, greyed "(already added)" — `DataPicker`'s standing reason: a
 * process that vanished reads as missing from the master.
 *
 * THE FLOOR, the same sentence `narrowToStage` carries. Pass `offered` (the ▾'s
 * own list) and, if every entry in it is taken on a BLANK row, the set comes
 * back EMPTY: a `required` cell where nothing can be picked is a mandatory
 * field with no satisfying value. Reachable — a blank first-of-stage row whose
 * only base a row BELOW already holds — and picking it then makes the lower row
 * the repeat, which `processRepeatedInStage` names.
 */
export function processesUsedInStage(
  rows: readonly FabricProcessRow[],
  index: number,
  offered?: readonly Pick<FabricProcessOption, "id">[],
): Set<string> {
  const stageId = rows[index]?.stage_id;
  const out = new Set<string>();
  if (!stageId) return out;
  rows.forEach((r, i) => {
    if (i !== index && r.stage_id === stageId && r.process_id) out.add(r.process_id);
  });
  /* Only a BLANK row can be caged: a filled one is not held by `required`, so
     greying its alternatives leaves it exactly as free as it was. */
  if (!rows[index]?.process_id && offered?.length && offered.every((p) => out.has(p.id))) {
    return new Set();
  }
  return out;
}

/**
 * INLINE TWIN of `processesUsedInStage`: a row ABOVE in the same stage already
 * holds this process. Reported on the LATER row only, so one repeat reads as
 * one problem.
 *
 * A SUPERSET of `baseProcessRepeated` — a stage's base repeated is one case of
 * this. That one keeps its own, sharper sentence and is tested first; this one
 * speaks for everything else (STENTERING twice under DYED, say).
 */
export function processRepeatedInStage(
  rows: readonly FabricProcessRow[],
  index: number,
): boolean {
  const row = rows[index];
  if (!row?.stage_id || !row.process_id) return false;
  return rows
    .slice(0, index)
    .some((r) => r.stage_id === row.stage_id && r.process_id === row.process_id);
}

/**
 * EVERY ROUTE FAULT IN A WHOLE DOCUMENT, as sentences — the half the screen's
 * Save gate and the server action share so that they cannot disagree about what
 * is refusable.
 *
 * ## WHY THIS EXISTS AT ALL, GIVEN THE NARROWING ABOVE
 *
 * Because withholding an option is not a guard. Until 0570 the stage rules were
 * enforced ONLY by the picker: `normalizeProcesses` wrote `stage_id` straight
 * through unvalidated, `order_fabric_bom_processes.stage_id` is a plain
 * nullable FK with no CHECK, and the Fabric Process section declared no Save
 * problem at all — so a stale page, a replayed request or a future writer saved
 * any pair at all. AGENTS.md's standing split: "the screen check is a courtesy;
 * this one is the guard." The client asked for the strict reading on
 * 2026-09-18 (block the save, both faults).
 *
 * ## IT REPORTS EXACTLY WHAT THE TWINS REPORT
 *
 * One list, one predicate per fault (regression, purchase not first, dyeing on
 * a yarn-dyed fabric, stage/process pair, base repeated, process repeated in a
 * stage, base missing — tested in that order, one fault per row), and each is
 * the same function the grid already
 * renders inline — a fault the operator can see and a fault that blocks Save
 * must never be two different tests. Rows are grouped into branches the way the
 * grid groups them (`item_id` + combo + component_id) and judged in order.
 *
 * `fabricName` is passed in rather than looked up: this module knows nothing
 * about `items`, and the server has the names to hand anyway.
 */
export function stageRouteProblems(
  rows: readonly FabricProcessRow[],
  options: readonly FabricProcessOption[],
  stages: readonly FabricStageLike[],
  opts: {
    /* THE BRANCH IS PASSED TOO (2026-09-19), because the print gate is now a
       fact about a (fabric, colourway, component) leaf rather than the whole
       order — see `printedGroup` in `./print-route.ts`. The two extra
       arguments are optional, so a caller written against `(itemId)` alone
       (IWO Fabric BOM) type-checks and keeps its fabric-wide gate. */
    gatesFor?: (itemId: string, combo?: string | null, componentId?: string | null) => FabricStageGates;
    fabricName?: (itemId: string) => string;
  } = {},
): { item_id: string; row_key: string; message: string }[] {
  const nameOf = (id: string | null) =>
    (id && stages.find((s) => s.id === id)?.name) || "this stage";
  const branches = new Map<string, FabricProcessRow[]>();
  for (const r of rows) {
    /* ONE BRANCH = one (fabric, colourway, component) leaf, keyed the way the
       grid groups its rows. `JSON.stringify` rather than a joined string with a
       separator: a NUL separator is the safe choice and cannot be written here
       as a literal byte without turning this file binary to every text tool
       (see `routeKeyOf` in `./processes.ts`, fixed 2026-09-18). An array
       encoding needs no separator at all. */
    const key = JSON.stringify([r.item_id, r.combo ?? "", r.component_id ?? ""]);
    const at = branches.get(key);
    if (at) at.push(r);
    else branches.set(key, [r]);
  }
  const out: { item_id: string; row_key: string; message: string }[] = [];
  for (const branch of branches.values()) {
    for (let i = 0; i < branch.length; i++) {
      const row = branch[i];
      /* THE POSITIONAL GATE IS ADDED HERE, per row, rather than by the caller:
         only this loop knows where a row sits in its branch, and the ▾ was
         handed the same answer (`clothPurchaseAllowedAt`). Without it the base
         twin below asks a Dyed stage opened on row 3 for "DYEING or DYED FABRIC
         PURCHASE" — naming a step the row may not hold. */
      const gates: FabricStageGates = {
        ...(opts.gatesFor?.(row.item_id, row.combo ?? null, row.component_id ?? null) ?? {}),
        purchaseAllowed: clothPurchaseAllowedAt(branch, i),
      };
      const where = opts.fabricName ? `${opts.fabricName(row.item_id)}: ` : "";
      const process = options.find((p) => p.id === row.process_id)?.name ?? "that process";
      if (stageRegressionBlocked(branch, i, stages)) {
        const floor = rankReachedBefore(branch, i, stages);
        out.push({
          item_id: row.item_id,
          row_key: row.key,
          message:
            `${where}this route reaches ${floor === 2 ? "Print" : "a coloured"} stage and then goes back to ` +
            `${nameOf(row.stage_id)}. A fabric cannot return to an earlier stage — its weight would be ` +
            `booked to a stock ledger the cloth has already left.`,
        });
        // ONE FAULT PER ROW. A row whose stage regresses will usually also fail
        // the pair test (Knitting under Dyed, say), and two sentences about one
        // cell read as two problems to fix.
        continue;
      }
      if (clothPurchaseNotFirst(branch, i, options)) {
        out.push({
          item_id: row.item_id,
          row_key: row.key,
          /* The client's own sentence (2026-09-19), with the process named —
             DYED FABRIC PURCHASE is refused by the same rule. */
          message:
            `${where}${process} must be the initial procurement step (Step 1). It cannot be placed ` +
            `after Knitting or Greige stage processes.`,
        });
        continue;
      }
      if (dyeingBlocked(row, options, gates.fabricIsYarnDyed ?? false)) {
        out.push({
          item_id: row.item_id,
          row_key: row.key,
          message:
            `${where}This fabric is Yarn-Dyed. Fabric Dyeing steps cannot be added to a yarn-dyed ` +
            `fabric route.`,
        });
        continue;
      }
      if (stageMismatchBlocked(row, options, gates)) {
        out.push({
          item_id: row.item_id,
          row_key: row.key,
          message:
            `${where}${nameOf(row.stage_id)} does not run ${process} — the roll's weight would be booked ` +
            `to the ${nameOf(row.stage_id)} stock ledger in the wrong state.`,
        });
        continue;
      }
      if (baseProcessRepeated(branch, i, options)) {
        out.push({
          item_id: row.item_id,
          row_key: row.key,
          message:
            `${where}${process} already moved this fabric into ${nameOf(row.stage_id)} — a stage ` +
            `is entered once, so the second one books the same transition twice.`,
        });
        continue;
      }
      if (processRepeatedInStage(branch, i)) {
        out.push({
          item_id: row.item_id,
          row_key: row.key,
          message:
            `${where}${process} is already in the ${nameOf(row.stage_id)} stage. A stage runs each ` +
            `process once.`,
        });
        continue;
      }
      if (baseProcessMissing(branch, i, options, gates)) {
        const bases = baseProcessesForStage(gatedForStage(options, gates), row.stage_id)
          .map((b) => b.name)
          .join(" or ");
        out.push({
          item_id: row.item_id,
          row_key: row.key,
          message:
            `${where}a ${nameOf(row.stage_id)} route opens with ${bases} — that is the step that moves ` +
            `the cloth into ${nameOf(row.stage_id)} stock.`,
        });
      }
    }
  }
  return out;
}
