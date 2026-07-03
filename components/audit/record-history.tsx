import { can } from "@/lib/auth/server";
import { getRecordHistory } from "@/lib/record-audit/service";
import { AuditList } from "./audit-list";

/**
 * Per-record change history (who/when/previous-values), admin-gated. Drop into
 * any Server Component detail page:  <RecordHistory table="sales_orders" recordId={order.id} />
 * Renders nothing for users without system_admin:view.
 */
export async function RecordHistory({
  table,
  recordId,
}: {
  table: string;
  recordId: string;
}) {
  if (!(await can("system_admin", "view"))) return null;
  const rows = await getRecordHistory(table, recordId);
  return <AuditList rows={rows} showRecord={false} />;
}
