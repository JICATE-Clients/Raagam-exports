/**
 * YARN PROCESS ▸ STAGE → PROCESS (client spec 2026-09-21, "Yarn & YD Stage
 * Logic Rules for Process Listing"). Plan: doc/order/yarn-stage-logic-plan.md.
 *
 * The Yarn Process tab's Process ▾ narrowed by `for_yarn` alone; the fabric
 * route has had "the Stage decides the Process" since 0563. This is the yarn
 * side of the same rule, with the same shape and the same fail-open stance —
 * `narrowToStage`'s own words: "when the rule knows nothing about a stage it
 * says nothing about it".
 *
 * ## ONE CLASSIFICATION, MATCHED BY CODE
 *
 * A process is classified ONCE, on Master Data ▸ Processes ▸ Stages, against
 * the `fabric_stage` lookup (GREIGE · DYED · WASH · PRINT). The yarn tab's own
 * Stage list is the `yarn_stage` lookup (GREIGE · DYED) — different rows, made
 * a kind of its own by 0504 on purpose. So the loader maps each classification
 * onto the yarn stage with the SAME CODE (`grey`, `dyed`) — the way `stageRank`
 * already reads a stage — and hands the tab `stage_roles` in yarn-stage ids.
 * A fabric-only stage (WASH, PRINT) has no yarn twin and is simply not
 * reachable from a yarn row.
 *
 * ## THE THREE ANSWERS, IN ORDER
 *
 *  1. No stage on the row, or no yarn process classified against it → the
 *     whole `for_yarn` list (the floor: an empty ▾ under a mandatory cell is
 *     a field with no satisfying value).
 *  2. A stage → only the processes classified for it, plus every UNCLASSIFIED
 *     process (the spec's §6.4 "universal" fallback — a master the seed did
 *     not name must not go unpickable everywhere).
 *  3. The FIRST step of a stage → that stage's base process(es) only, falling
 *     back to 2 when none is pickable.
 *
 * The held value always survives (the "Disabled rows" rule).
 */

/** One (stage, base) classification, in YARN-STAGE ids. */
export type YarnStageRole = { stage_id: string; is_base: boolean };

export type YarnStageLike = { id: string; code: string | null; name: string };

/**
 * Fabric-stage id → yarn-stage id, by code (then by name — an operator may
 * rename a code-less stage). Used by the loader; exported so the vectors can
 * pin it. A fabric stage with no yarn twin maps to nothing.
 */
export function yarnStageTwins(
  fabricStages: readonly YarnStageLike[],
  yarnStages: readonly YarnStageLike[],
): Map<string, string> {
  const norm = (s: YarnStageLike) => {
    const code = (s.code ?? "").trim().toLowerCase();
    const name = (s.name ?? "").trim().toLowerCase();
    // grey and greige are one stage — 0563's own reading.
    const canon = (v: string) => (v === "greige" ? "grey" : v);
    return { code: canon(code), name: canon(name) };
  };
  const out = new Map<string, string>();
  for (const f of fabricStages) {
    const fk = norm(f);
    const twin = yarnStages.find((y) => {
      const yk = norm(y);
      return (fk.code && fk.code === yk.code) || (fk.name && fk.name === yk.name);
    });
    if (twin) out.set(f.id, twin.id);
  }
  return out;
}

type Opt = { id: string; stage_roles: readonly YarnStageRole[] };

/** An UNCLASSIFIED process (no roles) is allowed everywhere — §6.4. */
export function yarnStageAllows(p: Opt, stageId: string): boolean {
  if (!p.stage_roles.length) return true;
  return p.stage_roles.some((r) => r.stage_id === stageId);
}

export function yarnBasesForStage<P extends Opt>(options: readonly P[], stageId: string | null): P[] {
  if (!stageId) return [];
  return options.filter((p) => p.stage_roles.some((r) => r.stage_id === stageId && r.is_base));
}

/** Answers 1–3 of the header. */
export function narrowYarnToStage<P extends Opt>(
  options: readonly P[],
  opts: { stageId?: string | null; isFirstOfStage?: boolean } = {},
): P[] {
  const stageId = opts.stageId ?? null;
  if (!stageId) return [...options];
  const allowed = options.filter((p) => yarnStageAllows(p, stageId));
  if (!allowed.length) return [...options];
  if (!opts.isFirstOfStage) return allowed;
  const bases = yarnBasesForStage(allowed, stageId);
  return bases.length ? bases : allowed;
}

/** Does this row OPEN its stage — no earlier row in the same yarn's route names
 *  the same stage? */
export function opensYarnStage(rows: readonly { stage_id: string | null }[], index: number): boolean {
  const row = rows[index];
  if (!row?.stage_id) return false;
  return !rows.slice(0, index).some((r) => r.stage_id === row.stage_id);
}

/**
 * INLINE TWIN of the narrowing — a row already holding a process its stage does
 * not allow (saved before the classification, or reclassified since). Named,
 * never dropped.
 */
export function yarnStageMismatch(
  row: { stage_id: string | null; process_id: string | null },
  options: readonly Opt[],
): boolean {
  if (!row.stage_id || !row.process_id) return false;
  const held = options.find((p) => p.id === row.process_id);
  if (!held) return false;
  return !yarnStageAllows(held, row.stage_id);
}

/** The row opens its stage with something other than the stage's base, while a
 *  base exists to pick — the same stand-down as the narrowing. */
export function yarnBaseMissing(
  rows: readonly { stage_id: string | null; process_id: string | null }[],
  index: number,
  options: readonly Opt[],
): boolean {
  const row = rows[index];
  if (!row?.stage_id || !row.process_id) return false;
  if (!opensYarnStage(rows, index)) return false;
  const bases = yarnBasesForStage(options, row.stage_id);
  if (!bases.length) return false;
  return !bases.some((b) => b.id === row.process_id);
}

/**
 * THE SAVE RULE — both twins, one sentence per offending step, naming the
 * yarn. Read by the screen's Save gate and by the server (`writeYarns`) on the
 * same rows, so the two cannot disagree.
 */
export function yarnStageProblems(
  yarns: readonly { name: string; stages: readonly { stage_id: string | null; process_id: string | null }[] }[],
  options: readonly (Opt & { name: string })[],
  stages: readonly YarnStageLike[],
): string[] {
  const out: string[] = [];
  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name ?? "this stage";
  const procName = (id: string | null) => options.find((p) => p.id === id)?.name ?? "this process";
  for (const y of yarns) {
    y.stages.forEach((st, i) => {
      if (yarnStageMismatch(st, options)) {
        out.push(`${y.name}: ${stageName(st.stage_id)} does not run ${procName(st.process_id)} — change the Stage or pick another process.`);
      } else if (yarnBaseMissing(y.stages, i, options)) {
        const bases = yarnBasesForStage(options, st.stage_id).map((b) => b.name).join(" or ");
        out.push(`${y.name}: the first step under ${stageName(st.stage_id)} must be ${bases}, not ${procName(st.process_id)}.`);
      }
    });
  }
  return out;
}
