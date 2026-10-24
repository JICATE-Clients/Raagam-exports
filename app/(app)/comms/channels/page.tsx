import { can, requirePermission } from "@/lib/auth/server";
import { listChannels, listDepartments } from "@/lib/comms/service";
import { ChannelBrowser } from "@/components/comms/channel-browser";

/** Browse channels; create one with communication:create. */
export default async function ChannelsPage() {
  await requirePermission("communication", "view");
  const [channels, canCreate] = await Promise.all([listChannels(), can("communication", "create")]);
  const departments = canCreate ? await listDepartments() : [];
  return <ChannelBrowser channels={channels} departments={departments} canCreate={canCreate} />;
}
