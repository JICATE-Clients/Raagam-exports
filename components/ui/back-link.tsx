"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
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
 * - **`md` (`h-9`), via `buttonClasses`.** "The header row (STANDING)" in
 *   AGENTS.md names a `← Back` link explicitly as one of the controls that must
 *   match the search box beside it, and `buttonClasses` is the existing way an
 *   `<a>` looks like a `<button>` without restating the list (`RowActions`'s
 *   `editHref` is the other caller). Nesting a `<button>` in an `<a>` is invalid
 *   HTML and puts two stops in the Tab path for one control.
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
      // `toolbar-size: exempt -- buttonClasses({size:"md"}) IS h-9; the check
      // reads a `size` prop and there is no Button element here to carry one.`
      className={buttonClasses({ variant: "outline", size: "md" })}
      onClick={(e) => {
        if (!confirmDiscard()) e.preventDefault();
      }}
    >
      ← Back to {to.label}
    </Link>
  );
}
