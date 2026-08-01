/**
 * The message half of a live duplicate check. Pair it with `dupFieldProps` on
 * the input (lib/masters/use-duplicate-check.ts) and give both the same `id` —
 * that is what wires `aria-describedby`.
 *
 * `role="alert"` so the message announces itself when it appears. The REFUSED
 * KEYPRESS is announced separately, by the live region in
 * components/shell/keyboard-nav-provider.tsx: once this message is already on
 * screen, blocking a key produces nothing new for a screen reader to read.
 *
 * The Esc hint is not decoration. This message holds the cursor on the field,
 * and a hold that does not name its own exit is a trap — the operator whose
 * only fix is "cancel and start again" must be told so on screen.
 */
export function DuplicateError({ error, id }: { error: string | null; id?: string }) {
  if (!error) return null;
  return (
    <p id={id ? `${id}-dup` : undefined} role="alert" className="mt-1 text-xs text-danger">
      {error} <span className="text-muted-foreground">Press Esc to cancel.</span>
    </p>
  );
}
