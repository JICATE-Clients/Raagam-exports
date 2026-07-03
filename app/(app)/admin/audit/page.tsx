import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listRecordAudit } from "@/lib/record-audit/service";
import type { AuditOperation } from "@/lib/record-audit/types";
import { AuditBrowser } from "./audit-client";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("system_admin", "view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const { rows, hasMore } = await listRecordAudit({
    table: sp.table || undefined,
    operation: (sp.op as AuditOperation) || undefined,
    from: sp.from || undefined,
    // make the "to" date inclusive of the whole day
    to: sp.to ? `${sp.to}T23:59:59` : undefined,
    page,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        description="Every change to key records — who made it, when, and the previous → new values."
      />
      <AuditBrowser
        rows={rows}
        page={page}
        hasMore={hasMore}
        current={{
          table: sp.table ?? "",
          op: sp.op ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />
    </div>
  );
}
