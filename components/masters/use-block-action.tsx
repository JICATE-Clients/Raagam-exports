"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { RowMenuItem } from "@/components/ui/row-actions";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";
import { setMasterActive } from "@/lib/masters/active-actions";

/**
 * THE BLOCK / UNBLOCK ROW ACTION — one implementation, forty listings.
 *
 * The client moved this out of the create/edit form on 2026-08-17: "we are used
 * to give that block while CREATING the data but we need to move this in ACTION
 * only, no more in the creating screen." The checkbox was hand-rolled on **40
 * screens** — `checked={form.inactive}` and its two cousins — which is the
 * fan-out AGENTS.md keeps recording: a contract-level behaviour copied per
 * screen becomes forty slightly different behaviours. So the replacement is a
 * hook, not another block of JSX to paste.
 *
 * ## IT GOES IN THE `⋮` MENU, WHICH ALREADY EXISTS FOR THIS
 *
 * `RowActions` documents `menu` as "extra actions behind a ⋮ — Duplicate,
 * Export row. Never Delete." Block is exactly that shape, so **`RowActions`
 * needed no change at all**. It is deliberately not a fourth icon beside
 * view/edit/delete: those three are on every row of every list in the app, and
 * widening that cluster for an action used occasionally would cost width on
 * every screen to save a click on a few.
 *
 * ## THE LABEL IS THE STATE, NOT THE VERB
 *
 * A blocked row offers "Unblock"; a live one offers "Block". One item, read off
 * `isInactive` — never two items with one disabled, which makes the operator
 * work out which of two controls applies to the row in front of them.
 *
 * ## IT READS THE FLAG THROUGH `isInactive`, NEVER `row.inactive`
 *
 * The schema spells it three ways and two of them are negated. `isInactive` is
 * the one reader (AGENTS.md, "Disabled rows"), so a listing over an `is_active`
 * table gets the right label without the screen knowing which spelling it is on.
 *
 * ## BLOCKING IS `danger`, UNBLOCKING IS NOT
 *
 * Switching a master off removes it from every picker in the app; switching it
 * back on restores an ordinary row. The tone follows the consequence.
 *
 * `router.refresh()` on success rather than local state: the server action has
 * already revalidated the listing's paths, and re-reading is what keeps the row
 * consistent with the Status column and the picker beside it.
 */
export function useBlockAction(entityKey: string) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  /**
   * Build the menu item for one row.
   *
   * `canBlock` is the screen's own permission gate — pass `perms.canDelete`,
   * since blocking is the destructive direction and the action gates it that
   * way server-side. Omitting the item entirely (rather than disabling it) is
   * the same choice `RowActions` makes for the pencil and the bin.
   */
  const blockItem = (
    row: { id: string } & Deactivatable,
    opts: { label?: string | null; canBlock?: boolean } = {},
  ): RowMenuItem[] => {
    if (opts.canBlock === false) return [];
    const off = isInactive(row);
    const name = opts.label ? ` ${opts.label}` : "";
    return [
      {
        label: off ? "Unblock" : "Block",
        icon: off ? RotateCcw : Ban,
        danger: !off,
        disabled: isPending,
        onClick: () =>
          startTransition(async () => {
            const res = await setMasterActive(entityKey, row.id, off);
            if (!res.ok) {
              toastError(res.error);
              return;
            }
            success(off ? `Unblocked${name}` : `Blocked${name}`);
            router.refresh();
          }),
      },
    ];
  };

  return { blockItem, isPending };
}
