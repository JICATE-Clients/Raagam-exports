// Verification for Communication Hub CHANNEL MANAGEMENT (migration 0751,
// lib/comms/channels.ts, channel-service.ts, channel-actions.ts, the Channels
// page, the channel details sheet and the sidebar's Channels fold).
//
//     npm run check:comms-channels
//
// The live, signed-in half is scripts/comms-channels-smoke-test.sql. This
// file asserts what that one cannot see:
//
//   1. THE TWO HALVES AGREE — every RPC the code calls exists in 0751; every
//      errcode reaches the operator as its sentence; the name rule is the SAME
//      regex in SQL and TypeScript and agrees on vectors.
//   2. THE PERMISSION TABLE IN 0751's HEADER IS WHAT comm_channel_can() DOES —
//      the CASE is parsed out of the migration and evaluated for every role ×
//      governor × visibility × archived combination against the table.
//   3. 0751 KEEPS 0737's PROMISES — internal rules callable by nobody, the
//      replaced gates keep their signatures, one comm_create_channel only.
//   4. THE SCREENS DRAW FROM THE SERVER'S ANSWER, and the sidebar fold is part
//      of the module's accordion.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commErrorText } from "../lib/comms/types.ts";
import {
  channelNameProblem,
  createChannelInput,
  normalizeChannelName,
  prefsInput,
  sortSidebar,
  transferInput,
  updateChannelInput,
} from "../lib/comms/channels.ts";

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
const m0751 = stripSql(read("supabase/migrations/0751_comms_channel_management.sql"));
const code = ["lib/comms/channel-actions.ts", "lib/comms/channel-service.ts"].map(read).join("\n");
const actions = read("lib/comms/actions.ts");

// ---------- 1. the halves agree ----------

const defined = new Set(Array.from(m0751.matchAll(/create or replace function public\.(comm_[a-z_]+)/g), (m) => m[1]));
const called = Array.from(new Set(Array.from(code.matchAll(/\.rpc\(\s*"(comm_[a-z_]+)"/g), (m) => m[1])));
const missing = called.filter((f) => !defined.has(f));
check(called.length >= 7 && missing.length === 0, `every channel RPC the code calls exists in 0751 (${called.join(", ")}${missing.length ? `; missing: ${missing.join(", ")}` : ""})`);
check(/p_description: d\.description,\s*p_create_key: d\.create_key/.test(actions), "createChannel passes 0751's description and retry key");
check(!/can\("communication", "create"\)\)\) return fail/.test(actions), "createChannel leaves the create decision to the RPC (workspace admins may create too)");

const raised = Array.from(new Set(Array.from(m0751.matchAll(/errcode = '(\d{5})'/g), (m) => m[1])));
const silenced = raised.filter((c) => commErrorText({ code: c, message: "reason" }, "fallback") !== "reason");
check(raised.length > 0 && silenced.length === 0, `every errcode 0751 raises reaches the operator (${raised.join(", ")})`);

const rpcArgs = Array.from(code.matchAll(/\.rpc\(\s*"comm_[a-z_]+"\s*,\s*\{([^}]*)\}/g), (m) => m[1]);
check(rpcArgs.every((a) => !/p_(author|sender|actor|me|caller|user_id|admin)\b/.test(a)), "no channel RPC call passes the caller's id");
check(!/createAdminClient/.test(code), "channel reads and writes never use the service role");

const sqlRe = m0751.match(/when p_slug !~ '([^']+)' then/)?.[1];
const tsRe = read("lib/comms/channels.ts").match(/if \(!\/(\^\[a-z0-9\][^/]+)\/\.test\(slug\)\)/)?.[1];
check(!!sqlRe && sqlRe === tsRe, `the name rule is one regex in SQL and TS (${sqlRe})`);
check(/name ~ '\^\[a-z0-9\]\[a-z0-9_-\]\{0,79\}\$'/.test(m0751), "the table constraint enforces the same rule, capped at 80");
const vectors: [string, string, boolean][] = [
  ["  Cutting   Room ", "cutting-room", true],
  ["cutting-room", "cutting-room", true],
  ["QC_2026", "qc_2026", true],
  ["#general", "#general", false],
  ["-lead", "-lead", false],
  ["a.b", "a.b", false],
  ["", "", false],
  ["a".repeat(80), "a".repeat(80), true],
  ["a".repeat(81), "a".repeat(81), false],
];
for (const [raw, slug, valid] of vectors) {
  const got = normalizeChannelName(raw);
  check(got === slug && (channelNameProblem(got) === null) === valid, `name ${JSON.stringify(raw.length > 20 ? raw.slice(0, 8) + "…" : raw)} -> ${JSON.stringify(slug.length > 20 ? slug.slice(0, 8) + "…" : slug)} ${valid ? "valid" : "refused"}`);
}

// ---------- 2. the permission table = comm_channel_can ----------

const fnBody = m0751.match(/function public\.comm_channel_can\([\s\S]*?\n\$\$;/)?.[0] ?? "";
const cases = new Map(
  Array.from(fnBody.matchAll(/when '([a-z_]+)'\s+then (.+)/g), (m) => [m[1], m[2].trim()] as [string, string]),
);
function toJs(expr: string): string {
  return expr
    .replace(/v_role = '([a-z]*)'/g, "role === '$1'")
    .replace(/v_role <> ''/g, "role !== ''")
    .replace(/c\.visibility = 'public'/g, "pub")
    .replace(/not c\.is_archived/g, "!archived")
    .replace(/v_owner/g, "owner")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||");
}
type Role = "owner" | "admin" | "member" | "";
// The header table, written independently of the CASE.
const TABLE: Record<string, (r: Role, ownerLike: boolean, pub: boolean, archived: boolean) => boolean> = {
  edit_info: (r, o) => o || r === "admin",
  rename: (_r, o) => o,
  add_members: (r, o, _p, a) => (o || r === "admin") && !a,
  remove_members: (r, o) => o || r === "admin",
  remove_privileged: (_r, o) => o,
  set_roles: (_r, o) => o,
  transfer: (_r, o) => o,
  archive: (_r, o) => o,
  join: (r, _o, p, a) => r === "" && p && !a,
  leave: (r) => r !== "",
  preferences: (r) => r !== "",
};
check(cases.size === Object.keys(TABLE).length, `comm_channel_can has exactly the ${Object.keys(TABLE).length} actions of the table (${[...cases.keys()].join(", ")})`);
let wrong = 0;
let n = 0;
for (const [action, expected] of Object.entries(TABLE)) {
  const expr = cases.get(action);
  if (!expr) {
    wrong++;
    console.error(`      missing action ${action}`);
    continue;
  }
  const fn = new Function("role", "owner", "pub", "archived", `return (${toJs(expr)});`) as (r: Role, o: boolean, p: boolean, a: boolean) => boolean;
  for (const role of ["owner", "admin", "member", ""] as Role[])
    for (const governs of [false, true])
      for (const pub of [false, true])
        for (const archived of [false, true]) {
          n++;
          // v_owner := role = 'owner' or (public and governs) — the governor reaches PUBLIC channels only.
          const owner = role === "owner" || (pub && governs);
          const got = !!fn(role, owner, pub, archived);
          if (got !== expected(role, owner, pub, archived)) {
            wrong++;
            console.error(`      ${action}(role=${role || "none"}, governs=${governs}, public=${pub}, archived=${archived}) = ${got}`);
          }
        }
}
check(wrong === 0, `comm_channel_can matches the header's permission table on ${n} combinations`);
check(/v_owner := v_role = 'owner'\s+or \(c\.visibility = 'public' and coalesce\(public\.comm_workspace_governs\(v_me\), false\)\);/.test(fnBody), "a governor gets owner powers on PUBLIC channels only");
check(/v_role := coalesce\(v_role, ''\);/.test(fnBody), "a non-member's role is '' — never NULL inside the boolean rule");

// ---------- 3. 0751 keeps 0737's promises ----------

for (const fn of ["comm_channel_can(uuid, text)", "comm_workspace_governs(uuid)", "comm_channel_slug(text)", "comm_channel_name_problem(text)", "comm_workspace_id()"]) {
  const esc = fn.replace(/[()[\]]/g, "\\$&");
  const name = fn.replace(/\(.*$/, "");
  check(new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated;`).test(m0751) && !new RegExp(`grant execute on function public\\.${name}\\(`).test(m0751), `${name} is internal (granted to nobody)`);
}
const fnNames = Array.from(new Set(Array.from(m0751.matchAll(/create or replace function public\.([a-z_]+)\(/g), (m) => m[1])));
const unrevoked = fnNames.filter((f) => !new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon`).test(m0751));
check(unrevoked.length === 0, `every 0751 function is revoked from anon and PUBLIC${unrevoked.length ? ` (not: ${unrevoked.join(", ")})` : ""}`);
const sig = (sql: string, fn: string) => sql.match(new RegExp(`revoke all on function public\\.${fn}\\(([^)]*)\\)`))?.[1].replace(/\s+/g, "") ?? null;
for (const fn of ["comm_can_manage", "comm_update_conversation", "comm_remove_member", "comm_set_member_role", "comm_set_muted"]) {
  const a = sig(m0737, fn);
  check(a !== null && a === sig(m0751, fn), `${fn} keeps 0737's signature (${a})`);
}
check(/drop function if exists public\.comm_create_channel\(text, text, text, uuid, uuid\[\]\);/.test(m0751), "the old five-argument comm_create_channel is dropped, not left as an overload");
check(/p_member_ids uuid\[\] default '\{\}',\s*p_description text default null, p_create_key uuid default null/.test(m0751), "the two new create arguments come LAST and default, so a five-argument caller still resolves");
check(/uq_comm_conv_create_key[\s\S]*?\(created_by, create_key\)/.test(m0751), "a retried create is caught by (created_by, create_key)");
check(/c\.visibility = 'public' or m\.user_id is not null/.test(m0751), "discovery shows a private channel only to its members");

// ---------- 4. inputs, ordering, screens ----------

const K = "aaaaaaaa-0000-4000-8000-000000000001";
const p1 = createChannelInput.safeParse({ name: "Cutting Room", visibility: "public", create_key: K });
check(p1.success && p1.data.name === "cutting-room" && p1.data.description === null && p1.data.member_ids.length === 0, "createChannelInput normalises the name and defaults the rest");
check(!createChannelInput.safeParse({ name: "#general", visibility: "public", create_key: K }).success, "createChannelInput refuses a name breaking the rule");
check(!createChannelInput.safeParse({ name: "ok", visibility: "public" }).success, "createChannelInput requires the retry key");
check(!createChannelInput.safeParse({ name: "ok", visibility: "secret", create_key: K }).success, "an unknown visibility is refused");
check(!createChannelInput.safeParse({ name: "ok", visibility: "public", create_key: K, description: "x".repeat(501) }).success, "a description over 500 is refused");
check(!updateChannelInput.safeParse({ conversation_id: K, name: "ok", topic: "x".repeat(251) }).success, "a topic over 250 is refused");
check(transferInput.safeParse({ conversation_id: K, to_user_id: K }).data?.step_down_to === "admin", "transfer defaults the old owner to moderator");
check(!transferInput.safeParse({ conversation_id: K, to_user_id: K, step_down_to: "owner" }).success, "transfer cannot leave the old owner an owner by mistake");
check(!prefsInput.safeParse({ conversation_id: K, notify_level: "loud" }).success, "an unknown notification level is refused");

const sorted = sortSidebar([
  { name: "zeta", pinned_at: null },
  { name: "alpha", pinned_at: null },
  { name: "pinned-late", pinned_at: "2026-10-27T10:00:00Z" },
  { name: "pinned-early", pinned_at: "2026-10-27T09:00:00Z" },
]).map((r) => r.name);
check(sorted.join() === "pinned-early,pinned-late,alpha,zeta", "sidebar order: pinned first in the order pinned, then by name");
check(/order by \(m\.pinned_at is null\), m\.pinned_at, c\.name/.test(m0751), "the database orders the sidebar the same way");

const sheet = read("components/comms/channel-details-sheet.tsx");
const gates = ["can.edit_info", "can.rename", "can.archive", "can.transfer", "can.add_members", "can.remove_members", "can.set_roles", "can.leave", "can.preferences"];
check(gates.every((g) => sheet.includes(g)), "every control in the channel sheet is drawn from the server's abilities");
check(!/comm_can_manage|has_permission|isAdminRole/.test(sheet), "the channel sheet decides nothing on its own");
const ctx = read("components/navigation/ContextSidebar.tsx");
check(/if \(mod\.href === "\/comms"\) \{\s*blocks\.push\(/.test(ctx) && /\{block\.content \?\? block\.rows\.map\(renderRow\)\}/.test(ctx), "the Channels fold is a block of the module's accordion (one open at a time)");
const side = read("components/comms/sidebar-channels.tsx");
check(/notify_level === "none" \? 0 : c\.unread_count/.test(side) && !/unread_count\s*[+]/.test(side), "sidebar counts are the database's, hidden only when the member chose Nothing");
check(/notify_level !== "none"/.test(read("lib/comms/notify.ts")), "notify.ts honours 'Nothing' for @mentions");

if (failures > 0) {
  console.error(`\ncheck:comms-channels — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms-channels — all assertions passed");
