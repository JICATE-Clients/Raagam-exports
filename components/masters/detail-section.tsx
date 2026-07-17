import type { ReactNode } from "react";

/**
 * Bordered "card" wrapper — groups a set of related fields under a small
 * uppercase label. Used throughout the masters screens' Sheet editors so a
 * long Details form reads as a few clear blocks instead of one flat stack of
 * fields (same visual language as the Attributes/Mixing/Using (Items) child
 * grids: a `rounded-lg border` card with a `label-caps`-style header).
 */
export function DetailSection({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
