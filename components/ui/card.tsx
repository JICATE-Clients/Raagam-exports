import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's surface panel.
 *
 * ## Why the `image:` prefix in `bg-[image:var(--smoke)]`
 *
 * `--smoke` is a `linear-gradient(...)`. Without the prefix the utility is a
 * background-*colour*, so it compiles to `background-color: linear-gradient(…)`
 * — invalid, dropped by the parser, and the card renders with NO background.
 * The `image:` form compiles to `background-image`, layering the wash over
 * `bg-surface`. (Don't spell the broken form out in a comment either: Tailwind
 * scans raw file text, so the prose itself would emit the dead rule.) It is
 * also the only form that survives `cn()`: registering a `bg-smoke` theme
 * utility would make tailwind-merge treat it as a background-*colour* and
 * delete the `bg-surface` beside it. Keeping them as separate colour/image
 * layers is what lets the ~10 callers passing `hover:bg-surface-muted`
 * recolour the base while the sheen stays put.
 *
 * ## Why `interactive` is opt-in
 *
 * Only ~10 of the 200-odd Cards in the app are clickable. A hover-lift on the
 * rest — static form panels, read-only detail cards — advertises an affordance
 * that isn't there. There is also a mechanical reason: tailwind-merge collapses
 * transition utilities, so the 17 callers that pass `transition-colors` would
 * strip the base transition and snap between lift states instead of animating.
 * Opt-in means those callers never hit it.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      data-card=""
      className={cn(
        "rounded-xl border border-border bg-surface bg-[image:var(--smoke)]",
        "shadow-elev inset-shadow-sheen",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-elev-hi motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b border-border px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
