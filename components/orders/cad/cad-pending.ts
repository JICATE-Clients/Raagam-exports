/**
 * Order Entry ▸ CAD's unsaved step, waiting for the ORDER's Save (user
 * 2026-09-30, screenshot 3136: "CAD tab have separate save option, no need —
 * remove it; while saving order the CAD details also will save").
 *
 * The inline CAD forms (cad-sheets.tsx, `inline`) have no buttons of their own
 * any more. While one has been changed it parks its check, its write and its
 * draft here, and the order editor's `submit` refuses on `pendingCadProblem`
 * before it writes, then calls `savePendingCad` once the order is saved — the
 * order first, because a CAD is allocated against the order's saved styles.
 *
 * A MODULE STORE, NOT STATE, for two reasons. The order editor returns early
 * above ~19,000 lines and must not grow a hook for this (AGENTS.md "Hooks
 * above every early return"); and the CAD tab REMOUNTS each time the operator
 * returns to it, so a draft kept in the form's own state would be lost the
 * moment they clicked Order Info and then pressed Save. The draft is also what
 * the form re-seeds from on that return.
 *
 * The CAD Lifecycle list's sheets never come here — they keep their own Save.
 */

type Result = { ok: true } | { ok: false; error: string };

export type CadPending = {
  /** The form's title, so a refusal names the style it is about. */
  label: string;
  /** The form's own validation, read at Save time — null when it is clean. */
  problem: () => string | null;
  /** The form's own server action. Touches no React state (it may run unmounted). */
  commit: () => Promise<Result>;
  /** What the form re-seeds from when the tab remounts. */
  draft: unknown;
};

const byOrder = new Map<string, Map<string, CadPending>>();

/** Park (or, with null, withdraw) one form's unsaved step. */
export function setPendingCad(orderId: string, key: string, entry: CadPending | null) {
  let forms = byOrder.get(orderId);
  if (!entry) {
    forms?.delete(key);
    if (forms && forms.size === 0) byOrder.delete(orderId);
    return;
  }
  if (!forms) byOrder.set(orderId, (forms = new Map()));
  forms.set(key, entry);
}

export function pendingCadDraft<T>(orderId: string, key: string): T | undefined {
  return byOrder.get(orderId)?.get(key)?.draft as T | undefined;
}

/** The first CAD form that would refuse, worded for a toast. */
export function pendingCadProblem(orderId: string): string | null {
  for (const p of byOrder.get(orderId)?.values() ?? []) {
    const problem = p.problem();
    if (problem) return `CAD — ${p.label}: ${problem}`;
  }
  return null;
}

/**
 * Write every parked step. A step that saves leaves the store; one that fails
 * stays, so the operator can correct it and press Save again.
 */
export async function savePendingCad(orderId: string): Promise<{ saved: number; errors: string[] }> {
  const forms = byOrder.get(orderId);
  let saved = 0;
  const errors: string[] = [];
  for (const [key, p] of [...(forms ?? [])]) {
    const r = await p.commit();
    if (r.ok) {
      saved++;
      setPendingCad(orderId, key, null);
    } else errors.push(`${p.label}: ${r.error}`);
  }
  return { saved, errors };
}

/** Cancel, or a fresh open of the order: nothing typed before survives it. */
export function clearPendingCad(orderId: string | null) {
  if (orderId) byOrder.delete(orderId);
}
