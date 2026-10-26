import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRh } from "@/lib/resolve/auth";
import { getAppUser } from "@/lib/auth/server";
import { loadMyRequests } from "@/lib/resolve/inbox-service";
import { getTicketDetail } from "@/lib/resolve/service";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { InboxScreen } from "@/components/resolve/inbox/inbox-screen";

/**
 * Everything I raised — any lane, any unit — on the same two-pane screen the
 * resolver works from, seen from the other side (2026-10-26). What waits on
 * my tap (confirm, reopen, rate) is listed first and opened first. Named
 * complaints joined it, so My Complaints now lands here.
 */
export default async function MyReportsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  await requireRh("view");
  const user = await getAppUser();
  const [{ t }, lists] = await Promise.all([searchParams, loadMyRequests()]);
  const firstId = t ?? (lists.turn[0] ?? lists.open[0] ?? lists.done[0])?.id ?? null;
  const initial = firstId ? await getTicketDetail(firstId) : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="My Reports"
        actions={
          <Link href="/resolve/report" className={buttonClasses({ variant: "primary" })}>
            <Plus className="h-4 w-4" aria-hidden />
            Report a problem
          </Link>
        }
      />
      <InboxScreen mode="raiser" lists={lists} meId={user?.id ?? ""} initial={initial} />
    </div>
  );
}
