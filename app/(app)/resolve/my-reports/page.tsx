import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRh } from "@/lib/resolve/auth";
import { listMyReports } from "@/lib/resolve/service";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { MyReportsClient } from "./my-reports-client";

/** Everything I reported or joined, any unit — the reporter's own register. */
export default async function MyReportsPage() {
  await requireRh("view");
  const rows = await listMyReports();
  // The server's clock, read once — "due in / late" is worded against it.
  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Reports"
        actions={
          <Link href="/resolve/report" className={buttonClasses({ variant: "primary" })}>
            <Plus className="h-4 w-4" aria-hidden />
            Report a problem
          </Link>
        }
      />
      <MyReportsClient rows={rows} nowIso={nowIso} />
    </div>
  );
}
