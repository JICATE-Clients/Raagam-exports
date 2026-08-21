/**
 * Approval Qty — the Style ▸ Combo ▸ Size tree, DERIVED (0435).
 *
 * Legacy RP shows this tab as three nested levels and types almost nothing in
 * it (screenshot 2372): the identity comes from Style(s) and Combos, the
 * quantities from the size breakup, and the operator enters one number. Ours was
 * one flat level where the style was picked, the colour was picked and the
 * quantity was TYPED — three answers the order had already given somewhere else
 * (client 2026-08-19: "the table are pulling data from previous section not
 * manual entry").
 *
 * ## THE QUANTITY ALREADY EXISTED, which is why this is a builder and not a form
 *
 * The Quantities tab's assortment tree states the pieces of every
 * (style, combo, size) — it is what the Prices tab averages a Colour-wise or
 * Size-wise rate by, through the same flattening. So nothing here computes a
 * quantity; it groups one that was already computed, by the same key, and the
 * two tabs cannot disagree because there is one source.
 *
 * ## WHAT IS TYPED, AND WHERE — one place, on purpose
 *
 * `approval_qty` is entered at SIZE level only (client 2026-08-19). The combo
 * line above it is the SUM of its sizes and is read-only. Legacy renders the
 * column at both levels; taking that literally would give one number two homes,
 * and the first time they disagreed there would be no rule saying which won.
 *
 * ## NOTHING THE OPERATOR TYPED IS EVER DROPPED
 *
 * Rows are derived, but the numbers in them are not — so a stored approval
 * quantity whose (style, combo, size) no longer appears in the breakup has to
 * go somewhere. It goes in `orphans`, and the caller is expected to say so on
 * screen. Silently discarding it would delete the operator's work on a document
 * they are about to sign, and the trigger is ordinary: renaming a colour on the
 * Combos tab, or removing a size from a style.
 *
 * Client-safe (no `server-only`): the tree recalculates as the operator types.
 */

/** Trim + upper — the same `styleKey` shape every cross-tab reference uses. */
const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** One (style, combo, size) slice of the Quantities assortment tree. */
export type BreakupWeight = {
  style_ref_no: string;
  combo: string;
  size_id: string | null;
  qty: number;
};

/** A stored approval row — the only thing on this tab anyone types. */
export type StoredApproval = {
  style_ref_no: string;
  combo: string;
  size_id: string | null;
  approval_qty: string;
};

export type StyleIdentity = {
  style_ref_no: string;
  style: string;
  article_no: string;
  /** The style's declared size set, IN ORDER — order is the data. */
  sizes: (string | null)[];
};

export type ComboIdentity = {
  style_ref_no: string;
  combo: string;
  combo_description: string;
};

export type ApprovalSizeNode = {
  size_id: string | null;
  /** Pieces, from the breakup. Derived — never typed. */
  qty: number;
  /** The typed number, as the string an `<Input>` holds. "" when never entered. */
  approvalQty: string;
};

export type ApprovalComboNode = {
  combo: string;
  combo_description: string;
  /** Σ of `sizes[].qty`. */
  qty: number;
  sizes: ApprovalSizeNode[];
};

export type ApprovalStyleNode = StyleIdentity & { combos: ApprovalComboNode[] };

export type ApprovalTree = {
  styles: ApprovalStyleNode[];
  /**
   * Stored rows that match no node — a renamed colour, a removed size, or a row
   * seeded from a legacy order (which has neither colour nor size). Carried so
   * the caller can render and save them; never silently dropped.
   */
  orphans: StoredApproval[];
};

/** The key all three inputs are joined on. */
export function approvalKey(
  styleRefNo: string | null | undefined,
  combo: string | null | undefined,
  sizeId: string | null | undefined,
): string {
  return `${norm(styleRefNo)}|${norm(combo)}|${sizeId ?? ""}`;
}

/**
 * Build the tree.
 *
 * THE ROWS COME FROM THE COMBOS TAB, NOT FROM THE BREAKUP, and that choice is
 * the difference between a tab that fills in as the order is entered and one
 * that is empty until the very last step. A colour the order has declared but
 * not yet packed shows with a quantity of 0 rather than not existing — the
 * operator can see the colour is accounted for and that its quantities have not
 * been entered yet. Driving the rows off the breakup instead would make the
 * whole tab vanish until the Quantities tab was complete, which reads as broken.
 *
 * SIZES FOLLOW THE STYLE'S DECLARED ORDER (`StyleIdentity.sizes`), because that
 * order IS the data — 2 YEARS before 14 YEARS is a size run, not an alphabetical
 * accident. A size that appears in the breakup but not on the style is appended
 * rather than dropped: it is a real quantity, and hiding it would make the combo
 * total disagree with the sizes shown under it.
 */
export function buildApprovalTree(input: {
  styles: readonly StyleIdentity[];
  combos: readonly ComboIdentity[];
  breakup: readonly BreakupWeight[];
  stored: readonly StoredApproval[];
}): ApprovalTree {
  const { styles, combos, breakup, stored } = input;

  const pieces = new Map<string, number>();
  for (const w of breakup) {
    if (!norm(w.style_ref_no)) continue;
    const k = approvalKey(w.style_ref_no, w.combo, w.size_id);
    pieces.set(k, (pieces.get(k) ?? 0) + (Number.isFinite(w.qty) ? w.qty : 0));
  }

  const approvals = new Map<string, string>();
  for (const r of stored) {
    approvals.set(approvalKey(r.style_ref_no, r.combo, r.size_id), r.approval_qty);
  }

  /** Every key the tree ends up covering — what makes an orphan an orphan. */
  const covered = new Set<string>();

  const out: ApprovalStyleNode[] = [];
  for (const st of styles) {
    if (!norm(st.style_ref_no)) continue;
    const mine = combos.filter(
      (c) => norm(c.style_ref_no) === norm(st.style_ref_no) && c.combo.trim(),
    );
    const comboNodes: ApprovalComboNode[] = [];
    for (const c of mine) {
      // The style's own run first, then any size the breakup names that the
      // style does not — appended, never dropped, or the combo total would not
      // equal the sizes beneath it.
      const declared = st.sizes.slice();
      const extra = breakup
        .filter(
          (w) =>
            norm(w.style_ref_no) === norm(st.style_ref_no) &&
            norm(w.combo) === norm(c.combo) &&
            !declared.some((d) => (d ?? "") === (w.size_id ?? "")),
        )
        .map((w) => w.size_id);
      const sizeIds = [...declared, ...Array.from(new Set(extra))];

      const sizes: ApprovalSizeNode[] = sizeIds.map((size_id) => {
        const k = approvalKey(st.style_ref_no, c.combo, size_id);
        covered.add(k);
        return {
          size_id,
          qty: pieces.get(k) ?? 0,
          approvalQty: approvals.get(k) ?? "",
        };
      });

      comboNodes.push({
        combo: c.combo,
        combo_description: c.combo_description,
        qty: sizes.reduce((a, z) => a + z.qty, 0),
        sizes,
      });
    }
    out.push({ ...st, combos: comboNodes });
  }

  const orphans = stored.filter(
    (r) =>
      (Number(r.approval_qty) || 0) !== 0 &&
      !covered.has(approvalKey(r.style_ref_no, r.combo, r.size_id)),
  );

  return { styles: out, orphans };
}

/**
 * The tree back to flat rows, for the payload.
 *
 * EVERY DERIVED ROW IS WRITTEN, not only the ones carrying a typed number, so
 * the saved amendment is a complete record of what was agreed rather than a
 * sparse list of the lines somebody happened to touch. `qty` goes with it as a
 * SNAPSHOT — the tab no longer types it, and `diff.ts` deliberately does not
 * report it, because a quantity change belongs to the Quantities tab's diff and
 * appearing in both would read as two separate changes.
 *
 * Orphans are appended unchanged. They are the operator's typed numbers with
 * nowhere left to sit, and a save that dropped them would destroy work.
 */
export function flattenApprovalTree(tree: ApprovalTree): {
  style_ref_no: string;
  style: string;
  article_no: string;
  combo: string;
  combo_description: string;
  size_id: string | null;
  qty: number;
  approval_qty: number;
}[] {
  const rows: ReturnType<typeof flattenApprovalTree> = [];
  for (const st of tree.styles) {
    for (const c of st.combos) {
      for (const z of c.sizes) {
        rows.push({
          style_ref_no: st.style_ref_no,
          style: st.style,
          article_no: st.article_no,
          combo: c.combo,
          combo_description: c.combo_description,
          size_id: z.size_id,
          qty: z.qty,
          approval_qty: Number(z.approvalQty) || 0,
        });
      }
    }
  }
  for (const o of tree.orphans) {
    rows.push({
      style_ref_no: o.style_ref_no,
      style: "",
      article_no: "",
      combo: o.combo,
      combo_description: "",
      size_id: o.size_id,
      qty: 0,
      approval_qty: Number(o.approval_qty) || 0,
    });
  }
  return rows;
}

/**
 * ONE ANSWER FOR A WHOLE COLOUR, or null when the sizes disagree.
 *
 * The Approval Qty screen asks per COLOUR, not per size, because that is the
 * decision being made: on the legacy screen every colour's six sizes read
 * `2, 2, 2, 2, 2, 2` (client screenshot 2443) — one answer typed six times.
 * The rows still STORE six values, and `flattenApprovalTree` still writes six;
 * the single box is a way of writing them, never a replacement for them.
 *
 * BLANK IS NOT ZERO, and that is the whole reason this compares TEXT rather
 * than `Number()`. An untouched size holds "" and a size deliberately set to
 * nought holds "0"; coercing would call those two uniform and let one box
 * overwrite a real answer with an assumed one. Approval Qty is not `required`,
 * so both states are legitimate and have to stay distinguishable.
 *
 * `"02"` beside `"2"` reads as MIXED. Numerically equal, textually not — and
 * the honest answer is to open the sizes and show the operator what is actually
 * stored rather than silently normalise a value they did not retype.
 *
 * Null for an empty list too: a colour with no sizes has nothing to be uniform
 * about, and its caller has a different thing to say.
 */
export function uniformApproval(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const first = values[0].trim();
  return values.every((v) => v.trim() === first) ? first : null;
}
