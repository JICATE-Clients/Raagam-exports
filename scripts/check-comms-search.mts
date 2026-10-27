// Verification for Communication Hub SEARCH (0762; lib/comms/search.ts, the
// search half of service.ts, search-actions.ts; the Search page, deep links).
//
//     npm run check:comms-search
//
// The live half — what a member, an outsider and an anonymous caller actually
// get back — is the search end-to-end run. This file asserts what that cannot:
//
//   1. THE QUERY LANGUAGE on vectors: operators, quoting, Slack's after/before
//      meaning, bad dates reported, unknown syntax kept as words.
//   2. SAFE BY CONSTRUCTION — the SQL builds its query from words (never
//      tsquery or SQL syntax), runs AS THE CALLER, pages by keyset, cuts days
//      in IST; the cursor and every input are re-validated.
//   3. HIGHLIGHTING marks what matched, as text pieces — no HTML anywhere.
//   4. THE SCREENS — filters are URL parameters read by the server, results
//      open AT the message (and its thread), Saved links the same way.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDays,
  decodeSearchCursor,
  encodeSearchCursor,
  isDay,
  messageHref,
  parseQuery,
  searchInput,
  searchTerms,
  snippet,
} from "../lib/comms/search.ts";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`ok    ${msg}`);
  else {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
}
const root = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const sql = read("supabase/migrations/0762_comms_message_search.sql").replace(/--[^\n]*/g, "");
const fn = sql.match(/function public\.comm_search_messages[\s\S]*?\$\$;/)?.[0] ?? "";

// ---------- 1. the query language ----------

let p = parseQuery('budget from:alex in:#general has:file');
check(p.text === "budget" && p.from[0] === "alex" && p.in[0] === "general" && p.hasFile && p.problems.length === 0, "words and operators separate; # and @ are dropped from names");
p = parseQuery('from:"anbu selvan" quarterly planning');
check(p.from[0] === "anbu selvan" && p.text === "quarterly planning", "a quoted name keeps its space");
p = parseQuery("after:2026-01-01 before:2026-12-31 report");
check(p.fromDay === "2026-01-02" && p.toDay === "2026-12-30" && p.text === "report", "after/before EXCLUDE the day itself (Slack), as inclusive From/To days");
p = parseQuery("on:2026-03-15");
check(p.fromDay === "2026-03-15" && p.toDay === "2026-03-15", "on: is that day only");
p = parseQuery("after:2026-02-30 x");
check(p.problems.length === 1 && /not a date/.test(p.problems[0]) && p.fromDay === null, "an impossible date is reported, not guessed");
p = parseQuery("after:2026-05-10 before:2026-05-09");
check(p.problems.some((x) => /no days/.test(x)), "a range with no days in it is reported");
p = parseQuery("has:pdf is:pinned ratio:2 from:");
check(p.problems.length === 3 && p.text === "ratio:2", "unsupported has:/is: values and an empty from: are reported; unknown syntax stays as words");
p = parseQuery("is:thread FROM:Bala");
check(p.thread && p.from[0] === "Bala", "operators are case-insensitive");
check(parseQuery("info:x").text === "info:x" && parseQuery("xfrom:a").text === "xfrom:a", "only whole operator words are operators");
check(isDay("2024-02-29") && !isDay("2026-02-29") && !isDay("2026-1-1") && !isDay("2026-13-01"), "isDay knows real calendar days");
check(addDays("2026-12-31", 1) === "2027-01-01" && addDays("2026-03-01", -1) === "2026-02-28", "day arithmetic crosses months and years");
check(searchTerms("Budget, budget! Q3-review").join() === "budget,q3,review", "highlight terms are the words, de-duplicated, lower-case");

// ---------- 2. safe by construction ----------

check(!/security definer/i.test(fn), "comm_search_messages runs AS THE CALLER (no SECURITY DEFINER) — RLS decides every row");
check(/prosecdef/.test(sql) && /must run as the caller/.test(sql), "the migration asserts that from the catalog");
check(/quote_literal\(w\) \|\| ':\*'/.test(fn) && /regexp_split_to_table\(lower\(coalesce\(p_text, ''\)\), '\[\[:space:\]\[:punct:\]\]\+'\)/.test(fn), "the query is built from WORDS, each a quoted prefix — typed &, |, ! or ( are never syntax");
check(!/execute\s/i.test(fn) && !/format\(/.test(fn), "no dynamic SQL anywhere in the function");
check(/g\.deleted_at is null/.test(fn) && /g\.kind = 'message'/.test(fn), "deleted messages and system lines are never results");
check(/c\.workspace_id = \(select w\.id from public\.comm_workspace w limit 1\)/.test(fn), "results are confined to the workspace");
check(/at time zone 'Asia\/Kolkata'/.test(fn) && /\(p_to_day \+ 1\)::timestamp/.test(fn), "days are cut at IST midnight, the end day included");
check(/\(h\.rank, h\.created_at, h\.id\) < \(p_after_rank, p_after_at, p_after_id\)/.test(fn) && !/\boffset\b/i.test(fn), "pages are keyset, never OFFSET — no repeats, no gaps");
check(/if v_q is null then\s+v_sort := 'newest';/.test(fn), "with no words there is nothing to rank — newest first, said honestly");
check(/least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\)/.test(fn) && /char_length\(coalesce\(p_text, ''\)\) > 200/.test(fn), "page size and text length are bounded in the database too");
check(/using gin \(to_tsvector\('simple', coalesce\(body, ''\)\)\)/.test(sql) && fn.includes("to_tsvector('simple', coalesce(g.body, '')) @@ v_q"), "the WHERE uses the indexed expression exactly");
const c = { r: 0.25, t: "2026-10-27T10:00:00.123+00:00", i: "aaaaaaaa-0000-4000-8000-000000000001" };
const enc = encodeSearchCursor(c);
check(JSON.stringify(decodeSearchCursor(enc)) === JSON.stringify(c), "the cursor round-trips");
for (const bad of ["", "not-base64!!", Buffer.from('{"r":"1; drop","t":"x","i":"y"}').toString("base64url"), "x".repeat(400)]) {
  check(decodeSearchCursor(bad) === null, `a tampered cursor decodes to nothing: ${bad.slice(0, 16) || "(empty)"}`);
}
check(!searchInput.safeParse({ q: "x".repeat(201) }).success, "a 201-character search is refused at the door");
check(!searchInput.safeParse({ q: "x", author: "1 or 1=1" }).success && !searchInput.safeParse({ q: "x", fromDay: "2026-13-40" }).success && !searchInput.safeParse({ q: "x", kind: "everything" }).success, "a malformed sender, date or type is refused at the door");
const svc = read("lib/comms/service.ts");
const searchSrc = svc.slice(svc.indexOf("// Search (0762)"));
check(/s\.rpc\("comm_directory"/.test(searchSrc) && /s\.rpc\("comm_discover_channels"/.test(searchSrc) && !/createAdminClient/.test(searchSrc), "from: and in: resolve through what the CALLER may see — never the service role");
check(/if \(problems\.length > 0\) return \{ \.\.\.empty, problems \};/.test(searchSrc), "an operator that cannot be resolved stops the search instead of widening it");
check(/\.select\(MESSAGE_SELECT\)\.in\("id", page\.map/.test(searchSrc) && /withTitles\(s, await hydrate\(s, ordered, me\), me\)/.test(searchSrc), "one select for the page's messages and one for titles — no query per result");
check(!/console\.(log|info|warn|error)\([^)]*\bq\b/.test(read("lib/comms/search-actions.ts") + searchSrc), "the search text is never logged");

// ---------- 3. highlighting ----------

const s1 = snippet("Please send the INVOICE for RE-1021 today", ["inv", "re"]);
check(s1.filter((x) => x.hit).map((x) => x.text).join("|") === "INVOICE|RE", "every word STARTING with a term is marked, whole word (inv → INVOICE)");
check(!snippet("the prevent", ["vent"]).some((x) => x.hit), "a term inside a word is not marked — the database matches prefixes only");
const long = "x ".repeat(400) + "needle " + "y ".repeat(400);
const s2 = snippet(long, ["needle"]);
check(s2.some((x) => x.hit && x.text === "needle") && s2[0].text === "… " && s2.map((x) => x.text).join("").length < 260, "a long message shows a window around the match, not the whole message");
const s3 = snippet("<img src=x onerror=alert(1)> invoice", ["invoice"]);
check(s3.map((x) => x.text).join("").includes("<img src=x onerror=alert(1)>"), "markup in a message stays TEXT in the pieces (rendered as text, never HTML)");
const view = read("components/comms/search-view.tsx");
check(/<mark key=\{i\}/.test(view) && !/dangerouslySetInnerHTML/.test(view), "matches are drawn with <mark> around text — no raw HTML");

// ---------- 4. the screens ----------

check(messageHref({ conversation_id: "c", id: "m", parent_id: null }) === "/comms/c/c?m=m" && messageHref({ conversation_id: "c", id: "m", parent_id: "p" }) === "/comms/c/c?m=m&t=p", "a result opens AT its message, and a reply in its thread");
check(/router\.push\(qs \? `\$\{pathname\}\?\$\{qs\}` : pathname\)/.test(view) && !/hits\.filter\(\(h\) => h\.message\.author_id ===/.test(view), "filters change the URL and the SERVER searches — no filtering of a loaded list in the browser");
check(/Clear all filters/.test(view) && /aria-label=\{`Remove filter \$\{c\.label\}`\}/.test(view), "active filters are visible, removable one by one, and clearable at once");
check(/searchMore\(\{ \.\.\.state, cursor: next \}\)/.test(view) && /!seen\.has\(h\.message\.id\)/.test(view), "Load more pages with the cursor, never repeating a result");
const cv = read("components/comms/conversation-view.tsx");
check(/for \(let i = 0; i < 10 && !loaded\.some\(\(m\) => m\.id === target\) && cur; i\+\+\)/.test(cv) && /scrollIntoView\(\{ block: "center" \}\)/.test(cv) && /if \(focus\.threadParentId\) setThreadOf\(found\)/.test(cv), "the conversation pages back to the message, scrolls to it, and opens its thread");
check(/href=\{messageHref\(it\.hit\.message\)\}/.test(read("components/comms/saved-view.tsx")), "Saved items open at the message too");
check(/listPeople\(parsed\.text, "active"\)/.test(read("app/(app)/comms/search/page.tsx")) && /discoverChannels\(parsed\.text, "active", 0\)/.test(read("app/(app)/comms/search/page.tsx")), "people and channels come from the directory and discovery — what People and Channels would show");

if (failures > 0) {
  console.error(`\ncheck:comms-search — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms-search — all assertions passed");
