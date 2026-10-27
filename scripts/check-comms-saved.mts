// Verification for Communication Hub SAVED MESSAGES (0737's comm_saved,
// listed by 0763; the Saved page, the bookmark in chats, channels and threads).
//
//     npm run check:comms-saved
//
// The live half — two people saving the same message, an outsider, a removed
// member, deletion — is the saved end-to-end run. This file asserts:
//
//   1. THE LIST — runs as the caller, only their own rows, a message they can
//      no longer read comes back as "unavailable" with nothing about it,
//      filters are applied in SQL with the search text escaped, keyset paging.
//   2. 0737's GUARANTEES STILL HOLD — one save per person and message, own rows
//      only, saving needs read access, nothing broadcast, no text copied.
//   3. THE SCREENS — server-applied filters, Load more without repeats, Remove
//      that cannot double-fire, deleted and unavailable states, open AT the
//      message, save from threads, a visible marker, no double-click flip.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const m0737 = strip(read("supabase/migrations/0737_communication_hub_core.sql"));
const sql = strip(read("supabase/migrations/0763_comms_saved_list.sql"));
const fn = sql.match(/function public\.comm_my_saved[\s\S]*?\$\$;/)?.[0] ?? "";

// ---------- 1. the list ----------

check(!/security definer/i.test(fn) && /prosecdef/.test(sql), "comm_my_saved runs AS THE CALLER — both tables' RLS apply (and the migration asserts it)");
check(/where sv\.user_id = v_me/.test(fn) && /v_me  uuid := auth\.uid\(\)/.test(fn), "only the caller's own saved rows, the caller taken from the session");
check(/left join public\.comm_messages g on g\.id = sv\.message_id/.test(fn) && /g\.id is not null,/.test(fn), "a saved message the caller can no longer read is kept as 'unavailable', not dropped");
check(/returns table \(message_id uuid, saved_at timestamptz, available boolean,\s+conversation_id uuid, parent_id uuid\)/.test(fn) && !/g\.body,|g\.author_id,/.test(fn.slice(fn.indexOf("return query"))), "nothing about an unavailable message is returned — no text, no sender");
check(/replace\(replace\(replace\(v_txt, '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'\)/.test(fn), "the search words are matched literally (LIKE wildcards escaped)");
check(/\(sv\.saved_at, sv\.message_id\) < \(p_before_at, p_before_id\)/.test(fn) && /order by sv\.saved_at desc, sv\.message_id desc/.test(fn) && !/\boffset\b/i.test(fn), "newest save first, keyset paging — no repeats, no gaps");
check(/least\(greatest\(coalesce\(p_limit, 30\), 1\), 100\)/.test(fn) && /p_kind not in \('channel', 'direct', 'group', 'thread'\)/.test(fn), "page size and filter values are bounded in the database");
check(/revoke all on function public\.comm_my_saved\(text, uuid, text, boolean, timestamptz, uuid, integer\) from public, anon;/.test(sql), "not callable by anon");

// ---------- 2. 0737's guarantees ----------

check(/primary key \(user_id, message_id\)/.test(m0737.match(/create table if not exists public\.comm_saved[\s\S]*?\);/)?.[0] ?? ""), "one save per person and message (primary key)");
check(/create policy comm_saved_insert on public\.comm_saved\s+for insert to authenticated\s+with check \(user_id = \(select auth\.uid\(\)\) and public\.comm_message_visible\(message_id\)\);/.test(m0737), "saving needs your own id AND read access to the message");
check(/create policy comm_saved_delete on public\.comm_saved\s+for delete to authenticated using \(user_id = \(select auth\.uid\(\)\)\);/.test(m0737), "only your own saved rows can be removed");
check(/create policy comm_saved_read on public\.comm_saved\s+for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\);/.test(m0737), "nobody can read anyone else's saved list");
check(!/publication supabase_realtime add table public\.comm_saved/.test(m0737), "saved state is never broadcast (comm_saved is not in Realtime)");
check(/message_id uuid not null references public\.comm_messages\(id\) on delete cascade/.test(m0737.match(/create table if not exists public\.comm_saved[\s\S]*?\);/)?.[0] ?? "") && !/body/.test(m0737.match(/create table if not exists public\.comm_saved[\s\S]*?\);/)?.[0] ?? ""), "a saved row references the message — no text copied");
const actions = read("lib/comms/actions.ts");
const setSavedFn = actions.match(/export async function setSaved[\s\S]*?\n\}/)?.[0] ?? "";
check(/user_id: me\.id/.test(setSavedFn) && /\.eq\("user_id", me\.id\)/.test(setSavedFn) && !/userId|user_id: (?!me\.id)/.test(setSavedFn.replace(/user_id: me\.id/g, "")), "the saved row is always the SESSION's — no user id comes from the browser");
check(/ignoreDuplicates: true/.test(setSavedFn) && /\[0-9a-f-\]\{36\}/.test(setSavedFn) && /allow\(`comm-save:/.test(setSavedFn), "saving is idempotent, validated and rate limited");

// ---------- 3. the screens ----------

const svc = read("lib/comms/service.ts");
const pageFn = svc.match(/export async function getSavedPage[\s\S]*?\n\}/)?.[0] ?? "";
check(/s\.rpc\("comm_my_saved"/.test(pageFn) && /\.select\(MESSAGE_SELECT\)\.in\("id", ids\)/.test(pageFn) && !/for \(const .* of page\)[\s\S]*await/.test(pageFn), "one read for the page, one for its messages — no query per saved item");
check(/UUID_RE\.test\(m\[2\]\)/.test(svc) && /c\.length > 200/.test(svc), "a tampered cursor is refused");
const view = read("components/comms/saved-view.tsx");
check(/router\.push\(qs \? `\$\{pathname\}\?\$\{qs\}` : pathname\)/.test(view), "filters change the URL and the SERVER filters — across every saved item, not one page");
check(/if \(removing\.has\(id\)\) return;/.test(view) && /!seen\.has\(x\.message_id\)/.test(view), "Remove cannot double-fire; Load more never repeats an item");
check(/This message is no longer available to you\./.test(view) && /This message was deleted\./.test(view), "unavailable and deleted messages each say so, with Remove");
check(/href=\{messageHref\(it\.hit\.message\)\}/.test(view) && /thread reply/.test(view) && /Paperclip/.test(view) && /Saved \{fmtDateTime\(it\.saved_at\)\}/.test(view), "items open at the message and show thread, files and when they were saved");
const thread = read("components/comms/thread-sheet.tsx");
check(/onSave: \(m: CommMessage\) => void save\(m\)/.test(thread) && /if \(saving\.current\.has\(m\.id\)\) return;/.test(thread), "thread replies can be saved, one request at a time");
const cv = read("components/comms/conversation-view.tsx");
check(/if \(savingIds\.current\.has\(m\.id\)\) return;/.test(cv) && /const want = !m\.saved;/.test(cv), "a double click cannot save and then unsave");
check(/\{m\.saved && \(/.test(read("components/comms/message-item.tsx")) && /"Save for later"/.test(read("components/comms/message-item.tsx")), "a saved message shows its marker; the action reads Save for later");

if (failures > 0) {
  console.error(`\ncheck:comms-saved — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms-saved — all assertions passed");
