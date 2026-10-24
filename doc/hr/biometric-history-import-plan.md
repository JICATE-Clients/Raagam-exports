# Importing attendance history from the client's PC software — PLAN ONLY

Not built. Written 2026-10-23, before the uFace 302 is connected, because the
re-fetch path (`refetch_device_history`, 0735) only works for punches the
**device still holds** — and that is the thing we cannot assume.

## Why this is needed at all

`refetch_device_history()` asks the reader to offer its stored punches again.
It cannot conjure punches the reader no longer has. A uFace 302's log is
finite and the client's existing workflow has been collecting data for years
by PC software or USB, which typically **clears the device as it collects**.

So there are two sources of history and they are not interchangeable:

| Source | Mechanism | Trust |
|---|---|---|
| Still on the device | `refetch_device_history()` — built, 0735 | The device's own record |
| Already pulled off it | This import | Someone else's file |

## THE FIRST QUESTION DECIDES EVERYTHING: raw punches, or conclusions?

Before any code, get a **sample export file** from the client and look at what
it actually contains. There are two completely different shapes, and the
difference is not cosmetic.

**(a) A raw punch log** — one row per punch: user id, date, time, maybe a
device id and a verify mode. This is evidence, the same kind of thing the
device sends. It can go straight into `punches` and everything downstream
behaves identically to a live punch.

**(b) A computed attendance report** — one row per person per day: in time,
out time, hours, late, status. This is **somebody else's conclusion**, reached
with shift rules we have never seen and corrections nobody recorded.

**If only (b) exists, do not fabricate punches from it.** Turning "09:05 /
18:10, present" back into two punch rows invents two facts the device never
reported, and they would then be indistinguishable from real ones forever.
That is the same rule `created_by` already follows in this repo: inventing a
value in an audit column is a lie, not a convenience. Shape (b) belongs in
whatever table holds decided attendance — `worker_attendance`, once Track B
has settled how punches feed it — carrying its own provenance, never in
`punches`.

## If it is (a): the shape of the work

**1. A provenance column on `punches`, added first.** `source text not null
default 'device'`, with `'import'` for these rows and the file name kept
somewhere. Without it, an imported row and a device row are the same row, and
the question "where did this come from?" has no answer a year later when it is
being argued about. This is the one schema change the import needs.

**2. A dedicated importer, not `lib/data-io`.** That module describes **master**
entities only (AGENTS.md, "CAPITALS"), and punches are not a master. A
spreadsheet import that writes straight to Postgres also bypasses every check
the route applies, which is exactly why it needs its own narrow path.

**3. Idempotency is already solved for shape (a).** The unique key on
`(device_sn, user_id, punch_time)` means a re-import, an overlapping date
range, or the same file twice all collapse to the same rows. Use the real
serial as `device_sn` where the export names it; otherwise one agreed value
per file so a bad import can be identified and removed.

**4. Dry run, then commit — and the dry run is the deliverable.** Parse, then
report before writing anything: row count, date range, how many user ids match
a `workers`/`staff` `biometric_id`, how many do not, and how many already
exist. An import whose unmatched count is 300 is a mapping problem, not an
import to run.

**5. Unmatched ids are kept, never dropped.** Same rule as the live path: a
punch from an unmapped id is still the fact that somebody stood at the gate.
It links itself later when the person's `biometric_id` is filled in.

**6. `accept_from` does not apply.** It guards what a *device* may volunteer.
An import is someone explicitly asking for a date range, so the range in the
request is the range.

## What to confirm with the client before building

- A **sample export file** — the real thing, not a description. Shape (a) or (b)?
- Which software produced it, and whether it can export **raw punches** at all
  (most eSSL/ZKTeco tools can; it is often a different menu from the report)
- How far back it goes, and whether the device was cleared as data was collected
- Whether the user ids in the file are the same ids enrolled on the device today
  — a re-enrolment would have renumbered people, and then the file's ids mean
  nothing without a mapping table

## Order of work

This sits **after** Track B, not before. Importing history is only useful once
punches feed `worker_attendance`, and the shift rules that history would be
judged against are among the answers still outstanding from the client. Doing
it first would load months of punches that nothing can interpret.
