import Link from "next/link";
import { Tag, ArrowUpRight, ChevronRight, LayoutGrid, Unplug } from "lucide-react";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * One clickable tile in a hub grid — the Master Data hubs and, since the hub
 * unification, every sub-module hub in the app (`components/shell/group-hub.tsx`).
 *
 * Four states, and the point of them is that a card must SAY which kind of
 * destination it is before it is clicked:
 *
 *   - a screen with records — solid border, the count on the right;
 *   - a screen with none — the same, with a dimmed `0` and a title saying so.
 *     `0` and `5` used to render in one colour, so an empty master looked like
 *     any other card and the operator learned it was empty by opening it;
 *   - not built (`dashed`) — muted glyph, and the caller passes "Not set up yet"
 *     as the subtitle. NO count: a `0` beside a screen that does not exist reads
 *     as an empty table someone could fill;
 *   - `hub` — this card opens ANOTHER card grid. It gets a grid glyph, a
 *     chevron, and its number reads "N screens" rather than a bare figure, so it
 *     cannot be mistaken for a card that leads to work. `/orders/garment-orders`
 *     has one ("Amendments" → `/orders/changes`) and it rendered exactly like
 *     its nine siblings, promising a screen and delivering another list;
 *   - `unavailable` — the screen is BUILT and its table is not in this database.
 *     Greyed rather than dashed, because dashed already means "not built" and
 *     these two must not read as the same thing: one is work nobody has started,
 *     the other is work already done that cannot run here. Muted title, unplug
 *     glyph, no count, and the caller passes the reason as the subtitle.
 *
 * `external` (↗) is a fifth thing and stands apart from all of them: it means
 * the card leaves the MODULE. It is not the "opens another list" glyph — a hub
 * inside the same module is `hub`, not `external`.
 *
 * ## A card with no `href` is not a link
 *
 * `href` may be null, and the tile then renders as an inert `<div>` — same
 * shape, no hover, not in the tab order. That is for the sub-module hubs, where
 * `status: "todo"` means THE ROUTE IS NOT BUILT (assertion 10 checks both
 * directions of that), so a `<Link>` would be a tile whose only behaviour is a
 * 404.
 *
 * It is deliberately NOT keyed off `dashed`, because the two are unrelated in
 * the older half of the app: Master Data's `todo` children are dashed and DO
 * navigate — they fall through the generic `/masters/[submodule]/[entity]`
 * resolver onto a real placeholder screen. Tying "inert" to `dashed` would
 * silently kill those links. The caller says which of the two it means.
 */
export function HubCard({
  href,
  title,
  subtitle,
  count,
  external = false,
  dashed = false,
  hub = false,
  unavailable = false,
}: {
  /** Where the tile goes. `null` renders an inert tile — there is nowhere. */
  href?: string | null;
  title: string;
  subtitle: string;
  /** Records behind the card, or screens behind it when `hub`. `null` /
   *  `undefined` means unknown, and renders nothing — never a `0`. */
  count?: number | null;
  external?: boolean;
  dashed?: boolean;
  hub?: boolean;
  /** Built, but its table is not in this database. Greyed, never dashed. */
  unavailable?: boolean;
}) {
  const empty = !dashed && !external && !hub && !unavailable && count === 0;
  const muted = dashed || unavailable;

  const body = (
    <>
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
          muted ? "bg-surface-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {unavailable ? (
          <Unplug className="h-[18px] w-[18px]" />
        ) : hub ? (
          <LayoutGrid className="h-[18px] w-[18px]" />
        ) : (
          <Tag className="h-[18px] w-[18px]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-semibold",
            // The title greys too, and only here. A dashed card still reads at
            // full strength because it is a real plan; an unavailable one is
            // inert today and must look it at a glance, not on inspection.
            unavailable ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {title}
        </span>
        <Truncated text={subtitle} className="mt-0.5 text-xs text-muted-foreground" />
      </span>
      {external ? (
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : hub ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
          {count != null && <span className="tabular-nums">{count} screens</span>}
          <ChevronRight className="h-4 w-4" />
        </span>
      ) : count != null ? (
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            empty ? "text-muted-foreground/60" : "text-muted-foreground",
          )}
          title={empty ? "No records yet — click to add" : `${count} records`}
        >
          {count}
        </span>
      ) : null}
    </>
  );

  const shape = cn(
    "flex items-center gap-3 rounded-xl border p-4",
    dashed ? "border-dashed border-border" : "border-border",
    // Sits back from the working cards around it without going dashed — the two
    // states must stay tellable apart in one glance across a 20-card grid.
    unavailable ? "bg-surface-muted/40" : "bg-surface",
  );

  if (!href) return <div className={cn(shape, "cursor-default")}>{body}</div>;

  return (
    <Link href={href} className={cn("group transition-colors hover:border-primary", shape)}>
      {body}
    </Link>
  );
}
