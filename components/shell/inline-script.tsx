"use client";

/**
 * A pre-paint inline `<script>` that React does not warn about.
 *
 * `"use client"` IS WHAT MAKES THE TYPE SWITCH WORK. Without it this was a
 * Server Component: `typeof window` was read on the server only, so the props
 * reached the browser as `text/javascript`, and whenever React CREATED the
 * element on the client (re-rendering the root after a hydration mismatch, or
 * `global-error`) it logged "Encountered a script tag…" (2026-10-14). As a
 * Client Component the browser evaluates the check itself and gets
 * `text/plain`, which React's `isScriptDataBlock` exempts from the warning.
 *
 * React 19 logs "Encountered a script tag while rendering React component"
 * whenever a render on the CLIENT produces a `<script>` — it would never run
 * there. The root layout's theme / type-scale / appearance scripts only ever
 * need to run once, from the server HTML, during parsing and before first
 * paint (the no-flash reason recorded in `app/layout.tsx`). So the server
 * emits a real script and the client renders the same element as inert
 * `text/plain`; `suppressHydrationWarning` absorbs the one attribute that
 * differs. This is the helper Next 16's own guide prescribes
 * (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md).
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
