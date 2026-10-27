import { z } from "zod";
import { statusTone, type StatusTone, type StatusToneOverrides } from "../ui/status-tone";

// ============================================================================
// Communication Hub — the workspace and its members (0750).
//
// One workspace per company (this ERP is single-tenant: one company, three
// units). Membership is the ERP's own — an active login holding
// `communication:view` — and `comm_workspace_members` only records the people
// treated differently: an owner / admin role, or a deactivation. An ERP super
// admin is always an owner.
//
// Pure: no server import, so the screens, the server actions and
// scripts/check-comms-workspace.mts read the same rules. The DATABASE is the
// guard (comm_workspace_check_target / _set_role / _set_active); `canManage`
// below only decides which buttons to draw, and the checker asserts the two
// agree on every combination.
// ============================================================================

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** `comm_workspace_status()` — the ERP account first, then the hub's own switch. */
export const MEMBER_STATUSES = ["active", "deactivated", "no_access", "account_inactive"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_FILTERS = ["active", "deactivated", "no_access", "account_inactive", "all"] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];

export const WORKSPACE_STATUSES = ["active", "suspended"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/** Mirrors `chk_comm_workspace_name` / `_desc` and the update RPC. */
export const WORKSPACE_NAME_MAX = 80;
export const WORKSPACE_DESC_MAX = 250;
export const DEACTIVATE_REASON_MAX = 250;

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  status: WorkspaceStatus;
  members_can_create_groups: boolean;
  company_name: string | null;
  created_at: string;
  updated_at: string;
  my_role: WorkspaceRole;
  my_status: MemberStatus;
}

export interface WorkspacePerson {
  id: string;
  full_name: string | null;
  employee_code: string | null;
  designation: string | null;
  department: string | null;
  role: WorkspaceRole;
  status: MemberStatus;
  member_since: string;
  /** Administrators only — NULL for an ordinary member's read. */
  deactivated_at: string | null;
  deactivated_by_name: string | null;
  deactivated_reason: string | null;
  /** Administrators only: an ERP super admin, an owner nobody here can change. */
  erp_owner: boolean | null;
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  deactivated: "Deactivated",
  no_access: "No access",
  account_inactive: "Login inactive",
};

export const FILTER_LABEL: Record<MemberFilter, string> = {
  active: "Active",
  deactivated: "Deactivated",
  no_access: "No access",
  account_inactive: "Login inactive",
  all: "All",
};

/** What each non-active status means, said where an admin reads it. */
export const STATUS_HINT: Record<MemberStatus, string> = {
  active: "Can use Messages.",
  deactivated: "Switched off in this workspace. Their messages stay, under their name.",
  no_access: "Their ERP role does not include Messages. Change it in Users & Access.",
  account_inactive: "Their ERP login is switched off in Users & Access.",
};

/**
 * Workspace member statuses on the app's one colour table. Named, because two
 * words here are this screen's own: a hub deactivation is retired (neutral,
 * like Inactive), while "no access" is a setting someone may need to fix.
 */
export const MEMBER_STATUS_TONES: StatusToneOverrides = {
  deactivated: "neutral",
  no_access: "warning",
  account_inactive: "neutral",
  suspended: "warning",
};

export function memberStatusTone(status: MemberStatus | WorkspaceStatus): StatusTone {
  return statusTone(status, MEMBER_STATUS_TONES);
}

export const isAdminRole = (r: WorkspaceRole | null | undefined): boolean => r === "owner" || r === "admin";

/**
 * May `actor` change `target`'s role or access at all? The same three refusals
 * as `comm_workspace_check_target()` — never yourself, never a super admin
 * (shown as an owner who is not editable), and an admin manages members only.
 */
export function canManage(
  actor: { id: string; role: WorkspaceRole; status: MemberStatus },
  target: { id: string; role: WorkspaceRole; erp_owner?: boolean | null },
): boolean {
  if (actor.status !== "active" || !isAdminRole(actor.role)) return false;
  if (actor.id === target.id || target.erp_owner) return false;
  if (isAdminRole(target.role) && actor.role !== "owner") return false;
  return true;
}

/** Roles `actor` may hand out — an owner hands out any, an admin never Owner. */
export function assignableRoles(actorRole: WorkspaceRole): WorkspaceRole[] {
  if (actorRole === "owner") return [...WORKSPACE_ROLES];
  if (actorRole === "admin") return ["admin", "member"];
  return [];
}

// ---------------------------------------------------------------------------
// Inputs (Zod at the door; the RPC re-checks everything)
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();

export const workspaceSettingsInput = z.object({
  name: z.string().trim().min(1, "The workspace needs a name.").max(WORKSPACE_NAME_MAX),
  description: z
    .string()
    .trim()
    .max(WORKSPACE_DESC_MAX)
    .nullable()
    .transform((v) => (v ? v : null)),
  status: z.enum(WORKSPACE_STATUSES),
  members_can_create_groups: z.boolean(),
});
export type WorkspaceSettingsInput = z.input<typeof workspaceSettingsInput>;

export const setRoleInput = z.object({ user_id: uuid, role: z.enum(WORKSPACE_ROLES) });
export type SetRoleInput = z.infer<typeof setRoleInput>;

export const setActiveInput = z.object({
  user_id: uuid,
  active: z.boolean(),
  reason: z
    .string()
    .trim()
    .max(DEACTIVATE_REASON_MAX)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});
export type SetActiveInput = z.input<typeof setActiveInput>;

export const peopleQueryInput = z.object({
  q: z.string().trim().max(80).nullable().optional(),
  status: z.enum(MEMBER_FILTERS).default("active"),
});
