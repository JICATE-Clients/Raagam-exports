import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listFlows } from "@/lib/approvals/service";
import { listRoleOptions, type RoleOption } from "@/lib/approvals/admin";
import type { ApprovalFlow } from "@/lib/approvals/types";
import { PO_WORKFLOW } from "./po-routing-model";

export type ItemClassOption = { code: string; name: string };

/**
 * What Purchase ▸ PO Approval Routing reads: every purchase_order flow (active or
 * not — a retired name is switched back on rather than duplicated), the roles with
 * their holder counts, and the item classes — from the master, so a class added
 * there appears here without a code change.
 */
export async function getPoRoutingData(): Promise<{
  flows: ApprovalFlow[];
  roles: RoleOption[];
  classes: ItemClassOption[];
}> {
  const s = await createClient();
  const [flows, roles, cls] = await Promise.all([
    listFlows(PO_WORKFLOW),
    listRoleOptions(),
    s.from("config_lookups").select("code, name").eq("kind", "item_class").eq("is_active", true).order("name"),
  ]);
  if (cls.error) throw new Error(`Item classes could not be read: ${cls.error.message}`);
  const classes = ((cls.data ?? []) as { code: string | null; name: string }[])
    .filter((c): c is ItemClassOption => !!c.code)
    .map((c) => ({ code: c.code, name: c.name }));
  return { flows, roles, classes };
}
