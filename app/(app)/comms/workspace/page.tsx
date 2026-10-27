import { requirePermission } from "@/lib/auth/server";
import { getWorkspace } from "@/lib/comms/workspace-service";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";
import { WorkspaceSettings } from "@/components/comms/workspace-settings";

/**
 * Workspace settings (0750). Every active member may read them; only owners
 * and admins get controls, and the RPC re-checks that on every save.
 */
export default async function WorkspacePage() {
  const [, workspace] = await Promise.all([requirePermission("communication", "view"), getWorkspace()]);
  if (!workspace) return <CommsNotInstalled migrations={["supabase/migrations/0750_comms_workspace.sql"]} />;
  return <WorkspaceSettings key={workspace.updated_at} workspace={workspace} />;
}
