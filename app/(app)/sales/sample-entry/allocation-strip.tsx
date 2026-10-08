import { fmtNumber } from "@/lib/format";

/**
 * "14 of 20 allocated · 6 remaining" — Order Entry's balance strip, drawn under
 * its Assortments matrix (garment-order-screen.tsx, `assortGrid`), copied here
 * so a Sample total reads the same way (user 2026-10-06, compared side by side).
 *
 * It replaced an amber sentence under each Sample grid. The strip says the same
 * thing in BOTH states — balanced as well as short — so the operator sees the
 * running figure while typing rather than a warning that appears only once they
 * are wrong. Over the target it turns red, which is the one state Order Entry
 * colours.
 */
export function AllocationStrip({ allocated, target }: { allocated: number; target: number }) {
  const over = allocated > target;
  return (
    <p
      className={
        // w-fit: hugs its sentence like the matrix above it (user 2026-10-08).
        "mt-1 w-fit max-w-full rounded-md border px-2.5 py-0.5 text-xs tabular-nums " +
        (over
          ? "border-danger/40 bg-danger/10 font-semibold text-danger"
          : "border-border bg-surface-muted text-muted-foreground")
      }
    >
      {fmtNumber(allocated)} of {fmtNumber(target)} allocated
      <span aria-hidden className="px-1.5 opacity-40">
        ·
      </span>
      {over ? `${fmtNumber(allocated - target)} over` : `${fmtNumber(target - allocated)} remaining`}
    </p>
  );
}
