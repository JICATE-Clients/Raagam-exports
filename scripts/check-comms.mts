// Verification for the Communication Hub's TypeScript half (lib/comms/*,
// migration 0737).
//
//     npm run check:comms
//
// Listed in tsconfig `exclude` like every other .mts checker; run with tsx.
// The DATABASE half — membership, removal cut-off, private channels, the
// retry key, RLS — is scripts/comms-smoke-test.sql, run against the database.
// This file asserts what that one cannot see:
//
//   1. THE TWO HALVES AGREE. The MIME allowlist is written three times (the
//      bucket row and comm_allowed_mime() in 0737, ALLOWED_MIME here); every
//      `.rpc("comm_…")` the services call exists in the migration; every
//      errcode 0737 raises is one commErrorText() passes through, or the
//      operator reads "try again" instead of the reason they were refused.
//   2. THE CALLER IS NEVER A PARAMETER. No comm RPC call in lib/comms passes
//      an author / sender / actor id — the database takes it from auth.uid().
//   3. THE PURE HELPERS — mentions, attachment keys, cursors, titles — on
//      vectors, including the hostile ones (a cursor is interpolated into a
//      PostgREST filter, so a malformed one must decode to null).

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALLOWED_MIME,
  ATTACHMENT_MAX_BYTES,
  attachmentPath,
  attachmentProblem,
  bodyPieces,
  commErrorText,
  conversationTitle,
  decodeCursor,
  encodeCursor,
  mentionIds,
  mentionToken,
  recordHref,
  recordRefs,
  recordToken,
  sendMessageInput,
} from "../lib/comms/types.ts";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`FAIL  ${msg}`);
}
function ok(msg: string) {
  console.log(`ok    ${msg}`);
}
function check(cond: boolean, msg: string) {
  if (cond) ok(msg);
  else fail(msg);
}
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

const root = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const migration = read("supabase/migrations/0737_communication_hub_core.sql");
const code = read("lib/comms/actions.ts") + "\n" + read("lib/comms/service.ts");

// ---------- 1. the halves agree ----------

const fnBody = migration.match(/function public\.comm_allowed_mime[\s\S]*?any \(array\[([\s\S]*?)\]\)/);
const bucketList = migration.match(/insert into storage\.buckets[\s\S]*?array\[([\s\S]*?)\]/);
const mimes = (src: string | undefined) => (src ? Array.from(src.matchAll(/'([^']+)'/g), (m) => m[1]) : []);
check(!!fnBody && same(mimes(fnBody[1]), ALLOWED_MIME), "ALLOWED_MIME = comm_allowed_mime() in 0737");
check(!!bucketList && same(mimes(bucketList[1]), ALLOWED_MIME), "ALLOWED_MIME = the comm-files bucket's allowed_mime_types");
check(migration.includes(`${ATTACHMENT_MAX_BYTES}`), `the bucket and the RPC carry the same ${ATTACHMENT_MAX_BYTES}-byte limit`);

// Functions may be defined by 0737 or by a later comms migration (0746…0760):
// a call is fine if ANY of them defines it.
const commMigrations = readdirSync(resolve(root, "supabase/migrations"))
  .filter((f) => /^07[4-9]\d_comms_|^0737_communication_hub_core/.test(f))
  .map((f) => read(`supabase/migrations/${f}`))
  .join("\n");
const defined = new Set(Array.from(commMigrations.matchAll(/create or replace function public\.(comm_[a-z_]+)/g), (m) => m[1]));
const called = Array.from(new Set(Array.from(code.matchAll(/\.rpc\(\s*"(comm_[a-z_]+)"/g), (m) => m[1])));
const missing = called.filter((f) => !defined.has(f));
check(called.length >= 15 && missing.length === 0, `every comm RPC the code calls exists in the comms migrations (${called.length} called${missing.length ? `; missing: ${missing.join(", ")}` : ""})`);

const raised = Array.from(new Set(Array.from(migration.matchAll(/errcode = '(\d{5})'/g), (m) => m[1])));
const silenced = raised.filter((c) => commErrorText({ code: c, message: "reason" }, "fallback") !== "reason");
check(raised.length > 0 && silenced.length === 0, `every errcode 0737 raises reaches the operator as its sentence (${raised.join(", ")})`);
check(commErrorText({ code: "XX000", message: 'relation "comm_messages" ...' }, "fallback") === "fallback", "an unexpected error never leaks a driver message");
check(commErrorText(null, "fallback") === "fallback", "no error object -> the fallback");

// ---------- 2. the caller is never a parameter ----------

const rpcArgs = Array.from(code.matchAll(/\.rpc\(\s*"comm_[a-z_]+"\s*,\s*\{([^}]*)\}/g), (m) => m[1]);
const forged = rpcArgs.filter((a) => /p_(author|sender|actor|me|caller|user_id)\b/.test(a));
check(rpcArgs.length > 0 && forged.length === 0, "no comm RPC call passes the caller's own id");
check(!/comm_messages"\)\s*\.(insert|update|upsert)/.test(code), "no direct insert/update on comm_messages — writes go through the RPCs");

// ---------- 3. pure helpers ----------

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

check(mentionToken(A) === `<@${A}>`, "mentionToken wraps the id");
check(same(mentionIds(`hi <@${A}> and <@${B.toUpperCase()}> and <@${A}>`), [A, B]), "mentionIds: distinct, lower-cased, in order");
check(mentionIds("<@not-a-uuid> @someone <@>").length === 0, "mentionIds ignores anything not a full uuid token");
const pieces = bodyPieces(`x<@${A}>y`);
check(pieces.length === 3 && "text" in pieces[0] && "mention" in pieces[1] && (pieces[1] as { mention: string }).mention === A, "bodyPieces splits text / mention / text");
check(bodyPieces(null).length === 0, "bodyPieces of nothing is nothing");

const conv = "cccccccc-0000-4000-8000-000000000003";
const id = "dddddddd-0000-4000-8000-000000000004";
const keyRe = new RegExp(`^${conv}/[0-9a-f-]{36}\\.[a-z0-9]{1,8}$`);
check(attachmentPath(conv, "Spec Sheet.PDF", id) === `${conv}/${id}.pdf`, "attachmentPath: conversation folder, id, lower-case extension");
check(attachmentPath(conv, "no-extension", id) === `${conv}/${id}.bin`, "attachmentPath: no extension -> .bin");
check(keyRe.test(attachmentPath(conv, "../../etc/passwd.x/../y", id)), "attachmentPath never lets the file name into the key");
check(keyRe.test(attachmentPath(conv, "weird.ex e", id)), "attachmentPath: a hostile extension still yields a key the send RPC accepts");
check(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 10 }) === null, "a small PDF is accepted");
check(!!attachmentProblem({ name: "a.exe", type: "application/x-msdownload", size: 10 }), "an .exe is refused");
check(!!attachmentProblem({ name: "big.pdf", type: "application/pdf", size: ATTACHMENT_MAX_BYTES + 1 }), "a file over 20 MB is refused");
check(!!attachmentProblem({ name: "empty.png", type: "image/png", size: 0 }), "an empty file is refused");

const ts = "2026-10-23T10:15:30.123456+00:00";
const cur = encodeCursor(ts, id);
const back = decodeCursor(cur);
check(back?.created_at === ts && back?.id === id, "cursor round-trips");
for (const bad of ["", "nonsense", `${ts}|not-a-uuid`, `2026-10-23),id.gt.(0|${id}`, `${ts}"|${id}`, `${ts},or(id.gt.0)|${id}`]) {
  check(decodeCursor(bad) === null, `a hostile cursor decodes to null: ${JSON.stringify(bad)}`);
}

check(conversationTitle({ kind: "channel", name: "cutting-room" }, []) === "#cutting-room", "a channel is #name");
check(conversationTitle({ kind: "direct", name: null }, ["BALA"]) === "BALA", "a DM is the other person");
check(conversationTitle({ kind: "group", name: null }, ["A", "B", "C", "D", "E"]) === "A, B, C +2", "an unnamed group lists three and counts the rest");
check(conversationTitle({ kind: "group", name: "Sampling team" }, ["A"]) === "Sampling team", "a named group keeps its name");

const parsed = sendMessageInput.safeParse({ conversation_id: conv, client_id: id, body: "hi" });
check(parsed.success && parsed.data.attachments.length === 0 && parsed.data.parent_id === null, "sendMessageInput defaults attachments and parent");
check(!sendMessageInput.safeParse({ conversation_id: conv, body: "hi" }).success, "sendMessageInput requires the retry key");
check(!sendMessageInput.safeParse({ conversation_id: conv, client_id: id, body: "x".repeat(8001) }).success, "sendMessageInput refuses a body over 8,000");

// ---------- 4. record links (phase 6) ----------

const PO = "eeeeeeee-0000-4000-8000-000000000005";
const linked = `see <rec:purchase_order:${PO}> and <@${A}> and <rec:sales_order:${B.toUpperCase()}> and <rec:purchase_order:${PO}>`;
const refs = recordRefs(linked);
check(refs.length === 2 && refs[0].kind === "purchase_order" && refs[1].id === B, "recordRefs: distinct, lower-cased, mentions ignored");
const lp = bodyPieces(linked);
check(lp.filter((p) => "record" in p).length === 3 && lp.filter((p) => "mention" in p).length === 1, "bodyPieces splits record and mention tokens in one pass");
check(recordRefs(`<rec:salary_slip:${PO}> <rec:purchase_order:not-a-uuid> <rec::${PO}>`).length === 0, "an unknown kind or a malformed id is plain text, never a link");
check(recordToken("purchase_indent", PO) === `<rec:purchase_indent:${PO}>`, "recordToken round-trips through the parser");
check(recordHref("sales_order", PO) === `/orders/${PO}`, "a link opens the record's own screen");

const records = read("lib/comms/records.ts");
check(!/createAdminClient/.test(records), "record previews never use the service role — a link must not grant access");
check(/can\(RECORD_KINDS\[kind\]\.module/.test(records), "every record read asks the module's own view permission first");
check(!/total_amount|fob_price|total_value|unit_price/.test(records.replace(/\/\*[\s\S]*?\*\//g, "")), "previews select no amounts");

if (failures > 0) {
  console.error(`\ncheck:comms — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms — all assertions passed");
