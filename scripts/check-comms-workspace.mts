// Verification for the Communication Hub WORKSPACE (migration 0750,
// lib/comms/workspace*.ts, the People and Workspace screens).
//
//     npm run check:comms-workspace
//
// Run with tsx, like check-comms.mts. The DATABASE half — who may list,
// change or deactivate whom, what a deactivated login can still reach — is
// scripts/comms-workspace-smoke-test.sql, run against the database. This file
// asserts what that one cannot see:
//
//   1. THE TWO HALVES AGREE. Every `.rpc("comm_workspace…")` exists in 0750;
//      every errcode 0750 raises reaches the operator as its sentence; no RPC
//      call passes the caller's own id.
//   2. THE MIGRATION KEEPS 0737'S PROMISES. The internal helpers are callable
//      by nobody; each gate 0750 replaces keeps 0737's exact signature (a new
//      overload would leave the old, unguarded one live) and carries its
//      workspace clause; every function is revoked from anon and PUBLIC.
//   3. THE SCREEN'S RULE = THE DATABASE'S RULE. `canManage` and
//      `assignableRoles` decide which buttons to draw; they are checked against
//      a table written from `comm_workspace_check_target` / `_set_role`.
//   4. THE INPUTS, the colours, and the wiring (nav rows, pages, the layout's
//      deactivated gate) on vectors.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commErrorText } from "../lib/comms/types.ts";
import {
  MEMBER_STATUSES,
  WORKSPACE_ROLES,
  assignableRoles,
  canManage,
  memberStatusTone,
  setActiveInput,
  setRoleInput,
  workspaceSettingsInput,
  type MemberStatus,
  type WorkspaceRole,
} from "../lib/comms/workspace.ts";

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
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");
const m0737 = stripSqlComments(read("supabase/migrations/0737_communication_hub_core.sql"));
const m0750raw = read("supabase/migrations/0750_comms_workspace.sql");
const m0750 = stripSqlComments(m0750raw);
const code = read("lib/comms/workspace-actions.ts") + "\n" + read("lib/comms/workspace-service.ts");

// ---------- 1. the halves agree ----------

const defined = new Set(Array.from(m0750.matchAll(/create or replace function public\.(comm_[a-z_]+)/g), (m) => m[1]));
const called = Array.from(new Set(Array.from(code.matchAll(/\.rpc\(\s*"(comm_[a-z_]+)"/g), (m) => m[1])));
const missing = called.filter((f) => !defined.has(f));
check(called.length >= 6 && missing.length === 0, `every workspace RPC the code calls exists in 0750 (${called.join(", ")}${missing.length ? `; missing: ${missing.join(", ")}` : ""})`);

const raised = Array.from(new Set(Array.from(m0750.matchAll(/errcode = '(\d{5})'/g), (m) => m[1])));
const silenced = raised.filter((c) => commErrorText({ code: c, message: "reason" }, "fallback") !== "reason");
check(raised.length > 0 && silenced.length === 0, `every errcode 0750 raises reaches the operator as its sentence (${raised.join(", ")})`);

const rpcArgs = Array.from(code.matchAll(/\.rpc\(\s*"comm_[a-z_]+"\s*,\s*\{([^}]*)\}/g), (m) => m[1]);
check(rpcArgs.length > 0 && rpcArgs.every((a) => !/p_(author|sender|actor|me|caller|admin)\b/.test(a)), "no workspace RPC call passes the caller's id or an admin flag");
check(!/createAdminClient/.test(code), "workspace reads and writes never use the service role");
check(!/from\("comm_workspace(_members)?"\)\s*\.(insert|update|upsert|delete)/.test(code), "no direct write to the workspace tables — writes go through the RPCs");

// ---------- 2. the migration keeps 0737's promises ----------

const INTERNAL = [
  "comm_workspace_blocked(uuid)",
  "comm_workspace_role(uuid)",
  "comm_workspace_status(uuid)",
  "comm_workspace_admin_actor()",
  "comm_workspace_check_target(uuid, uuid)",
  "comm_workspace_people_rows(text, uuid, boolean)",
];
for (const fn of INTERNAL) {
  const name = fn.replace(/\(.*$/, "");
  const esc = fn.replace(/[()[\]]/g, "\\$&");
  check(new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated;`).test(m0750), `${name} is revoked from authenticated`);
  check(!new RegExp(`grant execute on function public\\.${name}\\(`).test(m0750), `${name} is granted to nobody`);
}

const fnNames = Array.from(new Set(Array.from(m0750.matchAll(/create or replace function public\.([a-z_]+)\(/g), (m) => m[1])));
const unrevoked = fnNames.filter((f) => !new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon`).test(m0750));
check(unrevoked.length === 0, `every 0750 function is revoked from anon and PUBLIC${unrevoked.length ? ` (not: ${unrevoked.join(", ")})` : ""}`);

/** The argument types of a function, as written in its `revoke` line. */
function signature(sql: string, fn: string): string | null {
  const m = sql.match(new RegExp(`revoke all on function public\\.${fn}\\(([^)]*)\\)`));
  return m ? m[1].replace(/\s+/g, "") : null;
}
const REPLACED: Record<string, RegExp> = {
  comm_actor: /comm_workspace_blocked/,
  comm_can_read_at: /comm_workspace_members/,
  comm_active_profiles: /comm_workspace_blocked/,
  comm_open_direct: /comm_workspace_blocked/,
  comm_create_group: /members_can_create_groups/,
  comm_parse_mentions: /comm_workspace_blocked/,
  comm_my_conversations: /comm_workspace_blocked/,
  comm_directory: /comm_workspace_blocked/,
};
for (const [fn, clause] of Object.entries(REPLACED)) {
  const a = signature(m0737, fn);
  const b = signature(m0750, fn);
  check(a !== null && a === b, `${fn} keeps 0737's signature (${a}) — no second, unguarded overload`);
  const body = m0750.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`));
  check(!!body && clause.test(body[0]), `${fn} carries its workspace clause`);
}

check(/constraint uq_comm_workspace_singleton unique \(singleton\)/.test(m0750) && /check \(singleton\)/.test(m0750), "the workspace is a singleton by constraint, not by convention");
check(!/create policy [a-z_]+ on public\.comm_workspace(_members)?\s+for (insert|update|delete|all)/.test(m0750), "no write policy on either workspace table");

// ---------- 3. the screen's rule = the database's rule ----------

// Written from comm_workspace_admin_actor + comm_workspace_check_target:
// an active owner/admin; never themselves; never an ERP super admin; an admin
// may act on members only.
function expected(actorRole: WorkspaceRole, actorStatus: MemberStatus, self: boolean, targetRole: WorkspaceRole, erpOwner: boolean): boolean {
  if (actorStatus !== "active") return false;
  if (actorRole === "member") return false;
  if (self) return false;
  if (erpOwner) return false;
  if (actorRole === "admin" && targetRole !== "member") return false;
  return true;
}
let cases = 0;
let wrong = 0;
for (const ar of WORKSPACE_ROLES)
  for (const as of MEMBER_STATUSES)
    for (const self of [false, true])
      for (const tr of WORKSPACE_ROLES)
        for (const eo of [false, true]) {
          cases++;
          const got = canManage({ id: "A", role: ar, status: as }, { id: self ? "A" : "B", role: tr, erp_owner: eo });
          if (got !== expected(ar, as, self, tr, eo)) {
            wrong++;
            console.error(`      canManage(${ar}/${as}${self ? "/self" : ""} -> ${tr}${eo ? "/super" : ""}) = ${got}`);
          }
        }
check(wrong === 0, `canManage matches the database's rule on all ${cases} combinations`);
check(assignableRoles("owner").join() === "owner,admin,member", "an owner may hand out every role");
check(assignableRoles("admin").join() === "admin,member", "an admin may never make an owner");
check(assignableRoles("member").length === 0, "a member hands out nothing");
check(/if p_role = 'owner' and public\.comm_workspace_role\(v_me\) <> 'owner'/.test(m0750), "the database refuses an admin making an owner");
check(/if p_user = p_actor then/.test(m0750), "the database refuses a self-change");

// ---------- 4. inputs, colours, wiring ----------

const U = "aaaaaaaa-0000-4000-8000-000000000001";
check(workspaceSettingsInput.safeParse({ name: "Raagam", description: "", status: "active", members_can_create_groups: true }).success, "valid settings parse");
check(workspaceSettingsInput.safeParse({ name: "Raagam", description: "", status: "active", members_can_create_groups: true }).data?.description === null, "a blank description is stored as NULL");
check(!workspaceSettingsInput.safeParse({ name: "   ", description: null, status: "active", members_can_create_groups: true }).success, "a blank name is refused");
check(!workspaceSettingsInput.safeParse({ name: "x".repeat(81), description: null, status: "active", members_can_create_groups: true }).success, "a name over 80 is refused");
check(!workspaceSettingsInput.safeParse({ name: "Raagam", description: null, status: "archived", members_can_create_groups: true }).success, "an unknown status is refused");
check(setRoleInput.safeParse({ user_id: U, role: "admin" }).success, "a valid role change parses");
check(!setRoleInput.safeParse({ user_id: U, role: "guest" }).success, "there is no guest role");
check(!setRoleInput.safeParse({ user_id: "not-a-uuid", role: "admin" }).success, "a malformed member id is refused");
check(!setActiveInput.safeParse({ user_id: U, active: false, reason: "x".repeat(251) }).success, "a reason over 250 is refused");
check(setActiveInput.safeParse({ user_id: U, active: false }).data?.reason === null, "no reason is stored as NULL");

check(memberStatusTone("active") === "success", "Active is green, as everywhere");
check(memberStatusTone("deactivated") === "neutral" && memberStatusTone("account_inactive") === "neutral", "a deactivated / inactive login is neutral, like Inactive");
check(memberStatusTone("no_access") === "warning" && memberStatusTone("suspended") === "warning", "No access and Paused are warnings — something to fix");

const nav = read("components/shell/nav.ts");
check(/href: "\/comms\/people"/.test(nav) && /href: "\/comms\/workspace"/.test(nav), "People and Workspace are in the hub's nav group");
check(existsSync(resolve(root, "app/(app)/comms/people/page.tsx")) && existsSync(resolve(root, "app/(app)/comms/workspace/page.tsx")), "both screens have a page");
const layout = read("app/(app)/comms/layout.tsx");
check(/my_status === "deactivated"/.test(layout) && /WorkspaceDeactivated/.test(layout), "the hub layout explains a deactivation instead of drawing an empty inbox");
const dir = read("components/comms/people-directory.tsx");
check(/canManage\(/.test(dir) && /\{manageable && \(/.test(dir), "the profile's admin controls are drawn only where canManage allows");

if (failures > 0) {
  console.error(`\ncheck:comms-workspace — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms-workspace — all assertions passed");
