import { can, requirePermission } from "@/lib/auth/server";
import { listDepartments } from "@/lib/comms/service";
import { discoverChannels } from "@/lib/comms/channel-service";
import { getWorkspace } from "@/lib/comms/workspace-service";
import { isAdminRole } from "@/lib/comms/workspace";
import { isCommsMissing } from "@/lib/comms/service";
import { ChannelBrowser } from "@/components/comms/channel-browser";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";

/**
 * Channel discovery (0751). The first page of active channels comes with the
 * route; search, the Archived filter and "Load more" go through
 * `comm_discover_channels()`. A channel may be created by a holder of
 * communication:create OR a workspace owner / admin (0750) — the same two
 * halves `comm_create_channel` checks. `?create=1` opens the create sheet
 * (the sidebar's "New channel").
 */
export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  await requirePermission("communication", "view");
  let loaded;
  try {
    loaded = await Promise.all([discoverChannels(null, "active", 0), can("communication", "create"), getWorkspace(), searchParams]);
  } catch (e) {
    // Discovery is 0751's; until it is applied the page says so (0737's rule).
    if (isCommsMissing(e)) return <CommsNotInstalled migrations={["supabase/migrations/0751_comms_channel_management.sql"]} />;
    throw e;
  }
  const [first, mayCreate, workspace, sp] = loaded;
  const canCreate = mayCreate || isAdminRole(workspace?.my_role);
  const departments = canCreate ? await listDepartments() : [];
  return (
    <ChannelBrowser
      key={sp.create ?? ""}
      initial={first.rows}
      initialTotal={first.total}
      departments={departments}
      canCreate={canCreate}
      openCreate={sp.create === "1"}
    />
  );
}
