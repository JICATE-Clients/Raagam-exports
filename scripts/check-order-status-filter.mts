/**
 * THE BUTTON AND THE WHERE MUST AGREE — Order Entry's Pending / Updated / Draft.
 *
 * Since 2026-09-24 the word is applied TWICE in two languages: `getAmendments`
 * turns it into SQL (`ORDER_QUICK_WHERE`) so the database returns one word's
 * worth, and `orderQuickWord` says which word a row in hand counts as — read by
 * the counts, by the label on the counter and by anything downstream that has a
 * row rather than a query. Two statements of one rule is exactly the shape this
 * repo keeps getting bitten by, and here the disagreement would be SILENT: a
 * mismatched WHERE returns a shorter list, not an error, and a list that is
 * merely shorter than it should be looks like a business with fewer orders.
 *
 * So this replays them against each other over the WHOLE state space — every
 * `is_draft` × every `approval_status` the 0129 check constraint allows, plus
 * the NULL the column is declared against but which a future migration could
 * let through. Three assertions:
 *
 *   1. EVERY row matches at least one word's WHERE — nothing is invisible to
 *      all three, which would be a row no filter could ever show.
 *   2. EVERY row matches at most one — nothing is in two piles at once. This is
 *      the Budgeting bug of the same morning ("budgeting la draft datas lam
 *      updated la kaatuthu"), asserted so it cannot recur here.
 *   3. The word a row matches BY QUERY is the word `orderQuickWord` gives it.
 *
 * Verified by being made to FAIL first: `updated` was temporarily written as
 * `{ is_draft: false }` — the Budgeting bug transplanted — and assertion 2
 * named `pending` and `updated` as overlapping on every undecided order.
 */
import { readdirSync, readFileSync } from "node:fs";
import {
  ORDER_QUICK_WHERE,
  ORDER_QUICK_WORDS,
  orderQuickWord,
  parseOrderQuickWord,
  type OrderQuickWord,
} from "../lib/orders/amendments/types.ts";

type Row = { is_draft: boolean; approval_status: string };

/** What PostgREST would do with the clause: `.eq` then `.in`. */
function whereMatches(w: OrderQuickWord, r: Row): boolean {
  const c = ORDER_QUICK_WHERE[w];
  if (r.is_draft !== c.is_draft) return false;
  if (c.approval_status && !c.approval_status.includes(r.approval_status)) return false;
  return true;
}

/**
 * THE STATE SPACE IS THE DATABASE'S, READ FROM THE MIGRATIONS — not a list
 * retyped here.
 *
 * `orderQuickWord` reads "not pending" as Updated while the WHERE names
 * `approved` and `rejected`, and the two agree for exactly as long as those
 * are the only other values. That is true today — 0129 declares
 * `approval_status text not null default 'pending' check (… in ('pending',
 * 'approved','rejected'))` — and it is a migration away from not being. A
 * fourth value would be swept into Updated by the row function and returned by
 * NO query, so it would vanish from the list while the count said it was
 * there.
 *
 * So the space is scraped from every migration that constrains THIS table's
 * column, and a value the code does not know fails the run. `neq('pending')`
 * would dodge the whole question and is not the answer: the column could also
 * be made nullable, and NULL passes no `neq` in Postgres — a decided-or-not
 * order would then be in neither pile, which is assertion 1 below.
 */
function declaredStatuses(): string[] {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const found = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    for (const m of sql.matchAll(/approval_status\s+in\s*\(([^)]*)\)/gi)) {
      /* Scoped to this table: the same column name is on `contract_reviews`
         (0327, with 'revision') and `purchase_indents` (0362, with 'partial'),
         and folding their vocabularies in here would assert nothing. */
      const before = sql.slice(Math.max(0, m.index - 1200), m.index);
      if (!before.includes("garment_order_amendments")) continue;
      for (const v of m[1].split(",")) found.add(v.trim().replace(/^'|'$/g, ""));
    }
  }
  if (found.size === 0) {
    console.error("check:order-status-filter — found no CHECK on garment_order_amendments.approval_status; the scraper has gone stale.");
    process.exit(1);
  }
  return [...found];
}

const STATUSES = declaredStatuses();
const rows: Row[] = STATUSES.flatMap((approval_status) => [
  { is_draft: true, approval_status },
  { is_draft: false, approval_status },
]);

/**
 * THE THIRD READER: the `CASE` inside `garment_order_status_counts()` (0624).
 *
 * The figures on the box come from that function, the rows come from
 * `ORDER_QUICK_WHERE`, and `orderQuickWord` labels a row in hand. If the SQL
 * and the TS disagree the box says one thing and the list shows another —
 * "Draft 4" over an empty Draft list — and nothing errors, because both halves
 * ran fine. Parsed rather than eyeballed, so the migration cannot drift.
 */
function sqlWordOf(): (r: Row) => string {
  const file = new URL("../supabase/migrations/0624_order_status_counts.sql", import.meta.url);
  const sql = readFileSync(file, "utf8");
  const body = sql.match(/case([\s\S]*?)end as status/i);
  if (!body) {
    console.error("check:order-status-filter — no `case … end as status` in 0624; the counting function has been rewritten and this parser has not.");
    process.exit(1);
  }
  const branches: { test: (r: Row) => boolean; word: string }[] = [];
  for (const m of body[1].matchAll(/when\s+([\s\S]*?)\s+then\s+'([a-z]+)'/gi)) {
    const [, cond, word] = m;
    const eq = cond.match(/approval_status\s*=\s*'([^']+)'/i);
    if (/^is_draft$/i.test(cond.trim())) branches.push({ test: (r) => r.is_draft, word });
    else if (eq) branches.push({ test: (r) => r.approval_status === eq[1], word });
    else {
      console.error(`check:order-status-filter — 0624 has a WHEN this parser cannot read: ${cond.trim()}`);
      process.exit(1);
    }
  }
  const fallback = body[1].match(/else\s+'([a-z]+)'/i);
  if (branches.length === 0 || !fallback) {
    console.error("check:order-status-filter — 0624's CASE has no WHEN branches or no ELSE.");
    process.exit(1);
  }
  return (r) => branches.find((b) => b.test(r))?.word ?? fallback[1];
}

const bySql = sqlWordOf();

const problems: string[] = [];

for (const r of rows) {
  const where = r.is_draft ? "draft" : `is_draft=false approval_status='${r.approval_status}'`;
  const hit = ORDER_QUICK_WORDS.filter((w) => whereMatches(w, r));

  if (hit.length === 0) {
    problems.push(`no word would return a row with ${where} — it is in no pile and no filter can show it`);
    continue;
  }
  if (hit.length > 1) {
    problems.push(`${hit.join(" and ")} would BOTH return a row with ${where} — one row, two piles`);
    continue;
  }
  /* `r.approval_status` is a scraped string; the row function takes the union
     the column is declared as. The cast is the assertion this whole script
     exists to make — that the scraped set and the declared union are the same
     three words — and `declaredStatuses` fails the run if the scrape is empty. */
  const byRow = orderQuickWord(r as Parameters<typeof orderQuickWord>[0]);
  if (byRow !== hit[0]) {
    problems.push(
      `a row with ${where} is returned by the '${hit[0]}' WHERE but orderQuickWord() calls it '${byRow}'`,
    );
  }
  const bySqlWord = bySql(r);
  if (bySqlWord !== hit[0]) {
    problems.push(
      `a row with ${where} is returned by the '${hit[0]}' WHERE but 0624's CASE counts it as '${bySqlWord}' — the figure on the box and the list beneath it would disagree`,
    );
  }
}

/* The param parser is the third reader of the same vocabulary — the page turns
   `?status=` into the word the WHERE is looked up by, so a word it refuses is a
   word the SQL can never be asked for. */
for (const w of ORDER_QUICK_WORDS) {
  if (parseOrderQuickWord(w) !== w) problems.push(`parseOrderQuickWord refuses '${w}', a real word`);
}
for (const bad of ["", "PENDING", "all", "approved", undefined]) {
  if (parseOrderQuickWord(bad as string | undefined) !== null) {
    problems.push(`parseOrderQuickWord accepts ${JSON.stringify(bad)}, which is not one of the three words`);
  }
}

if (problems.length > 0) {
  console.error("check:order-status-filter — the button and the WHERE disagree:\n");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `check:order-status-filter — approval_status ∈ {${STATUSES.join(", ")}} per the migrations; ` +
    `${rows.length} row shapes, each returned by exactly one of ${ORDER_QUICK_WORDS.join(" / ")}, ` +
    `and each agreeing across all three readers (orderQuickWord, ORDER_QUICK_WHERE, 0624's CASE).`,
);
