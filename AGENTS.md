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
