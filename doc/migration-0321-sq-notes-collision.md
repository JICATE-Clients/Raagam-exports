# Migration 0321 — `sq_notes` table collision (SKIPPED on apply)

**Status:** 🔴 Escalated for senior review — 2026-07-18

## What happened

Migration `0321_sq_detail.sql` (new Sales module — "SQ Detail") defines these tables: `sq_details`,
`sq_packs`, `sq_quantities`, `sq_qty_combos`, `sq_qty_sizes`, `sq_groups`, `sq_group_members`,
`sq_notes`, `sq_cancellations`.

When applying it to Supabase, **`sq_notes` failed** with:

```
ERROR: 42710: trigger "trg_sq_note_code" for relation "sq_notes" already exists
```

## Root cause

`public.sq_notes` already exists in the database from an earlier, **unrelated** migration —
`0025_planning_sq_notes.sql` (+ `0277_planning_sq_closure.sql`). That table belongs to the Planning
module: it's tied to `sales_order_id`/`buyer_id`, and carries `closed_at`/`closed_by`/`closure_reason`
columns. It's still actively read/written by:
- `lib/planning/extras-actions.ts`
- `lib/planning/extras-service.ts`

The new Sales-module `0321` migration independently created its **own**, differently-shaped `sq_notes`
table — free-text notes per SQ Detail, tied to `sq_detail_id` — with no awareness of the existing one.

This is a **cross-lane table-name collision**: two independently-developed features both picked the name
`sq_notes` for unrelated purposes. It's the same class of bug as the earlier `0306`/`0307`/`0315`
migration-number collisions already fixed in this repo's git history (see commits
`74e5a2b`, `f29be18`, `5e1b868`).

## What was actually applied

Everything in `0321` **except** the colliding parts — the `sq_notes` table itself, its trigger
(`trg_sq_note_code`), and its RLS policies were removed from the SQL before sending it to Supabase, so
the rest of the migration (all other SQ Detail tables) could apply cleanly.

**The migration file on disk was NOT edited** — `supabase/migrations/0321_sq_detail.sql` still contains
the original `sq_notes` block as pulled from git. Only the copy of the SQL actually executed against the
live database was trimmed.

## What's still broken

`lib/sales/sq-service.ts` and `lib/sales/sq-actions.ts` (new Sales code, already merged into `master`)
expect a `sq_notes` table shaped for SQ Detail notes. That table does not exist in the database — only
the unrelated Planning-shaped one does. Any Notes-related functionality on the SQ Detail screen will
error until this is resolved.

## Needs a decision

Rename the Sales-module table (e.g. to `sq_detail_notes`) inside `0321_sq_detail.sql`, and update the
three referencing files (`lib/sales/sq-service.ts`, `lib/sales/sq-actions.ts`, and wherever
`sq-types.ts` names it) to match — then re-apply just that piece. Or some other reconciliation the team
prefers.

Left unresolved on purpose — flagging for review rather than guessing at the fix.
