import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { MEMBER_FILTERS, type MemberFilter } from "@/lib/comms/workspace";
import { WorkspaceDenied, getWorkspace, listPeople } from "@/lib/comms/workspace-service";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";
import { PeopleDirectory } from "@/components/comms/people-directory";
import { WorkspaceForbidden } from "@/components/comms/workspace-forbidden";

/**
 * The workspace's people (0750). `communication:view` is the route guard; the
 * RPC decides what this caller may list — an ordinary member asking for
 * ?status=deactivated is refused by the database, and lands back on the
 * active list rather than on an error page.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const [user, workspace, sp] = await Promise.all([requirePermission("communication", "view"), getWorkspace(), searchParams]);
  if (!workspace) return <CommsNotInstalled migrations={["supabase/migrations/0750_comms_workspace.sql"]} />;

  const q = (sp.q ?? "").trim().slice(0, 80);
  const status: MemberFilter = (MEMBER_FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as MemberFilter) : "active";
  let listed: Awaited<ReturnType<typeof listPeople>>;
  try {
    listed = await listPeople(q || null, status);
  } catch (e) {
    if (!(e instanceof WorkspaceDenied)) throw e;
    if (status !== "active") redirect(q ? `/comms/people?q=${encodeURIComponent(q)}` : "/comms/people");
    return <WorkspaceForbidden title="People" message={e.message} />;
  }
  return <PeopleDirectory workspace={workspace} meId={user.id} people={listed.rows} total={listed.total} q={q} status={status} />;
}
