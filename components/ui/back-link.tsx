"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { backTarget, type BackTarget } from "@/lib/nav/back-target";
import { confirmDiscard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";

/**
 * "← Back to <the screen above this one>".
 *
 * ONE affordance for every child listing screen in the app, rendered by
 * `PageHeader` so a screen gets it without doing anything — see
 * `lib/nav/back-target.ts` for which routes get one and why the other four
 * kinds deliberately do not.
 *
 * Three things that are not cosmetic:
 *
 * - **A LINK, NOT A BUTTON (user 2026-10-09, button plan Rule 4).** It moves
 *   the operator around the app; it acts on no record. Drawn as an outline
 *   button it stood in the same row as "New Garment Order" and read as one
 *   more action to weigh, on ~110 list pages at once. It keeps the row's 36px
 *   line (`h-9`, "The header row") so it centres on the buttons beside it, but
 *   is primary-coloured text with no box. The label drops "Back to" — the ←
 *   already says it — and the full sentence stays in `aria-label`.
 *
 * - **It asks before discarding.** A `<Link>` out of a half-filled editor loses
 *   the work silently, and `confirmDiscard()` is the question Escape already
 *   asks — so this reuses it rather than inventing a second policy. It is a
 *   no-op on a listing, where nothing has registered `useUnsavedGuard`.
 *
 * - **It is NOT a field**, so it is not on the Tab path of an editor: the
 *   enclosing `PageHeader` is stamped `data-focus-region="header"`, which sorts
 *   every action in it as chrome. On a list page there is no focus scope at all
 *   and native tab order is kept, deliberately — see "Tab lands on fields".
 *
 * Renders NOTHING when there is no parent to name. That is what makes it safe
 * to mount unconditionally: a module root, a hub page, a document detail route
 * and every screen outside the nav registry all resolve to `null`.
 */
const BACK_CLASS =
  "inline-flex h-9 shrink-0 items-center gap-1 rounded-control px-1 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * `onBack` IS THE SAME LINK FOR AN EDITOR THAT LIVES ON ITS LIST'S URL (user
 * 2026-10-14, Sample module: "add clear Back buttons … check our existing back
 * UI and use"). Sample Entry and Costing swap list and editor in local state,
 * so there is no href to go to — the way back is the screen's own close. It
 * reads and behaves exactly like the link (same words, same discard question),
 * so a Sample editor's Back and an Orders list's Back are one affordance.
 */
export function BackLink({
  target,
  onBack,
  label,
  className,
}: {
  target?: BackTarget;
  onBack?: () => void;
  /** With `onBack`: what the operator goes back to ("Sample Entry"). */
  label?: string;
  className?: string;
}) {
  const pathname = usePathname();
  if (onBack) {
    const to = label ?? "list";
    return (
      <button
        type="button"
        tabIndex={-1}
        className={cn(BACK_CLASS, className)}
        aria-label={`Back to ${to}`}
        onClick={() => {
          if (confirmDiscard()) onBack();
        }}
      >
        ← {to}
      </button>
    );
  }
  const to = target ?? backTarget(pathname ?? "");
  if (!to) return null;
  return (
    <Link
      href={to.href}
      // `toolbar-size: exempt -- a text link on the row's h-9 line; the check
      // reads a `size` prop and there is no Button element here to carry one.`
      className={cn(BACK_CLASS, className)}
      aria-label={`Back to ${to.label}`}
      onClick={(e) => {
        if (!confirmDiscard()) e.preventDefault();
      }}
    >
      ← {to.label}
    </Link>
  );
}
