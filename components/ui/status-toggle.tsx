"use client";

import { Toggle } from "@/components/ui/toggle";
import { StatusPill } from "@/components/ui/status-pill";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";

/**
 * THE STATUS CELL OF A MASTER LISTING — a switch and the word it is currently
 * set to, wired straight to the status API.
 *
 * One click switches the row on or off. No drawer, no form, no confirm: the
 * operator is not deciding anything they need to be asked twice about, and the
 * switch snaps back if the write fails because the listing re-reads from the
 * server (`useBlockAction().setStatus` refreshes).
 *
 * ## THE LABEL IS THE STATE HERE, AND THAT IS A DELIBERATE EXCEPTION
 *
 * `Toggle`'s own `label` prop documents the opposite rule — "the THING, not its
 * state; 'Pack', never 'Yes'" — because a STATIC "Yes" beside a switch that may
 * be off is exactly the shape that component was built to replace. That
 * reasoning does not reach this cell: the word here is not static. It reads
 * "Active" when the switch is on and "Inactive" when it is off, so it is a
 * second rendering of the state rather than a caption contradicting it.
 *
 * It is rendered beside the switch rather than passed as `label` so the two
 * rules cannot be confused by the next reader of `toggle.tsx`.
 *
 * ## GREEN IS NOT A DECORATION
 *
 * `tone="success"` is the same `--success` every Active status pill in this app
 * already uses (29 files). A status switch in brand blue would be the only
 * "this record is live" indicator in the app that is not green, which is a
 * worse outcome than the one extra tone on the primitive.
 *
 * ## IT READS THE FLAG THROUGH `isInactive`, NEVER `row.inactive`
 *
 * The schema spells the flag three ways and two of them are negated
 * (`lib/masters/inactive.ts`). Passing the ROW rather than a boolean is what
 * keeps that single reader in play: a listing over an `is_active` table gets the
 * right switch position without knowing which spelling it is on.
 *
 * `onChange` states the state POSITIVELY — true means the row should be ON —
 * matching `setMasterActive` and `activePatch`, so nothing on the path from this
 * switch to Postgres flips a boolean by hand.
 *
 * ## DRAFT IS THE THIRD STATE, AND IT IS NOT THE SWITCH'S
 *
 * `is_draft` is ORTHOGONAL to `inactive`: a draft record is live-or-blocked like
 * any other, it simply has not been completed. So it can never be a third
 * position on a two-position switch, and a master that has drafts (Consignee,
 * Employee, Vendor) would otherwise lose the word from its listing the moment
 * the pill became a switch.
 *
 * `draft` renders the same amber pill those three already drew by hand, AFTER
 * the switch, so the column still scans as a column of switches. It is a prop
 * rather than three call sites wrapping the switch in their own `<span>`,
 * because three hand-rolled spellings of one chip is how the Status cell drifted
 * in the first place — the header, the width, the switch and its colour are all
 * owned here for that reason.
 *
 * A screen with no draft state passes nothing and the cell is unchanged.
 */
export function StatusToggle({
  row,
  label,
  draft = false,
  onChange,
  disabled = false,
}: {
  /** The record. Read only for its status. */
  row: Deactivatable;
  /**
   * The record's name, for the accessible name ("Status of CHENNAI"). The
   * visible word beside the switch says Active / Inactive, which names the
   * STATE but not the row — in a table of forty switches a screen reader needs
   * to know which one it is on.
   */
  label?: string | null;
  /**
   * The record is saved as a draft. Adds the amber `Draft` pill beside the
   * switch — see the note above on why it cannot be a switch position.
   */
  draft?: boolean;
  onChange: (active: boolean) => void;
  /** No permission to change the status, or a write is already in flight. */
  disabled?: boolean;
}) {
  const active = !isInactive(row);

  return (
    <span className="inline-flex items-center gap-2">
      <Toggle
        checked={active}
        onChange={onChange}
        tone="success"
        disabled={disabled}
        ariaLabel={label ? `Status of ${label}` : "Status"}
        // `min-h-0` overrides the switch's own `min-h-9`, which exists to centre
        // it against the 36px control height of a FORM row. A table cell has no
        // such row to line up with, and the extra height would pad every row of
        // every listing that shows a status.
        className="min-h-0"
      />
      <span className={active ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>
        {active ? "Active" : "Inactive"}
      </span>
      {draft && <StatusPill tone="warning">Draft</StatusPill>}
    </span>
  );
}
