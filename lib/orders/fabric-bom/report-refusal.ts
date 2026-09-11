/**
 * The one shared shape for "this report/section has no answer, and here is
 * why" — split out of `reports.ts` on purpose.
 *
 * `reports.ts` is `"server-only"` and pulls in `next/headers` (via
 * `createClient`) through its own import chain. A CLIENT component that needs
 * to read `{ refused }` off the data it fetched — `fabric-bom-reports-sheet.tsx`,
 * and `reports-export.ts` beneath it — can safely `import type` everything
 * else from `reports.ts`, but `isReportRefusal` is a real VALUE, and a bundler
 * cannot tree-shake a file's own top-level `import "server-only"` /
 * `next/headers` chain out from under a value it is told to include. Pulling
 * this one function (and its type) into a file with NO other imports at all
 * is what keeps the Fabric BOM Reports Sheet a client component without
 * dragging Supabase's server client into the browser bundle.
 */
export type ReportRefusal = { refused: string };

export const isReportRefusal = (v: unknown): v is ReportRefusal =>
  typeof v === "object" && v !== null && typeof (v as ReportRefusal).refused === "string";
