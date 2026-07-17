import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RateAmendedItemRow } from "./types";

// ============================================================================
// Rate Detail for Amended Items (Planning ▸ Materials-Garment Orders ▸ "Rate
// detail for amended items"). A read-only register of items whose rate was
// formally amended, unioned from the two rate-amendment documents that carry an
// old→new rate history: PO rate amendments (0037) and Process rate amendments
// (0112). Garmenting-PPM rate amendments are edited in place on
// ppm_issue_lines.rate with no history table, so they are not represented here.
// The underlying tables' own RLS (materials_purchase / process_planning) still
// applies — a planner without those permissions simply sees the rows they can.
// ============================================================================

function joinedField(row: Record<string, unknown>, rel: string, field: string): string | null {
  const r = row[rel] as Record<string, unknown> | null;
  return (r?.[field] as string | null) ?? null;
}

export async function listRateAmendedItems(): Promise<RateAmendedItemRow[]> {
  const s = await createClient();

  const [poRes, procRes] = await Promise.all([
    s
      .from("po_rate_amendments")
      .select("id, code, previous_rate, revised_rate, reason, status, approved_at, po_line_items(description, items(name))")
      .order("created_at", { ascending: false }),
    s
      .from("process_rate_amendments")
      .select("id, code, old_rate, new_rate, reason, status, decided_at, process_rfqs(code, description, process_type)")
      .order("created_at", { ascending: false }),
  ]);

  const poRows: RateAmendedItemRow[] = ((poRes.data ?? []) as Record<string, unknown>[]).map(
    (row) => {
      const line = row.po_line_items as Record<string, unknown> | null;
      const itemName = joinedField(line ?? {}, "items", "name");
      const desc = (line?.description as string | null) ?? null;
      return {
        id: row.id as string,
        source: "PO",
        doc_code: (row.code as string | null) ?? null,
        item_label: itemName ?? desc ?? "—",
        previous_rate: (row.previous_rate as number | null) ?? 0,
        revised_rate: (row.revised_rate as number | null) ?? 0,
        reason: (row.reason as string | null) ?? null,
        status: (row.status as string) ?? "",
        decided_at: (row.approved_at as string | null) ?? null,
      };
    },
  );

  const procRows: RateAmendedItemRow[] = ((procRes.data ?? []) as Record<string, unknown>[]).map(
    (row) => {
      const rfqCode = joinedField(row, "process_rfqs", "code");
      const rfqDesc = joinedField(row, "process_rfqs", "description");
      const rfqType = joinedField(row, "process_rfqs", "process_type");
      return {
        id: row.id as string,
        source: "Process",
        doc_code: (row.code as string | null) ?? null,
        item_label: [rfqCode, rfqDesc ?? rfqType].filter(Boolean).join(" · ") || "—",
        previous_rate: (row.old_rate as number | null) ?? 0,
        revised_rate: (row.new_rate as number | null) ?? 0,
        reason: (row.reason as string | null) ?? null,
        status: (row.status as string) ?? "",
        decided_at: (row.decided_at as string | null) ?? null,
      };
    },
  );

  return [...poRows, ...procRows].sort((a, b) => {
    const at = a.decided_at ?? "";
    const bt = b.decided_at ?? "";
    return bt.localeCompare(at);
  });
}
