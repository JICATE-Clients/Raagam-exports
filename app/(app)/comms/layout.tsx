import type { ReactNode } from "react";
import { requirePermission } from "@/lib/auth/server";
import { isCommsMissing, listMyConversations } from "@/lib/comms/service";
import { getWorkspace } from "@/lib/comms/workspace-service";
import type { Workspace } from "@/lib/comms/workspace";
import { CommsShell } from "@/components/comms/comms-shell";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";
import { WorkspaceBar, WorkspaceDeactivated } from "@/components/comms/workspace-bar";

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
 *
 * THE WORKSPACE (0750) is read once here. Before 0750 is applied it is null and
 * the hub works exactly as it did, without the workspace bar. A person a
 * workspace admin DEACTIVATED gets the reason instead of the hub — the database
 * already refuses them every read and write, so this is the explanation, not
 * the guard.
 */
export default async function CommsLayout({ children }: { children: ReactNode }) {
  await requirePermission("communication", "view");
  // The same call Chats makes — `cache()` in the service answers both with one
  // RPC — so a missing 0737 is caught here, before any page reaches it.
  let workspace: Workspace | null;
  let chats: Awaited<ReturnType<typeof listMyConversations>>;
  try {
    [chats, workspace] = await Promise.all([listMyConversations(), getWorkspace()]);
  } catch (e) {
    if (isCommsMissing(e)) return <CommsNotInstalled />;
    throw e;
  }
  if (workspace?.my_status === "deactivated") return <WorkspaceDeactivated workspace={workspace} />;
  // `chats` feeds Pulse's list pane (comms-shell.tsx, "PULSE IS TWO PANES").
  return (
    <CommsShell top={workspace ? <WorkspaceBar workspace={workspace} /> : null} chats={chats}>
      {children}
    </CommsShell>
  );
}
