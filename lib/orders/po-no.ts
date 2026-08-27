/**
 * WHICH BUYER PO NUMBER APPLIES TO ONE DELIVERY ROW.
 *
 * A major buyer issues one master order sheet covering several delivery dates
 * and destinations — France, UK, Canada — and the factory runs the whole thing
 * under a single RE Number. But **each shipped lot is invoiced against the
 * buyer's own PO number for that lot**, and their customs agent matches PO to
 * delivery on the paperwork. A mismatch is a hold at the port, not a tidy-up.
 *
 * So `multi_order` (0427) opens a PO No column on the Quantities tab and each
 * destination row may carry its own. This is the one place that answers "which
 * PO does this row bill under", because the answer is a rule and not a column:
 * a row usually has NO PO of its own, and inherits the header's.
 *
 * ## The fallback is the normal case, not the error case
 *
 * A buyer typically issues sub-PO numbers for two of five destinations and
 * leaves the rest on the master contract PO (client 2026-08-26). Treating a
 * blank row cell as missing data would stop the shipping desk on the commonest
 * shape there is. Blank means "same as the order", and only a row with no PO on
 * EITHER level is unanswered.
 *
 * ## Two functions, because two callers need different things
 *
 * This is the same split `approval-qty.ts` already makes between
 * `totalProductionQty` (a null contributes 0 — the dash beside it says the rest)
 * and `productionTarget` (refuses, because nothing sits beside the number once
 * it leaves the screen). Here:
 *
 *   `resolveRowPoNo`  → `string | null`. For a sheet that must render whatever
 *                       it has. A draft order sheet with no PO yet still prints.
 *   `requireRowPoNo`  → refuses, naming the row. For a document that BILLS —
 *                       a commercial invoice with a blank PO field is worse than
 *                       one that was never generated, because it travels.
 *
 * **Neither throws**, and that is deliberate rather than stylistic. A document
 * compiler walks many rows; an exception on row 4 of 12 loses the diagnosis for
 * rows 5-12 and hands the operator one problem at a time, on a workflow the
 * whole feature exists to keep fast. A returned refusal lets the caller collect
 * every unanswered row and name them all at once. It is also the shape every
 * other refusing rule in this codebase already uses (`fullTarget`,
 * `productionTarget`, the `Refusal` type in `material-bom/requirement.ts`), so a
 * caller does not have to learn a second convention for the same idea.
 *
 * No `server-only` and no imports: the order screen resolves this while typing
 * and a server action resolves it again on save, and both must get one answer.
 */

/** Trim, and treat an all-whitespace cell as empty. */
const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * The PO number this delivery row bills under, or null when neither level has
 * one.
 *
 * Row first, header second. Never the reverse: a row that names its own PO is
 * the operator saying THIS lot is billed differently, and a header value
 * overriding it would silently re-bill the lot the toggle exists to separate.
 */
export function resolveRowPoNo(
  rowPoNo: string | null | undefined,
  headerPoNo: string | null | undefined,
): string | null {
  return clean(rowPoNo) ?? clean(headerPoNo) ?? null;
}

/** Whether this row states its own PO, as opposed to inheriting the header's.
 *
 *  Worth showing on a document: "PO 4471-B" against one destination and the
 *  contract PO against the others is a distinction the buyer's agent is looking
 *  for, and a sheet that renders both identically hides which is which. */
export function rowHasOwnPoNo(rowPoNo: string | null | undefined): boolean {
  return clean(rowPoNo) !== null;
}

export type PoNoResolution =
  | { ok: true; poNo: string; fromRow: boolean }
  | { ok: false; reason: string };

/**
 * The same answer, for a document that cannot go out without one.
 *
 * `label` names the row in the operator's terms — the destination, or the
 * reference number — because "a row has no PO" is not actionable on a sheet
 * with twelve of them. It is required rather than optional for that reason: a
 * refusal nobody can act on is a refusal that gets overridden.
 */
export function requireRowPoNo(
  rowPoNo: string | null | undefined,
  headerPoNo: string | null | undefined,
  label: string,
): PoNoResolution {
  const row = clean(rowPoNo);
  const poNo = row ?? clean(headerPoNo);
  if (!poNo) {
    return {
      ok: false,
      reason: `${label} has no PO number, and the order header has none to fall back on. Enter one on the Quantities row or in the order's PO No.`,
    };
  }
  return { ok: true, poNo, fromRow: row !== null };
}
