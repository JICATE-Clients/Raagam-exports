/**
 * The dashboard's frosted-glass surface (user 2026-10-28, approved artifact
 * "Dashboard Redesign Plan", layout A).
 *
 * It is the Budget Approval breakdown ring's glass, taken page-wide: the same
 * `--glass*` tokens in app/globals.css, so `.dark` restyles it and no colour is
 * new. Glass only reads as glass over colour, which is what `GlassBackdrop`'s
 * three blurred blooms are for — they sit behind the cards, never behind text
 * on their own.
 *
 * `GLASS` is a class string for `<Card className>` rather than a second card
 * component: `Card` already runs its classes through `cn()`, so `bg-none`
 * drops the `--smoke` image layer and the glass colour replaces `bg-surface`
 * without a fork of the primitive.
 */
export const GLASS =
  "rounded-2xl border-[var(--glass-edge)] bg-[var(--glass)] bg-none shadow-[var(--glass-shadow)] backdrop-blur-xl";

/** A lighter pane for small tiles that sit in a row (mini stats, actions). */
export const GLASS_TILE =
  "rounded-xl border-[var(--glass-edge)] bg-[var(--glass-row)] bg-none shadow-none backdrop-blur-lg";

/**
 * The colour the glass frosts. Decorative, so aria-hidden and click-through.
 *
 * Each bloom sits INSIDE the box, clear of its edges. The box has to clip
 * (a bloom past the right edge scrolls the pane sideways), and a bloom centred
 * on a corner was cut by that clip into a hard-edged blue rectangle behind
 * the greeting (2026-10-29, screenshot 3835).
 */
export function GlassBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <span
        className="absolute left-[12%] top-16 size-[26rem] rounded-full blur-[90px] motion-safe:animate-[glass-drift_16s_ease-in-out_infinite]"
        style={{ background: "var(--glass-blob-a)" }}
      />
      <span
        className="absolute right-[6%] top-[26rem] size-[24rem] rounded-full blur-[90px] motion-safe:animate-[glass-drift_18s_ease-in-out_-6s_infinite]"
        style={{ background: "var(--glass-blob-b)" }}
      />
      <span
        className="absolute bottom-24 left-1/4 h-[22rem] w-[32rem] rounded-full blur-[90px] motion-safe:animate-[glass-drift_20s_ease-in-out_-10s_infinite]"
        style={{ background: "var(--glass-blob-c)" }}
      />
    </div>
  );
}
