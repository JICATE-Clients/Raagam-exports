import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getCommunity } from "@/lib/comms/community-service";
import { CommunityView } from "@/components/comms/community-view";

/**
 * One community (0775). `getCommunity` answers only for a community the caller
 * is in, so a guessed id renders not-found — the same rule a conversation URL
 * follows. Drawn beside Pulse's list (comms-shell.tsx, "PULSE IS TWO PANES").
 *
 * `key={id}`: switching communities remounts the view, so an open sheet or a
 * half-picked list never carries over.
 */
export default async function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }] = await Promise.all([params, requirePermission("communication", "view")]);
  const community = await getCommunity(id);
  if (!community) notFound();
  return <CommunityView key={id} community={community} />;
}
