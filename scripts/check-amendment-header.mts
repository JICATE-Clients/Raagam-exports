/**
 * A CHILD ARRAY MUST NEVER REACH THE AMENDMENT HEADER.
 *
 *   node --experimental-strip-types scripts/check-amendment-header.mts
 *   npm run check:amendment-header
 *
 * `AmendmentInput` carries the document's header columns AND every child list on
 * one object. `createAmendment` / `updateAmendment` write the header with
 * `headerOnly(data)`, which strips the child arrays by destructuring them out —
 * a hand-maintained list that has to be extended every time the input grows.
 *
 * IT HAS FALLEN BEHIND TWICE. `style_sizes` and `style_processes` were both added
 * to the Zod input and to `writeChildren`'s insert table, and neither was added
 * here — so both rode the rest-spread into the header write and PostgREST
 * answered, on the very first save:
 *
 *   Could not find the 'style_processes' column of
 *   'garment_order_amendments' in the schema cache
 *
 * (client 2026-08-19, creating an order.)
 *
 * WHY TYPESCRIPT CANNOT CATCH IT. A rest spread carries any extra property
 * without complaint — `{ a, ...rest }` on a wider object is perfectly legal, and
 * `rest` simply gets more fields. Nothing goes red when the input grows, so the
 * failure surfaces at runtime, on a real save, in front of an operator.
 *
 * ADDING AN ARRAY TO `amendmentInput` IS THEREFORE THREE EDITS:
 *   1. the Zod field                        lib/orders/amendments/types.ts
 *   2. an entry in `writeChildren.inserts`  lib/orders/amendments/actions.ts
 *      (that table also drives the DELETE loop, so a missing entry orphans rows)
 *   3. a line in `headerOnly`               lib/orders/amendments/actions.ts
 *
 * This asserts 1 → 3 and 1 → 2. It is deliberately textual: the alternative is
 * importing the Zod schema and reflecting on it, which drags a server module and
 * its Supabase client into a build-time script for no extra certainty.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TYPES = join(ROOT, "lib/orders/amendments/types.ts");
const ACTIONS = join(ROOT, "lib/orders/amendments/actions.ts");

/** Top-level `name: z.array(...)` fields of the `amendmentInput` object. */
function inputArrays(src: string): string[] {
  const at = src.indexOf("export const amendmentInput");
  if (at === -1) throw new Error("amendmentInput not found in types.ts");
  // Two-space indent = a direct property of that object literal. A nested
  // array inside a child's own schema is indented further and is not ours.
  const body = src.slice(at, at + 12000);
  return [...body.matchAll(/^ {2}(\w+):\s*z\.array\(/gm)].map((m) => m[1]!).sort();
}

/** Keys `headerOnly` destructures away, e.g. `styles: _st,`. */
function strippedKeys(src: string): string[] {
  const from = src.indexOf("function headerOnly(");
  if (from === -1) throw new Error("headerOnly not found in actions.ts");
  const to = src.indexOf("export async function createAmendment", from);
  const body = src.slice(from, to === -1 ? from + 4000 : to);
  return [...body.matchAll(/^ {4}(\w+):\s*_/gm)].map((m) => m[1]!).sort();
}

/** Table names in `writeChildren`'s `inserts` table. */
function insertTables(src: string): string[] {
  const from = src.indexOf("const inserts:");
  if (from === -1) throw new Error("writeChildren inserts table not found");
  const body = src.slice(from, src.indexOf("];", from));
  return [...body.matchAll(/\["(\w+)",/g)].map((m) => m[1]!);
}

const types = readFileSync(TYPES, "utf8");
const actions = readFileSync(ACTIONS, "utf8");

const arrays = inputArrays(types);
const stripped = new Set(strippedKeys(actions));
const tables = insertTables(actions).join(" ");

const problems: string[] = [];

for (const name of arrays) {
  if (!stripped.has(name)) {
    problems.push(
      `  ${name}: on AmendmentInput but NOT stripped by headerOnly() — it will be ` +
        `sent to garment_order_amendments and PostgREST will reject the save.`,
    );
  }
  // The child table is conventionally `garment_order_amendment_<name>`; accept
  // any table whose name ends with the field, since a couple are pluralised
  // differently from their field (`dyeings` → `..._dyeings`).
  if (!tables.includes(name)) {
    problems.push(
      `  ${name}: on AmendmentInput but no entry in writeChildren's inserts table — ` +
        `its rows are never written, and the delete loop never clears them.`,
    );
  }
}

if (arrays.length === 0) {
  console.error("check:amendment-header FOUND NO ARRAYS — the parser is stale, not the code.");
  process.exit(2);
}

if (problems.length) {
  console.error(
    `check:amendment-header FAILED — ${problems.length} problem(s):\n${problems.join("\n")}\n\n` +
      `Adding an array to amendmentInput is three edits: the Zod field, an entry in\n` +
      `writeChildren's inserts table, and a line in headerOnly.`,
  );
  process.exit(1);
}

console.log(
  `check:amendment-header OK — ${arrays.length} child arrays, each stripped from the ` +
    `header and each written by writeChildren.`,
);
