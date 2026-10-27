// Verification for Communication Hub CHANNEL MESSAGING (0737's engine, with
// 0750 / 0751 inside its gates and 0759's mention list).
//
//     npm run check:comms-messaging
//
// check-comms.mts already proves the engine's halves agree (RPCs exist, the
// caller is never a parameter, cursors, mentions, attachment keys). This file
// adds what Task 03 changed or relies on:
//
//   1. RENDERING IS SAFE — links are http(s) only, built as React text and a
//      checked href; no comm screen uses dangerouslySetInnerHTML.
//   2. COPY gives the reader's text (@Name), never the <@uuid> token.
//   3. THE MENTION LIST = THE PARSER — the composer drops anyone 0759 says
//      cannot be mentioned, and 0759 asks the same deactivation test 0750's
//      parser does.
//   4. THE ENGINE'S RULES ARE STILL WHERE TASK 03 NEEDS THEM — author-only
//      edit, soft delete that empties the body, the length limit, the retry
//      key, archived / deactivated / paused refusals, rate limits on send and
//      edit, and Realtime limited to comm_messages under its SELECT policy.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MESSAGE_MAX, linkPieces, plainText, sendMessageInput } from "../lib/comms/types.ts";

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
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");
const m0737 = stripSql(read("supabase/migrations/0737_communication_hub_core.sql"));
const m0750 = stripSql(read("supabase/migrations/0750_comms_workspace.sql"));
const m0759 = stripSql(read("supabase/migrations/0759_comms_messaging_mentionable.sql"));

// ---------- 1. rendering is safe ----------

const urls = (t: string) => linkPieces(t).filter((p): p is { url: string } => "url" in p).map((p) => p.url);
check(urls("see https://raagam.in/po/12 now").join() === "https://raagam.in/po/12", "an https link is found inside a sentence");
check(urls("end of sentence http://x.com/a.").join() === "http://x.com/a", "sentence punctuation stays outside the link");
check(urls("(see https://x.com/a)").join() === "https://x.com/a", "a closing bracket the link did not open stays outside");
check(urls("https://en.wikipedia.org/wiki/Cotton_(fibre)").join() === "https://en.wikipedia.org/wiki/Cotton_(fibre)", "a bracket the link opened stays inside");
check(urls("javascript:alert(1) data:text/html,<b>x</b> www.x.com ftp://x.com").length === 0, "javascript:, data:, bare www. and ftp: never become links");
check(urls('https://x.com/"onmouseover=alert(1)').join() === "https://x.com/", "a quote ends the link — no attribute can be smuggled");
check(linkPieces("plain words").length === 1 && "text" in linkPieces("plain words")[0], "text without a link is one text piece");
check(linkPieces("a https://x.com b").map((p) => ("url" in p ? `<${p.url}>` : p.text)).join("") === "a <https://x.com> b", "pieces rebuild the original text exactly");

const body = read("components/comms/message-body.tsx");
check(/rel="noopener noreferrer nofollow"/.test(body) && /target="_blank"/.test(body), "links open in a new tab with no opener and no referrer");
check(/linkPieces\(p\.text\)/.test(body), "only TEXT pieces are linkified — mentions and record chips are not re-parsed");
const commsUi = readdirSync(resolve(root, "components/comms")).filter((f) => f.endsWith(".tsx"));
const html = commsUi.filter((f) => /dangerouslySetInnerHTML/.test(read(`components/comms/${f}`)));
check(html.length === 0, `no comm screen renders raw HTML (${commsUi.length} files${html.length ? `; offenders: ${html.join(", ")}` : ""})`);

// ---------- 2. copy ----------

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const P = "eeeeeeee-0000-4000-8000-000000000005";
check(plainText(`hi <@${A}>, see <rec:purchase_order:${P}>`, new Map([[A, "BALA"]])) === "hi @BALA, see [purchase order]", "copy gives @Name and a record label, never a token");
check(plainText(`<@${A}>`, new Map()) === "@someone", "copy of an unknown mention is @someone, never a uuid");
const item = read("components/comms/message-item.tsx");
check(/label="Copy text"/.test(item) && /plainText\(m\.body, names\)/.test(item), "the message toolbar has Copy text, using the reader's text");
check(/\[@media\(hover:none\)\]:opacity-100/.test(item) && /group-focus-within:opacity-100/.test(item), "message actions show on touch screens and on keyboard focus, not only on hover");

// ---------- 3. the mention list = the parser ----------

check(/m\.mentionable !== false/.test(read("components/comms/composer.tsx")), "the composer offers only mentionable members");
check(/comm_mentionable_members/.test(read("lib/comms/service.ts")), "the conversation read asks 0759 who is mentionable");
check(/not public\.comm_workspace_blocked\(m\.user_id\)/.test(m0759) && /comm_workspace_blocked/.test(m0750.match(/function public\.comm_parse_mentions[\s\S]*?\$\$;/)?.[0] ?? ""), "0759's list and 0750's parser drop the same deactivated people");
check(/public\.comm_is_member\(p_conv\)/.test(m0759), "only an active member of the conversation gets the list (no probing of private channels)");
check(/revoke all on function public\.comm_mentionable_members\(uuid\) from public, anon;/.test(m0759), "0759 is not callable by anon");

// ---------- 4. the engine's rules ----------

const editFn = m0737.match(/function public\.comm_edit_message[\s\S]*?\$\$;/)?.[0] ?? "";
check(/v_msg\.author_id is distinct from v_me/.test(editFn), "only the author can edit");
check(/edited_at = clock_timestamp\(\)/.test(editFn), "an edit stamps edited_at (the (edited) label)");
const delFn = m0737.match(/function public\.comm_delete_message[\s\S]*?\$\$;/)?.[0] ?? "";
check(/set body = null, deleted_at = clock_timestamp\(\), deleted_by = v_me/.test(delFn), "delete is soft and EMPTIES the body — the text is not readable afterwards");
check(/comm_can_read_at\(v_msg\.conversation_id, v_msg\.created_at\)/.test(delFn), "nobody can delete in a conversation they cannot read");
check(/v_msg\.author_id = v_me\s+or public\.comm_can_manage\(v_msg\.conversation_id\)/.test(delFn), "the author or a channel owner/moderator (comm_can_manage, narrowed by 0751) may delete");
check(/constraint chk_comm_msg_body_len check \(body is null or char_length\(body\) <= 8000\)/.test(m0737) && MESSAGE_MAX === 8000, "8,000 characters, enforced by the table and the input schema alike");
check(!sendMessageInput.safeParse({ conversation_id: A, client_id: A, body: "x".repeat(MESSAGE_MAX + 1) }).success, "an oversized message is refused at the door");
check(/uq_comm_msg_client/.test(m0737), "a retried send cannot post twice (author, client_id)");
const actions = read("lib/comms/actions.ts");
check(/allow\(`comm-send:\$\{me\.id\}`/.test(actions) && /allow\(`comm-edit:\$\{me\.id\}`/.test(actions), "send and edit are rate limited per person");
check(/add table public\.comm_messages/.test(m0737) && !/add table public\.comm_(members|conversations)/.test(m0737), "Realtime publishes comm_messages only — rows its SELECT policy decides per subscriber");
check(/filter = `conversation_id=eq\.\$\{id\}`|conversation_id=eq\./.test(read("components/comms/conversation-view.tsx")), "a conversation subscribes to its own messages only");

if (failures > 0) {
  console.error(`\ncheck:comms-messaging — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms-messaging — all assertions passed");
