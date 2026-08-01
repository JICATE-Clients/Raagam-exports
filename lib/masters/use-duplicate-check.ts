"use client";

// Debounced real-time duplicate-name check. Returns an error string while the
// typed name collides with an existing record (else null). Backstopped by the
// on-save guard in each master's create/update action.

import { useEffect, useState } from "react";
import { checkDuplicate } from "@/lib/masters/duplicate-actions";

export function useDuplicateCheck(args: {
  table: string;
  name: string;
  nameColumn?: string;
  excludeId?: string;
  scope?: Record<string, string | null>;
  /**
   * Word used in the message ("name", "code", "GST number"). Defaults to
   * "name", so callers checking a non-name column should say what it is —
   * otherwise a duplicate GSTIN reads "use a different name".
   */
  label?: string;
  /** Skip checking while false (e.g. required-field empty). Defaults to true. */
  enabled?: boolean;
}): string | null {
  const { table, name, nameColumn, excludeId, scope, label, enabled = true } = args;
  const scopeKey = JSON.stringify(scope ?? {});
  // The exact question this error would be the answer to.
  const askKey = JSON.stringify([table, name.trim(), nameColumn, excludeId, scopeKey, label, enabled]);

  const [answered, setAnswered] = useState<{ key: string; error: string | null } | null>(null);

  /**
   * THE ERROR IS ONLY REAL FOR THE VALUE IT WAS COMPUTED FOR.
   *
   * This used to be a plain `useState` that kept the resolved error until the
   * NEXT round trip replaced it — so for 300ms of debounce plus a server hop
   * after an edit, the message on screen described the PREVIOUS value. That was
   * cosmetic while the error only tinted a border. It is a lockout now that the
   * keyboard hold reads it (2026-07-31): the operator fixes the name, presses
   * Tab, and is still caged by an error about a name they no longer have.
   *
   * Comparing against `askKey` collapses the whole race. The instant `name` (or
   * the scope, or excludeId) changes, `askKey` changes and this returns null in
   * the SAME render as the keystroke — no effect, no second render pass, no
   * window in which a stale error can be enforced.
   *
   * The cost is a blink: typing "ABCD" where both "ABC" and "ABCD" collide
   * clears the message on the D and brings it back ~300ms later. That is the
   * right way round — a message that flickers is a cosmetic complaint, a
   * message that outlives its value is a cage.
   *
   * It also makes a failed or hung round trip fail OPEN: no answer means no
   * error means no hold, and the on-save guard stays authoritative as before.
   */
  const error = answered?.key === askKey ? answered.error : null;

  useEffect(() => {
    // Nothing to ask, and nothing to clear: an answer is only ever stored for a
    // non-empty enabled name, so no stored key can match this `askKey` and
    // `error` above is already null. (This used to setState here, which was both
    // redundant and a cascading-render lint error.)
    if (!enabled || !name.trim()) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await checkDuplicate(table, name.trim(), {
          nameColumn,
          excludeId,
          scope: scope ?? undefined,
          label,
        });
        if (cancelled) return;
        // ONLY A REAL COLLISION. `kind: "failed"` is an RLS denial or a timeout
        // — holding the cursor on that would be a cage no keystroke can open,
        // because every re-check fails the same way (see dup-guard.ts).
        setAnswered({
          key: askKey,
          error: res.ok || res.kind !== "duplicate" ? null : res.error,
        });
      } catch {
        // The action threw (offline, deploy mid-flight). Stay silent rather
        // than trapping the operator on an unanswered question.
        if (!cancelled) setAnswered({ key: askKey, error: null });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `askKey` IS the dependency list — every input above is inside it, so the
    // effect re-runs exactly when the question changes and never otherwise.
    // (It replaces the old per-value list, which needed this same escape hatch
    // because `scope` is a fresh object literal at every consumer's render.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey]);

  return error;
}

/**
 * `useDuplicateCheck` plus a SYNCHRONOUS pass over the rows already on screen.
 *
 * The server half is debounced 300ms, so between the keystroke and the answer
 * there is a window in which the field looks clean. An operator who types a
 * known-duplicate name and hits Enter straight away lands inside that window and
 * saves the duplicate — the on-save guard rejects it, but only after a round
 * trip, and the toast is a worse place to learn this than the field is.
 *
 * The local pass closes that window: it resolves in the SAME render as the
 * keystroke, so `data-dup-error` is on the input before Enter can be read. It
 * cannot replace the server half — a filtered or paged list does not hold every
 * row — so the two are a UNION: either one seeing a collision is a collision.
 * The server message wins when both fire, because it is the authoritative one.
 *
 * The message is built to match `dup-guard.ts` verbatim. If it ever drifts, the
 * same duplicate would be worded one way inside the window and another way
 * outside it.
 *
 * Pass `rows` + `rowValue` to get the local half; omit them and this is exactly
 * `useDuplicateCheck`. Feed the result to `dupFieldProps` and `<DuplicateError>`
 * as usual — a locally-found duplicate must hold the cursor identically to a
 * server-found one, or the hold becomes a race the operator can feel.
 */
export function useDuplicateName<Row>(args: {
  table: string;
  name: string;
  nameColumn?: string;
  excludeId?: string;
  scope?: Record<string, string | null>;
  label?: string;
  enabled?: boolean;
  /** Rows already rendered by this screen. Omit for a server-only check. */
  rows?: readonly Row[];
  /** Row primary key; omit when the screen cannot be in edit mode. */
  rowId?: (r: Row) => string;
  /** The comparable value on a row — the local mirror of `nameColumn`. */
  rowValue?: (r: Row) => string | null | undefined;
  /** True when a row sits in the same `scope` being checked (scoped masters only). */
  rowInScope?: (r: Row) => boolean;
}): string | null {
  const { name, label, enabled = true, rows, rowId, rowValue, rowInScope, excludeId } = args;
  const serverError = useDuplicateCheck(args);

  const trimmed = name.trim();
  const norm = trimmed.toLowerCase();
  const localDuplicate =
    enabled &&
    !!norm &&
    !!rows &&
    !!rowValue &&
    rows.some(
      (r) =>
        // `excludeId` undefined means "adding" — nothing to exclude, and a row
        // whose id we cannot read is compared rather than skipped.
        (!excludeId || !rowId || rowId(r) !== excludeId) &&
        (!rowInScope || rowInScope(r)) &&
        (rowValue(r) ?? "").trim().toLowerCase() === norm,
    );

  return (
    serverError ??
    (localDuplicate ? `"${trimmed}" already exists. Use a different ${label ?? "name"}.` : null)
  );
}

/** Frozen so the no-error case is one stable object, not a fresh literal per render. */
const NO_DUP = Object.freeze({});

/**
 * Everything a field needs to carry a live duplicate error, in one spread.
 * Pair it with `<DuplicateError>` (components/ui/duplicate-error.tsx) and pass
 * both the same `id`.
 *
 * `data-dup-error` is the NARROW signal the keyboard hold reads (see
 * components/shell/keyboard-nav-provider.tsx): while it is present the cursor
 * stays on the field. It deliberately is NOT `aria-invalid` — ValidatedInput
 * sets that live for every required-but-empty and format-mismatched field
 * (components/ui/validated-input.tsx:37-42), so a hold keyed off `aria-invalid`
 * would cage the operator in the first blank box of every form.
 *
 * The keys are OMITTED when there is no error rather than set to `undefined`.
 * An explicit `undefined` in a JSX spread still OVERRIDES — and ValidatedInput
 * spreads `{...props}` after setting its own `aria-invalid`, so emitting
 * `undefined` here would silently wipe out its required-field invalidity on
 * every field that has both a format and a duplicate check.
 *
 * Never write `data-dup-error` by hand; the audit script looks for this helper.
 */
export function dupFieldProps(error: string | null, id?: string) {
  if (!error) return NO_DUP;
  return id
    ? { "aria-invalid": true as const, "aria-describedby": `${id}-dup`, "data-dup-error": error }
    : { "aria-invalid": true as const, "data-dup-error": error };
}
