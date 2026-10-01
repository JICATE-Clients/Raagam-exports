/**
 * A pre-paint inline `<script>` that React does not warn about.
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
