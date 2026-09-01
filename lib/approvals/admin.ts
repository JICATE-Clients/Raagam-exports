import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * What the flow builder needs that the engine deliberately does not supply.
 *
 * `FlowBuilder` in the skill "does not query roles or users — the page passes
 * `roleOptions` and `userOptions`, because only the host knows where its roles
 * live." That is the same boundary the RBAC shim draws in SQL, held on the
 * TypeScript side: the engine names a role by key and never learns what a role
 * IS.
 */

export type RoleOption = {
  name: string;
  /**
   * HOW MANY PEOPLE COULD ACTUALLY ACT — and the skill is explicit that "the
   * zero-holder warning is the highest-value thing in that screen."
   *
   * A step routed to a role nobody holds is a run that strands at that step:
   * in nobody's queue, raising no error, chased by no one. `approval_start_run`
   * refuses to create such a run, which is the right backstop — but a backstop
   * that fires the first time somebody submits a budget at month end is a worse
   * place to learn than a number beside the picker.
   *
   * COUNTED THROUGH THE SHIM, NOT THROUGH `user_roles`. `approval_rbac_users_with_role`
   * is the same predicate the queue and the gate both use, so it already
   * excludes deactivated users and super admins. Counting the grant rows
   * directly would report 3 holders for a role held by three people who have all
   * left, which is exactly the reassurance that gets believed.
   */
  holderCount: number;
};

export async function listRoleOptions(): Promise<RoleOption[]> {
  const s = await createClient();

  const { data: roles } = await s.from("roles").select("name").order("name");
  const names = ((roles ?? []) as { name: string }[]).map((r) => r.name);
  if (names.length === 0) return [];

  /**
   * ONE ROUND TRIP PER ROLE, and that is acceptable HERE and nowhere else.
   *
   * Raagam has four roles. This screen is opened by an administrator, rarely.
   * The alternative — a bespoke SQL function that counts every role at once —
   * would be a SECOND implementation of "who holds this role", which is the
   * precise mistake the skill records: in the source system that question was
   * implemented twice and the two copies silently disagreed. One slow correct
   * answer beats two fast ones that differ.
   */
  const counts = await Promise.all(
    names.map(async (name) => {
      const { data } = await s.rpc("approval_rbac_users_with_role", {
        p_role_key: name,
        p_scope: {},
      });
      return { name, holderCount: Array.isArray(data) ? data.length : 0 };
    }),
  );

  return counts;
}
