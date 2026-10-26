import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { InboxScreen } from "@/components/resolve/inbox/inbox-screen";
import { loadInbox } from "@/lib/resolve/inbox-service";
import { getTicketDetail } from "@/lib/resolve/service";

/**
 * RESOLVE INBOX — every ticket the operator works, in one list, whatever its
 * lane (Fix · IT · Buy · Concern). It replaced My Work and Requirements
 * (2026-10-26), whose URLs now land here.
 *
 * `requireUser`, not a permission gate: a complaint handler is named per
 * CATEGORY, not by a role, and RLS decides every row this list holds. A person
 * with nothing to work sees an empty Mine, which says so.
 *
 * `?t=<ticket id>` opens that ticket in the pane (the notification links can
 * use it); otherwise the first, most urgent row is opened.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const user = await requireUser();
  const [{ t }, lists] = await Promise.all([searchParams, loadInbox()]);
  const firstId = t ?? (lists.mine[0] ?? lists.take[0] ?? lists.wait[0])?.id ?? null;
  const initial = firstId ? await getTicketDetail(firstId) : null;
  return (
    <div className="space-y-3">
      <PageHeader title="Inbox" />
      <InboxScreen mode="resolver" lists={lists} meId={user.id} initial={initial} />
    </div>
  );
}
