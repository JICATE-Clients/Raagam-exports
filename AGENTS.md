<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project conventions

## Auto-reload guard (STANDING)

A new deploy reloads the user's tab **automatically and silently** — no banner, no
button (`components/pwa/silent-updater.tsx`). The only thing stopping that reload from
destroying half-typed work is `lib/reload-guard.ts`, so every screen must declare itself:

- Any screen holding editable local state → `useUnsavedGuard(dirty || isPending)`.
  Include `isPending`: a reload landing mid-server-action loses the success toast and
  leaves the user unsure whether the save committed.
- Any hand-rolled overlay (a `fixed inset-0` div rather than `Sheet` / `MasterFullScreen`)
  → `useModalGuard(open)`. The guard's DOM scan only sees `role="dialog"` /
  `aria-modal`, so a bare div is invisible to it.

`Sheet`, `MasterFullScreen`, `SimpleMasterScreen` and `useFormDraft` already register,
so anything built on those is covered without doing anything.

## CAPITALS (STANDING)

Field **values** are stored in capitals — stored, not merely displayed. Two halves, both
required: `<Input uppercase>` uppercases the keystroke *and* adds a CSS transform that
fixes rows saved before the rule (a value loaded from the DB and never re-typed cannot be
reached by a keystroke handler).

The write-side transform belongs in the **Zod schema** — `capsName()` / `capsTextNullable()`
in `lib/validation/formats.ts` — never only in the server action. `lib/data-io` parses
imports with the same `*Input` schemas and writes straight to Postgres, so an action-level
`.toUpperCase()` silently misses every spreadsheet import.

Exempt by construction, not by oversight: email and website, digit formats, `<Textarea>`
free text, passwords, uuids, read-only `(auto)` fields, search boxes, and workflow status
keys. Full rules and reasoning in `doc/ui/LAYOUT.md` §11; checked by
`python scripts/audit_layout.py . --check caps-input`.

## Dates (STANDING)

**DD/MM/YYYY.** `fmtDate` / `fmtDateTime` in `lib/format.ts` own it — never format a date at
a call site, and never reach for `toLocaleDateString`.

Two things that look like dates and must NOT be reformatted: `lib/dashboard/range.ts`
`today()` returns `YYYY-MM-DD` because it is **compared against `date` columns and fed back
into queries** (reformatting it breaks every dashboard range silently — the strings still
compare, just wrongly), and chart axis labels stay short (`Jul 26`).

`<input type="date">` renders in the **browser's** locale and cannot be overridden from the
page — its `value` is always ISO. Pickers follow the machine until someone builds a masked
date component. `doc/ui/LAYOUT.md` §12.
