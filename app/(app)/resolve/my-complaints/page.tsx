import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRh } from "@/lib/resolve/auth";
import { listMyComplaints } from "@/lib/resolve/service";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { MyComplaintsClient } from "./my-complaints-client";

/**
 * Complaints I sent WITH my name. Anonymous ones are deliberately absent —
 * nothing links them to me (plan §10.2); they are followed by their link.
 */
export default async function MyComplaintsPage() {
  await requireRh("view");
  const rows = await listMyComplaints();
  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Complaints"
        actions={
          <Link href="/resolve/report/complaint" className={buttonClasses({ variant: "primary" })}>
            <Plus className="h-4 w-4" aria-hidden />
            Make a complaint
          </Link>
        }
      />
      <MyComplaintsClient rows={rows} nowIso={nowIso} />
    </div>
  );
}
