import type { ReactNode } from "react";
import { requirePermission } from "@/lib/auth/server";
import { isCommsMissing, listMyConversations } from "@/lib/comms/service";
import type { ConversationSummary } from "@/lib/comms/types";
import { CommsShell } from "@/components/comms/comms-shell";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";

/**
 * Communication Hub frame (doc/slack.md/slack §4, 0737).
 *
 * `communication:view` is the ROUTE guard — the same permission that puts the
 * row in the sidebar and that every write RPC asks (comm_actor). It is not the
 * conversation guard: what a person reads inside is decided by membership in
 * the database, so a guessed conversation URL renders "not found", not a stream.
 *
 * Before 0737 is applied the hub says so instead of crashing; `children` is
 * not rendered then, so no page below reaches the missing functions.
 */
export default async function CommsLayout({ children }: { children: ReactNode }) {
  await requirePermission("communication", "view");
  let conversations: ConversationSummary[];
  try {
    conversations = await listMyConversations();
  } catch (e) {
    if (isCommsMissing(e)) return <CommsNotInstalled />;
    throw e;
  }
  return <CommsShell conversations={conversations}>{children}</CommsShell>;
}
