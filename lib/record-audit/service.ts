import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AuditFilters, RecordAudit, RecordAuditRow } from "./types";

const DEFAULT_PAGE_SIZE = 50;

type RawRow = RecordAudit & {
  profiles: { full_name: string | null; email: string | null } | null;
};

function flatten(raw: RawRow[]): RecordAuditRow[] {
  return raw.map((r) => ({
    ...r,
    actor_name: r.profiles?.full_name ?? null,
    actor_email: r.profiles?.email ?? null,
  }));
}

/** Paginated, filterable change log (RLS-gated to system_admin readers). */
export async function listRecordAudit(filters: AuditFilters = {}): Promise<{
  rows: RecordAuditRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}> {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;

  let q = supabase
    .from("record_audit")
    .select("*, profiles:actor_id(full_name, email)")
    .order("created_at", { ascending: false })
    .range(from, from + pageSize); // +1 extra row to detect hasMore

  if (filters.table) q = q.eq("table_name", filters.table);
  if (filters.operation) q = q.eq("operation", filters.operation);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);

  const { data } = await q;
  const raw = (data ?? []) as unknown as RawRow[];
  const hasMore = raw.length > pageSize;
  return { rows: flatten(raw.slice(0, pageSize)), page, pageSize, hasMore };
}

/** Full change history for a single record — for the per-record History view. */
export async function getRecordHistory(
  tableName: string,
  recordId: string,
  limit = 50,
): Promise<RecordAuditRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("record_audit")
    .select("*, profiles:actor_id(full_name, email)")
    .eq("table_name", tableName)
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return flatten((data ?? []) as unknown as RawRow[]);
}
