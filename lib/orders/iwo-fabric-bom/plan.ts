/**
 * IWO Fabric BOM ▸ Fabric Consumption ▸ PLAN BY — a fabric's breakup by colour
 * and/or finish dia (client 2026-09-21, screenshots 2990 · 2992; design in
 * `doc/order/iwo-fabric-consumption-plan.md` and the plan artifact, rev 5).
 *
 * ## ONE ROW PER FABRIC ON SCREEN, ONE STORED LINE PER (FABRIC, COLOUR, DIA)
 *
 * The stored grain is 0592's and does not move: `iwo_fabric_bom_lines` holds
 * one row per (fabric, colour, dia) with its own `req_kgs` and `print_name`,
 * unique on the triple. The SCREEN used to hold that same grain, so a fabric
 * in two colours was two rows and Fabric Allocation showed the fabric twice —
 * the bug reported for dias on 2026-09-21 and fixed with `[Dias]`, back again
 * for colours. Now the screen holds one row per fabric and this file is the
 * boundary between the two shapes:
 *
 *   - `expandPlan` — the screen's row → the stored-line facts every existing
 *     reader (the rules in `lines.ts`, the yarn engine's `iwoFabricGross`, the
 *     payload) was already written against. Nothing downstream changed.
 *   - `foldLines` — stored lines → the screen's row, on load.
 *
 * ## THE MATERIAL BOM'S ATTRIBUTE, WITH A FABRIC'S AXES (0614)
 *
 * IWO Material BOM ▸ Items answers "one line, several sub-quantities" with an
 * Attribute on the row (Item · Colour · Size · Colour + Size), the quantity
 * cell as the door to a [Breakup] sheet, and ONE reader (`plannedQtyOf`) for
 * the line's figure. This is that shape: `plan_by` is Fabric · Colour · Dia ·
 * Colour + Dia, the Req Wt cell is the door, `reqKgsOf` is the reader.
 *
 * What a fabric adds is that its Stage already decides its fields: a coloured
 * stage owes a Colour and a Finish Dia on EVERY stored line, GREIGE owes no
 * colour at all. So `planByFor` is what a stage offers, and `replanForStage`
 * is what happens to a plan when the Stage changes — weights are never thrown
 * away (summed per dia on the way to GREIGE, since greige is one lot).
 *
 * ## THE ATTRIBUTE IS NOT STORED — IT IS INFERRED
 *
 * The Material BOM stores `attribute` on its line because a line is one row
 * there. Here a fabric is MANY rows, and there is no parent row to carry it,
 * so `foldLines` infers it from the lines: colours > 1 and dias > 1 → Colour
 * + Dia, colours > 1 → Colour, dias > 1 → Dia, else Fabric. One line is
 * "Fabric" whichever way it was typed, which is true — it IS one line.
 *
 * Client-safe, pure: the screen previews with these and `check:iwo-fabric-bom`
 * §18 proves them (fold ∘ expand = identity, the greige re-plan, the empty
 * split, the inference).
 */

import { comboKey } from "@/lib/orders/fabric-bom/yarn-process";

export const PLAN_BY = ["fabric", "colour", "dia", "colour_dia"] as const;
export type PlanBy = (typeof PLAN_BY)[number];

export const PLAN_BY_LABELS: Record<PlanBy, string> = {
  fabric: "Fabric",
  colour: "Colour",
  dia: "Dia",
  colour_dia: "Colour + Dia",
};

/** Does this attribute split the colour / the dia axis into the sheet? */
export const planHasColour = (p: PlanBy): boolean => p === "colour" || p === "colour_dia";
export const planHasDia = (p: PlanBy): boolean => p === "dia" || p === "colour_dia";

/**
 * WHAT A STAGE OFFERS. GREIGE has no colour (Phase 2's rule: "greige is one
 * lot, dyed later"), so it cannot be planned by colour; a coloured stage may
 * be planned any of the four ways. `rank` is `stageRank` — 0 greige, ≥ 1
 * coloured, null while no Stage is chosen (offer everything: the Stage rule
 * will speak when it is set).
 */
export function planByFor(rank: number | null): readonly PlanBy[] {
  return rank === 0 ? (["fabric", "dia"] as const) : PLAN_BY;
}

/** One breakup row as the sheet edits it — every value the TEXT typed. */
export type PlanRow = { key: string; color_name: string; print_name: string; dia: string; req_kgs: string };

export const blankPlanRow = (key: string): PlanRow => ({ key, color_name: "", print_name: "", dia: "", req_kgs: "" });

/** Is this row worth storing? The sheet seeds a blank row, and an untouched
 *  seed is dropped when the plan has other rows to stand on. */
export const isBlankPlanRow = (r: PlanRow): boolean =>
  !r.color_name.trim() && !r.print_name.trim() && !r.dia.trim() && !r.req_kgs.trim();

/** The rows a plan keeps: every row while there is one, else the ones that say
 *  something — so a plan with real rows never stores a blank one beside them,
 *  and a plan with only a blank row still expands to ONE line the rules can
 *  refuse by name ("enter the Req Wt") rather than to nothing. */
export const keptPlanRows = (rows: readonly PlanRow[]): PlanRow[] =>
  rows.length <= 1 ? [...rows] : rows.filter((r) => !isBlankPlanRow(r));

/**
 * The fabric row as this file reads it — the row-level cells (which apply to
 * every stored line for an axis that is NOT split) and the breakup rows (which
 * carry the split axes). Text throughout, like the screen.
 */
export type PlanLine = {
  plan_by: PlanBy;
  color_name: string;
  print_name: string;
  finish_dia: string;
  req_kgs: string;
  rows: PlanRow[];
};

/** One stored line's plan fields, as `lines.ts` reads them. */
export type PlanFacts = {
  color_name: string | null;
  print_name: string | null;
  finish_dia: string | null;
  req_kgs: number | null;
};

const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const text = (v: string): string | null => v.trim() || null;

/**
 * THE LINE'S REQ WT — ITS OWN FIGURE, OR THE SUM OF ITS BREAKUP. The Material
 * BOM's `plannedQtyOf`: one reader for the rules, the Save gate, the payload,
 * the engine input and the totals, so a fabric broken up by colour can never
 * be grossed on a stale figure typed before it was. NULL while no row carries
 * a weight, so "enter the Req Wt" still fires rather than 0 reading as an
 * answer. NaN (a non-number typed) passes through, refused by name downstream.
 */
export function reqKgsOf(l: Pick<PlanLine, "plan_by" | "req_kgs" | "rows">): number | null {
  if (l.plan_by === "fabric") return num(l.req_kgs);
  const ns = keptPlanRows(l.rows)
    .map((r) => num(r.req_kgs))
    .filter((n): n is number => n != null);
  if (ns.length === 0) return null;
  const sum = ns.reduce((a, b) => a + b, 0);
  return Number.isFinite(sum) ? Number(sum.toFixed(4)) : sum;
}

/**
 * THE SCREEN'S ROW → ONE STORED LINE PER BREAKUP ROW. An axis that is split
 * comes off the breakup row; one that is not comes off the fabric row. Print
 * rides with the colour: on a Print stage it is per breakup row only where the
 * colour axis is split, otherwise the fabric row's one Print applies to every
 * line (the legacy screen puts Print on the colour, and the 09-20 ticket's
 * "planned per print, colour and dia" is that reading).
 */
export function expandPlan(l: PlanLine): PlanFacts[] {
  if (l.plan_by === "fabric") {
    return [{ color_name: text(l.color_name), print_name: text(l.print_name), finish_dia: text(l.finish_dia), req_kgs: num(l.req_kgs) }];
  }
  const colour = planHasColour(l.plan_by);
  const dia = planHasDia(l.plan_by);
  /* A HIDDEN AXIS MERGES, A VISIBLE ONE REFUSES (client screenshot 2993). A
     row keeps every axis it was typed with even while the attribute hides one
     (`replan` never clears), so under Colour a plan typed as WHITE 74" 400 +
     WHITE 76" 100 is two rows that differ only on the hidden dia — one stored
     line, WHITE 74" 500, is the only honest reading, and switching back to
     Colour + Dia restores the two. Rows identical on EVERY axis are a true
     duplicate the operator typed, left separate so the unique-triple rule in
     `lines.ts` refuses them by name. */
  const groups = new Map<string, { visible: PlanFacts; hidden: Set<string>; rows: PlanRow[] }>();
  for (const r of keptPlanRows(l.rows)) {
    const visible: PlanFacts = {
      color_name: text(colour ? r.color_name : l.color_name),
      print_name: text(colour ? r.print_name : l.print_name),
      finish_dia: text(dia ? r.dia : l.finish_dia),
      req_kgs: num(r.req_kgs),
    };
    const key = [comboKey(visible.color_name), comboKey(visible.print_name), comboKey(visible.finish_dia)].join(" ");
    const hidden = [colour ? "" : comboKey(r.color_name) + "|" + comboKey(r.print_name), dia ? "" : comboKey(r.dia)].join(" ");
    const g = groups.get(key);
    if (g) {
      g.hidden.add(hidden);
      g.rows.push(r);
    } else groups.set(key, { visible, hidden: new Set([hidden]), rows: [r] });
  }
  const out: PlanFacts[] = [];
  for (const g of groups.values()) {
    if (g.rows.length > 1 && g.hidden.size > 1) {
      const ns = g.rows.map((r) => num(r.req_kgs)).filter((n): n is number => n != null);
      const sum = ns.length ? Number(ns.reduce((a, b) => a + b, 0).toFixed(4)) : null;
      out.push({ ...g.visible, req_kgs: sum });
    } else {
      for (const r of g.rows) out.push({ ...g.visible, req_kgs: num(r.req_kgs) });
    }
  }
  return out;
}

/** A stored line as `foldLines` reads it — numbers, as the DB holds them. */
export type StoredPlanLine = {
  color_name: string | null;
  print_name: string | null;
  finish_dia: string | null;
  req_kgs: number | null;
};

const str = (n: number | null | undefined): string => (n == null ? "" : String(n));

/**
 * STORED LINES OF ONE FABRIC → THE SCREEN'S ROW, the attribute INFERRED (see
 * the header). The row-level cells are filled for an axis that is not split
 * (every line then agrees on it, by construction of `expandPlan`); the rows
 * carry the split axes in stored order. One line → Fabric, with the cells on
 * the row and one row kept in `rows` so a later switch to a split starts from
 * what was typed (the Material BOM's "switching keeps the rows").
 */
export function foldLines(lines: readonly StoredPlanLine[], newKey: () => string): PlanLine {
  const rows: PlanRow[] = lines.map((r) => ({
    key: newKey(),
    color_name: r.color_name ?? "",
    print_name: r.print_name ?? "",
    dia: r.finish_dia ?? "",
    req_kgs: str(r.req_kgs),
  }));
  const first = lines[0];
  const colours = new Set(lines.map((r) => comboKey(r.color_name)));
  const dias = new Set(lines.map((r) => comboKey(r.finish_dia)));
  const plan_by: PlanBy =
    lines.length <= 1 ? "fabric" : colours.size > 1 && dias.size > 1 ? "colour_dia" : colours.size > 1 ? "colour" : dias.size > 1 ? "dia" : "colour_dia";
  return {
    plan_by,
    color_name: planHasColour(plan_by) ? "" : (first?.color_name ?? ""),
    print_name: planHasColour(plan_by) ? "" : (first?.print_name ?? ""),
    finish_dia: planHasDia(plan_by) ? "" : (first?.finish_dia ?? ""),
    req_kgs: plan_by === "fabric" ? str(first?.req_kgs) : "",
    rows: rows.length ? rows : [blankPlanRow(newKey())],
  };
}

/**
 * SWITCHING THE ATTRIBUTE KEEPS WHAT WAS TYPED (the Material BOM's rule).
 * Fabric → a split seeds the first row from the fabric row's own cells; a
 * split → Fabric copies the first row's values back onto the fabric row and
 * leaves `rows` in place, out of sight, so a mis-click costs nothing. Between
 * splits the rows stay as they are (Colour → Colour + Dia keeps every colour
 * row and asks for its dia). A split with no rows is seeded with one blank
 * row so the sheet opens ready to type.
 */
export function replan(l: PlanLine, plan_by: PlanBy, newKey: () => string): PlanLine {
  if (plan_by === l.plan_by) return l;
  if (l.plan_by === "fabric") {
    /* Under Fabric the ROW's cells are the truth and `rows` is what an earlier
       split left behind. A split of two or more kept rows is restored as it
       was; otherwise one row is seeded from the row's own cells — never a
       stale single row, which would put back a colour the operator has since
       changed on the row. */
    const kept = keptPlanRows(l.rows);
    const seed: PlanRow = { key: newKey(), color_name: l.color_name, print_name: l.print_name, dia: l.finish_dia, req_kgs: l.req_kgs };
    const rows = kept.length >= 2 ? l.rows : [seed];
    return {
      ...l,
      plan_by,
      color_name: planHasColour(plan_by) ? "" : l.color_name,
      print_name: planHasColour(plan_by) ? "" : l.print_name,
      finish_dia: planHasDia(plan_by) ? "" : l.finish_dia,
      req_kgs: "",
      rows,
    };
  }
  if (plan_by === "fabric") {
    const first = keptPlanRows(l.rows)[0];
    return {
      ...l,
      plan_by,
      color_name: planHasColour(l.plan_by) ? (first?.color_name ?? "") : l.color_name,
      print_name: planHasColour(l.plan_by) ? (first?.print_name ?? "") : l.print_name,
      finish_dia: planHasDia(l.plan_by) ? (first?.dia ?? "") : l.finish_dia,
      req_kgs: str(reqKgsOf(l)),
    };
  }
  /* Split → split: A ROW KEEPS EVERY AXIS IT WAS TYPED WITH. An axis that
     leaves the split is merely HIDDEN — `expandPlan` reads the fabric row for
     it and merges rows that differ only there — so switching back restores
     the rows exactly (client screenshot 2993: Colour + Dia → Colour → Colour +
     Dia used to stamp one dia onto every row). An axis that joins the split
     fills a row only where the row has none. The fabric row takes the first
     row's value for an axis that leaves, so the summary and the expansion
     agree. */
  const gainsColour = planHasColour(plan_by) && !planHasColour(l.plan_by);
  const losesColour = !planHasColour(plan_by) && planHasColour(l.plan_by);
  const gainsDia = planHasDia(plan_by) && !planHasDia(l.plan_by);
  const losesDia = !planHasDia(plan_by) && planHasDia(l.plan_by);
  const first = keptPlanRows(l.rows)[0];
  return {
    ...l,
    plan_by,
    color_name: losesColour ? (first?.color_name ?? "") : gainsColour ? "" : l.color_name,
    print_name: losesColour ? (first?.print_name ?? "") : gainsColour ? "" : l.print_name,
    finish_dia: losesDia ? (first?.dia ?? "") : gainsDia ? "" : l.finish_dia,
    rows: l.rows.map((r) => ({
      ...r,
      color_name: gainsColour && !r.color_name.trim() ? l.color_name : r.color_name,
      print_name: gainsColour && !r.print_name.trim() ? l.print_name : r.print_name,
      dia: gainsDia && !r.dia.trim() ? l.finish_dia : r.dia,
    })),
  };
}

/**
 * THE STAGE CHANGED — RESTRICTED, NOT WARNED (the row's own rule, "the stage
 * decides the fields"). To GREIGE (rank 0): the colour axis is dropped, the
 * attribute becomes Fabric / Dia, and rows that now share a dia are MERGED,
 * summing their weights — greige is one lot, and a weight typed under a colour
 * is not thrown away when the colour goes. Prints go the same way off a Print
 * stage (rank 2). To a coloured stage from greige: the plan is kept as it is —
 * the Colour cell (on the row, or per breakup row) is then owed and held,
 * which is the rules' job, not this file's.
 */
export function replanForStage(l: PlanLine, rank: number | null, newKey: () => string): PlanLine {
  let next: PlanLine = { ...l, rows: l.rows.map((r) => ({ ...r })) };
  if (rank === 0) {
    if (planHasColour(next.plan_by)) {
      const merged = new Map<string, PlanRow>();
      for (const r of keptPlanRows(next.rows)) {
        const key = comboKey(r.dia);
        const held = merged.get(key);
        const kg = num(r.req_kgs);
        if (held) {
          const sum = (num(held.req_kgs) ?? 0) + (kg ?? 0);
          held.req_kgs = kg == null && num(held.req_kgs) == null ? "" : String(Number(sum.toFixed(4)));
        } else merged.set(key, { ...r, key: newKey(), color_name: "", print_name: "" });
      }
      const rows = [...merged.values()];
      next = { ...next, plan_by: next.plan_by === "colour_dia" ? "dia" : "fabric", rows: rows.length ? rows : [blankPlanRow(newKey())] };
      if (next.plan_by === "fabric") {
        const first = next.rows[0];
        next = { ...next, finish_dia: next.finish_dia || first?.dia || "", req_kgs: str(reqKgsOf({ plan_by: "dia", req_kgs: "", rows: next.rows })) };
      }
    }
    next = { ...next, color_name: "", print_name: "", rows: next.rows.map((r) => ({ ...r, color_name: "", print_name: "" })) };
  }
  if (rank !== 2) {
    next = { ...next, print_name: "", rows: next.rows.map((r) => ({ ...r, print_name: "" })) };
  }
  return next;
}

/** "WHITE · RED" / "74 · 76" — what the fabric row shows for a split axis. */
export function planSummary(rows: readonly PlanRow[], pick: (r: PlanRow) => string): string {
  return [...new Set(keptPlanRows(rows).map((r) => pick(r).trim()).filter(Boolean))].join(" · ");
}

/** The colours a plan names — Fabric Allocation's derived No Of Colors. */
export function plannedColours(l: PlanLine): string[] {
  return [...new Set(expandPlan(l).map((f) => comboKey(f.color_name)).filter(Boolean))];
}
