"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { backTarget, type BackTarget } from "@/lib/nav/back-target";
import { confirmDiscard } from "@/lib/reload-guard";

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
export function BackLink({ target }: { target?: BackTarget }) {
  const pathname = usePathname();
  const to = target ?? backTarget(pathname ?? "");
  if (!to) return null;
  return (
    <Link
      href={to.href}
      // `toolbar-size: exempt -- a text link on the row's h-9 line; the check
      // reads a `size` prop and there is no Button element here to carry one.`
      className="inline-flex h-9 items-center gap-1 rounded-control px-1 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Back to ${to.label}`}
      onClick={(e) => {
        if (!confirmDiscard()) e.preventDefault();
      }}
    >
      ← {to.label}
    </Link>
  );
}
