import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * HR & PAYROLL WEARS THE RAAGAM SKIN — the third module to, after Orders
 * (`app/(app)/orders/layout.tsx`, which carries the full reasoning) and Master
 * Data (`app/(app)/masters/layout.tsx`).
 *
 * It is deliberately the SAME ONE LINE, not anything HR-specific. The skin is
 * `[data-skin="raagam"]` in `app/globals.css`, keyed entirely on PRIMITIVES
 * (`[data-card]`, `[role="tab"]`, `input`, `label.block`, `[data-grid-card]`,
 * `[data-md-list-item]`) — nothing in it names a screen or a module, which is
 * why extending it costs a file rather than a sweep.
 *
 * WHY IT WAS NEEDED HERE. The new Staff editor is the same `MasterFullScreen`
 * rail that Orders ▸ Order Entry uses, built from the same primitives — and it
 * still came up grey beside a green-and-blue Orders screen, because the skin
 * reaches a subtree only through one of these layouts (client 2026-09-07: "the
 * ui is not like actual skill ... this is the exact ui i want which is in order
 * module"). The structure was already right; the module simply had nothing
 * turning the skin on.
 *
 * IT IS A PROVIDER, NOT A WRAPPER, and on this module that is load-bearing:
 * every HR record edits in a `Sheet` or a `MasterFullScreen` overlay, and both
 * `createPortal` to `document.body` — OUTSIDE this wrapper in the DOM however
 * deep inside it they sit in the render tree. `SkinProvider` also puts the name
 * on React context, the one thing that crosses a portal, and those surfaces
 * re-stamp `data-skin` from it. A bare `<div data-skin="raagam">` would skin the
 * list behind the editor and leave the editor itself grey.
 *
 * TO REVERT: delete this file. Every HR screen returns to the app's default
 * styling in one step, because nothing under `app/(app)/hr` names the skin.
 */
export default function HrSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
