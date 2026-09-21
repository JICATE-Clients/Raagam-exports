/**
 * COLOUR-WISE PROCESS LOSS (0606, client spec 2026-09-21) — the rules, client-safe.
 *
 * A route step (Fabric Process) or a yarn step (Yarn Process) may be marked
 * "Assort Color-Wise Loss" and carry one loss % per colourway, because a dark
 * shade (BLACK, NAVY) runs a longer vat cycle and loses more than WHITE does.
 * The percentages are set in the [Set Color Loss] dialog opened from the row.
 *
 * ## WHAT LIVES HERE AND WHAT DOES NOT
 *
 * Here: the payload schema, the text ⇄ number bridge, the dialog's validation
 * gate and the one-line summary the row shows. NOT here: the arithmetic. That
 * is `lossForCombo` in `./yarn-process.ts`, applied inside `stagesForGroup`,
 * which is the single filter every ladder (yarn purchase, cloth purchase, both
 * report breakdowns) walks — so the preview, the stored purchase and the
 * printed report cannot disagree about a colour's loss.
 *
 * This file imports nothing from the module, so `./yarn-process.ts` and
 * `./processes.ts` can both import it without a cycle. `colourKey` is therefore
 * written out here rather than borrowed from `comboKey`; it is the identical
 * rule (trim, upper-case), and `lossForCombo` matches keys through `comboKey`,
 * so a key normalised here is found there.
 *
 * ## THREE DECISIONS WORTH NOT RE-LITIGATING
 *
 * - **A colourway missing from the map uses the step's own Loss %** — the
 *   dialog's "Default Stage %". A colourway added to the order after the
 *   losses were set degrades to the stated default, never to zero loss.
 * - **Toggle off stores an EMPTY map** (enforced by 0606's CHECK too). A
 *   figure the screen no longer shows must not keep changing a purchase.
 * - **Only an "All colours" step can go colour-wise.** A step already scoped
 *   to one colourway (Compo Color = RED) has exactly one loss by definition.
 */
import { z } from "zod";

/** Same rule as `comboKey` in `./yarn-process.ts` — see the header. */
export const colourKey = (c: string | null | undefined): string => (c ?? "").trim().toUpperCase();

/** The map as a form holds it: text, because a controlled `<Input>` cannot hold
 *  "4." or "" as a number. Converted once, at the boundary. */
export type ColorLossDraft = Record<string, string>;

/**
 * The payload field. Keys normalised through `colourKey` (so they match the
 * requirement rows' own combo), blank keys dropped, each value in the range
 * every loss column in this module carries: 0 ≤ loss < 100.
 */
export const colorLossesInput = z
  .record(z.string(), z.coerce.number().min(0).lt(100))
  .default({})
  .transform((m) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) {
      const key = colourKey(k);
      if (key) out[key] = v;
    }
    return out;
  });

/** The stored pair, from what the payload carried. Off ⇒ empty — see header. */
export function colorLossesForStorage(
  wise: boolean | null | undefined,
  map: Readonly<Record<string, number>> | null | undefined,
): { color_wise_loss: boolean; color_losses: Record<string, number> } {
  if (!wise) return { color_wise_loss: false, color_losses: {} };
  return { color_wise_loss: true, color_losses: { ...(map ?? {}) } };
}

/** A stored map (jsonb, numbers) → the form's text map. */
export function colorLossesToDraft(stored: unknown): ColorLossDraft {
  const out: ColorLossDraft = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (colourKey(k) && Number.isFinite(n)) out[colourKey(k)] = String(n);
  }
  return out;
}

/**
 * The form's text map → numbers, for the engine (the screen's preview) and the
 * payload. A blank or unreadable entry is LEFT OUT, which the engine reads as
 * "use the step's default" — the same answer a colourway never set gets.
 * `wise` false returns null: the flat loss applies.
 */
export function colorLossesFromDraft(
  wise: boolean | null | undefined,
  draft: ColorLossDraft | null | undefined,
): Record<string, number> | null {
  if (!wise || !draft) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(draft)) {
    const t = (v ?? "").trim();
    if (!t) continue;
    const n = Number(t);
    if (colourKey(k) && Number.isFinite(n)) out[colourKey(k)] = n;
  }
  return out;
}

/**
 * THE DIALOG'S SAVE GATE (spec §2.B): every colourway listed must carry a valid
 * loss — a number, 0 or more, under 100. Returns the first problem as a
 * sentence naming the colour, or null when the dialog may save.
 */
export function colorLossProblem(colours: readonly string[], draft: ColorLossDraft): string | null {
  if (colours.length === 0) return "This fabric has no colourways yet — add them on Fabric Lines first";
  for (const c of colours) {
    const t = (draft[colourKey(c)] ?? "").trim();
    if (!t) return `Enter the loss % for ${c}`;
    const n = Number(t);
    if (!Number.isFinite(n)) return `The loss % for ${c} is not a number`;
    if (n < 0) return `The loss % for ${c} cannot be negative`;
    if (n >= 100) return `The loss % for ${c} must be below 100`;
  }
  return null;
}

/**
 * The dialog's starting values: what is already set, and the step's default
 * for every colourway not set yet (spec: "defaulting to the stage base loss").
 * Only the colourways listed are returned, so saving the dialog also drops a
 * colourway that has left the fabric.
 */
export function colorLossSeed(
  colours: readonly string[],
  draft: ColorLossDraft | null | undefined,
  baseLoss: string,
): ColorLossDraft {
  const out: ColorLossDraft = {};
  for (const c of colours) {
    const k = colourKey(c);
    const held = (draft?.[k] ?? "").trim();
    out[k] = held || baseLoss.trim();
  }
  return out;
}

/** "GREEN 5 · RED 4 · WHITE 3" — what the row shows beside its button, in the
 *  fabric's colour order. A colourway not set reads the default. */
export function colorLossSummary(
  colours: readonly string[],
  draft: ColorLossDraft | null | undefined,
  baseLoss: string,
): string {
  return colours
    .map((c) => {
      const v = (draft?.[colourKey(c)] ?? "").trim() || baseLoss.trim();
      return `${c} ${v === "" ? "—" : v}`;
    })
    .join(" · ");
}

/** Stable text of a map, for the colour fold's route key: two rows whose
 *  colour losses differ are different steps and must never fold together. */
export const colorLossKey = (wise: boolean | null | undefined, draft: ColorLossDraft | null | undefined) =>
  wise
    ? Object.entries(draft ?? {})
        .map(([k, v]) => `${colourKey(k)}=${(v ?? "").trim()}`)
        .sort()
        .join(",")
    : "";

/**
 * THE SECTION TOTAL'S "Avg" LOSS (spec §4) — shown only when a section's lines
 * carry DIFFERENT losses, i.e. a colour-wise step is on the page.
 *
 * It is the one loss that, put through the SAME `/(1 - L)` every line uses,
 * turns the section's planned total into its ordered total:
 *
 *     avg = 1 - planned / ordered
 *
 * NOT `ordered / planned - 1`. The spec's sample prints "Avg 4.54%" for
 * 1021.000 → 1067.311, which is that second figure — the markup — and it does
 * not reproduce the total under this module's formula (1021 / 0.9546 = 1069.5).
 * 4.34% does (1021 / 0.9566 = 1067.311). A total row has to agree with the
 * lines above it, so the consistent figure is printed.
 *
 * Null when there is nothing to average or the lines all carry one loss (the
 * column already says it).
 */
export function sectionAverageLoss(
  lines: readonly { lossPct: number | null | undefined }[],
  planned: number,
  ordered: number,
): number | null {
  const distinct = new Set(lines.map((l) => Number((l.lossPct ?? 0).toFixed(4))));
  if (distinct.size < 2 || !(planned > 0) || !(ordered > 0)) return null;
  return (1 - planned / ordered) * 100;
}

/**
 * DOES THIS ROW'S "For" / "Loss for" SAY COLOR WISE? (client 2026-09-21)
 *
 * THE For FIELD IS THE SWITCH — there is no second toggle. PROCESS WISE (or
 * blank) = one Loss % for the step, no colour field; COLOR WISE = the Loss %
 * box gives way to a [Color Loss] button listing each colour with its own
 * loss. Both grids (Yarn Process, Fabric Process) read this one function, so
 * the two tabs cannot answer the same label differently.
 *
 * Matched on the lookup's CODE first (`color_wise`, seeded by 0519) and then on
 * its NAME in either spelling — an operator may rename the label, and a list
 * renamed COLOUR WISE must not silently stop being colour-wise (AGENTS.md, Near
 * misses). Structural `{ id, code?, name }` so it takes any lookup row.
 */
export function isColorWiseFor(
  lossForId: string | null | undefined,
  lookups: readonly { id: string; code?: string | null; name: string }[],
): boolean {
  if (!lossForId) return false;
  const opt = lookups.find((l) => l.id === lossForId);
  if (!opt) return false;
  return (opt.code ?? "").toLowerCase() === "color_wise" || /colou?r/i.test(opt.name);
}
