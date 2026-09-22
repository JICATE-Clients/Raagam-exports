/**
 * THE BASE-STAGE RULE, as vectors.
 *
 *   npm run check:process-base
 *
 * `baseStageProblem` (lib/masters/process-types.ts) is read in three places —
 * the Process master's Save gate, both server actions, and here — so the one
 * that matters is the SERVER's: a `lib/data-io` import reaches the action
 * directly and a gate that only disables a button is a gate an import walks
 * through.
 *
 * WRITTEN AFTER THE FACT IT DESCRIBES. COMPACTING [OPEN WIDTH] was saved as the
 * base of GREIGE, DYED, WASH and PRINT on 2026-09-18 — four stages, one
 * finishing process — and nothing objected. The first vector below is that
 * save.
 */
import { baseStageProblem } from "../lib/masters/process-types.ts";

const GREIGE = "st-greige";
const DYED = "st-dyed";
const WASH = "st-wash";
const PRINT = "st-print";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

const refused = (
  for_fabric: boolean,
  fabric_stages: { stage_id: string | null; is_base: boolean }[],
): boolean => baseStageProblem({ for_fabric, fabric_stages }) !== null;

/* THE 2026-09-18 SAVE ITSELF. */
check(
  "a process ticked Base in all four stages is refused",
  refused(true, [
    { stage_id: GREIGE, is_base: true },
    { stage_id: DYED, is_base: true },
    { stage_id: WASH, is_base: true },
    { stage_id: PRINT, is_base: true },
  ]),
  true,
);
check(
  "…and two is already too many",
  refused(true, [
    { stage_id: GREIGE, is_base: true },
    { stage_id: DYED, is_base: true },
  ]),
  true,
);

/* WHAT MUST STILL SAVE — each of these is a real row on the live master, and a
   rule that refused any of them would be worse than the gap it closes. */
check(
  "one base and secondary steps everywhere else is the ordinary shape",
  refused(true, [
    { stage_id: DYED, is_base: true },
    { stage_id: GREIGE, is_base: false },
    { stage_id: WASH, is_base: false },
    { stage_id: PRINT, is_base: false },
  ]),
  false,
);
/* COMPACTING AFTER THE FIX: mapped to all four stages, the base of none. */
check(
  "a process that is nobody's base may still run in every stage",
  refused(true, [
    { stage_id: GREIGE, is_base: false },
    { stage_id: DYED, is_base: false },
    { stage_id: WASH, is_base: false },
    { stage_id: PRINT, is_base: false },
  ]),
  false,
);
/* A STAGE MAY HAVE SEVERAL BASES — the rule is about the PROCESS, and GREIGE
   really is opened by both KNITTING and FABRIC PURCHASE (0570). Two processes
   each ticked once is two separate saves, each of which passes. */
check(
  "a second process opening the same stage is not this rule's business",
  refused(true, [{ stage_id: GREIGE, is_base: true }]),
  false,
);
check("no stage rows at all", refused(true, []), false);
check(
  "a blank row carries no verdict",
  refused(true, [
    { stage_id: null, is_base: true },
    { stage_id: DYED, is_base: true },
  ]),
  false,
);
/* NOT `for_fabric` — `normalizeFabricStages` drops the rows entirely, so there
   is nothing left to be wrong about and refusing would block a legitimate save
   of a garment process whose stale ticks are never stored. */
check(
  "a process that is not for_fabric has no stage route to be wrong about",
  refused(false, [
    { stage_id: GREIGE, is_base: true },
    { stage_id: DYED, is_base: true },
  ]),
  false,
);

/* THE MESSAGE NAMES THE COUNT, so the operator knows how many ticks to undo
   rather than hunting. A vector on the words, because a message is the whole
   of what this rule does on screen. */
check(
  "the refusal counts the stages",
  (baseStageProblem({
    for_fabric: true,
    fabric_stages: [
      { stage_id: GREIGE, is_base: true },
      { stage_id: DYED, is_base: true },
      { stage_id: WASH, is_base: true },
    ],
  }) ?? "").includes("ticked on 3"),
  true,
);

console.log(
  failed ? `\n${failed} FAILED` : "\nOK — a process is the entry step of at most one stage.",
);
process.exit(failed ? 1 : 0);
