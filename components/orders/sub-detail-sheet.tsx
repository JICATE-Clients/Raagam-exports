"use client";

/**
 * A `[Click]`-opened sub-detail Sheet — the shape AGENTS.md's "A sub-detail
 * Sheet's size" (STANDING) describes, made the DEFAULT rather than something
 * every new screen has to remember.
 *
 * ## WHY THIS EXISTS RATHER THAN A RULE IN A DOCUMENT
 *
 * The rule was written down once, on 2026-09-03, after Fabric BOM's
 * Components and Widths popups both shipped `size="lg"`/`"md"` when they
 * should have been `"sm"`. It was then re-applied BY HAND to three more
 * screens the next day — Pack Composition, Material BOM's Combination, and
 * Fabric BOM's Yarn Dyed Details — and every one of those three needed the
 * same four lines rewritten: `size`, `alignToPane`, an `origin` prop threaded
 * through from the caller, and a state + `onClick` at the trigger button to
 * capture `getBoundingClientRect()`. A rule that has to be re-typed by hand
 * on every new screen is a rule that will be forgotten on the next one — the
 * same lesson `AGENTS.md`'s CAPITALS section and `Truncated`'s reveal both
 * record: put the fix in the PRIMITIVE, not in a document a future screen has
 * no reason to open.
 *
 * `Sheet` ITSELF IS NOT CHANGED, deliberately. `size="lg"` is `Sheet`'s own
 * correct default for the ~45 master editors that use it as a full-screen
 * entity form — flipping that default would fix every sub-detail popup in
 * this app and break every one of those in the same commit. `SubDetailSheet`
 * is a second, narrower surface for the second, narrower shape: a popup
 * opened from a `[Click]` inside an ALREADY-OPEN editor, that edits rows
 * living in that editor's own state and has no Save of its own.
 *
 * ## `grid`
 *
 * Defaults `size="sm"` (448px). Pass `grid` when the content is a
 * `ChildGrid` — `sm`'s ~408px is below `ChildGrid`'s own responsive
 * breakpoint (~512px) and drops it to stacked cards with no column headers,
 * the defect Style ▸ Process's own history records from 2026-08-12. There is
 * no third size: a sub-detail that needs more than `md` (1152px) is not this
 * shape of screen — see Structure Details / Assortments in
 * `garment-order-screen.tsx`, which stay on bare `Sheet` with `fullBleed` for
 * exactly that reason, on an explicit client width request each time.
 *
 * ## `footer`
 *
 * Defaults to `SubSheetFooter` — the sheet has no Save of its own, and
 * fields-then-nothing-but-an-✕ is the exact "missing save button" complaint
 * the client filed once already (2026-08-14, on Style ▸ Process). Pass an
 * explicit `footer` to override it, or `footer={null}` for the rare popup
 * that genuinely does save independently (none exist in this app today).
 *
 * ## Pairs with `useSubSheetOrigin`, below in this same file
 *
 * `origin` makes the sheet grow out of the button that opened it rather than
 * fading in at the pane's centre. Capturing it is three lines of
 * boilerplate — a `useState<DOMRect | null>`, and an `onClick` that calls
 * `getBoundingClientRect()` before the state setter that opens the sheet —
 * repeated by hand five times across three files in one day. The hook is
 * that boilerplate, written once.
 */

import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";

export function SubDetailSheet({
  open,
  onClose,
  title,
  children,
  origin,
  /** `size="md"` instead of the default `"sm"` — pass this when `children`
   *  contains a `ChildGrid`. See the file header for why there is no third
   *  option. */
  grid = false,
  /** What the operator must save to keep this — passed straight through to
   *  `SubSheetFooter`, which needs it for the same reason: "the parent" is
   *  not a thing they can see from inside an overlay. Ignored if `footer` is
   *  passed explicitly. */
  parent = "garment order",
  /** Why Done cannot finish here — passed straight through to
   *  `SubSheetFooter`. Ignored if `footer` is passed explicitly. */
  blockedReason,
  onBlocked,
  /** Override the default `SubSheetFooter` entirely. Pass `null` for a
   *  sub-detail that genuinely has no footer to show (none do today — this
   *  exists so the option is not a dead end when one eventually does). */
  footer,
  headerActions,
  zIndexBase,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  origin?: SheetOrigin | null;
  grid?: boolean;
  parent?: string;
  blockedReason?: string | null;
  onBlocked?: (reason: string) => void;
  footer?: ReactNode | null;
  headerActions?: ReactNode;
  zIndexBase?: number;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size={grid ? "md" : "sm"}
      alignToPane
      origin={origin}
      headerActions={headerActions}
      zIndexBase={zIndexBase}
      footer={
        footer === null ? undefined : (
          (footer ?? (
            <SubSheetFooter
              onDone={onClose}
              parent={parent}
              blockedReason={blockedReason}
              onBlocked={onBlocked}
            />
          ))
        )
      }
    >
      {children}
    </Sheet>
  );
}

/**
 * The other half of `SubDetailSheet` — capturing WHICH button opened it.
 *
 * `capture` wraps the thunk that actually opens the sheet (setting whatever
 * key/id state the caller uses), so the call site stays one line:
 *
 *     const [origin, captureOrigin] = useSubSheetOrigin();
 *     <Button onClick={captureOrigin(() => setComponentsFor(e.key))}>Click</Button>
 *     <SubDetailSheet open={...} origin={origin} ...>
 *
 * `currentTarget`, NEVER `target` — the click can land on a text node or icon
 * inside the button, and `target` would then capture THAT element's rect
 * instead of the button's own.
 */
export function useSubSheetOrigin() {
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const capture = useCallback(
    (onOpen: () => void) => (ev: React.MouseEvent<HTMLElement>) => {
      setOrigin(ev.currentTarget.getBoundingClientRect());
      onOpen();
    },
    [],
  );
  return [origin, capture] as const;
}
