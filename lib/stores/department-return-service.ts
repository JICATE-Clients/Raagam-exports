import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";
import type {
  DepartmentReturn,
  DepartmentReturnLine,
  ReturnableMrs,
  ReturnableMrsLine,
} from "./department-return-types";

export interface DepartmentReturnRow extends DepartmentReturn {
  store_name: string | null;
  mrs_code: string | null;
  line_count: number;
  total_qty: number;
}

/** A bin a returned line can be put in: the working unit's own plus the shared ones. */
export type ReturnBinOption = { id: string; code: string; description: string | null; inactive?: boolean; store_id: string | null };

type ListRaw = DepartmentReturn & {
  stores: { name: string | null } | null;
  material_requisitions: { code: string | null } | null;
  department_return_lines: { return_qty: number }[] | null;
};

export async function listDepartmentReturns(): Promise<DepartmentReturnRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("department_returns")
    .select("*, stores(name), material_requisitions(code), department_return_lines(return_qty)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22).
    .order("created_at", { ascending: true });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (error) throw new Error(`Department returns: ${error.message}`);
  return withCreators(
    ((data ?? []) as unknown as ListRaw[]).map(({ stores, material_requisitions, department_return_lines, ...r }) => ({
      ...r,
      store_name: stores?.name ?? null,
      mrs_code: material_requisitions?.code ?? null,
      line_count: department_return_lines?.length ?? 0,
      total_qty: (department_return_lines ?? []).reduce((t, l) => t + (Number(l.return_qty) || 0), 0),
    })),
  );
}

export async function getDepartmentReturn(
  id: string,
): Promise<{ doc: DepartmentReturn; lines: DepartmentReturnLine[] } | null> {
  const s = await createClient();
  const [docRes, linesRes] = await Promise.all([
    s.from("department_returns").select("*").eq("id", id).maybeSingle(),
    s.from("department_return_lines").select("*, items(name), bins(bin_code)").eq("return_id", id).order("sort_order"),
  ]);
  if (docRes.error) throw new Error(`Department return: ${docRes.error.message}`);
  if (linesRes.error) throw new Error(`Department return lines: ${linesRes.error.message}`);
  if (!docRes.data) return null;
  type LineRaw = DepartmentReturnLine & { items: { name: string } | null; bins: { bin_code: string } | null };
  return {
    doc: docRes.data as DepartmentReturn,
    lines: ((linesRes.data ?? []) as unknown as LineRaw[]).map(({ items, bins, ...l }) => ({
      ...l,
      return_qty: Number(l.return_qty) || 0,
      item_name: items?.name ?? null,
      bin_code: bins?.bin_code ?? null,
    })),
  };
}

type MrsRaw = {
  id: string;
  code: string | null;
  store_id: string;
  department: string;
  required_date: string | null;
  stores: { name: string | null } | null;
  material_requisition_lines:
    | { id: string; item_id: string; issued_qty: number; sort_order: number; items: { name: string; code: string | null } | null }[]
    | null;
};

/**
 * THE ISSUED REQUISITIONS a return can be raised against, each with its lines and
 * what is still returnable on them. `includeId` keeps the MRS an existing return
 * already names (it stays issued, but is listed even if fully returned since).
 *
 * "Returned" counts POSTED returns only — a draft has moved no stock. The post
 * function re-checks the same sum with the MRS locked, so this is the screen's
 * courtesy, not the guard.
 */
export async function getReturnableRequisitions(includeId?: string | null): Promise<ReturnableMrs[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("material_requisitions")
    .select(
      "id, code, store_id, department, required_date, stores(name), material_requisition_lines(id, item_id, issued_qty, sort_order, items(name, code))",
    )
    .eq("status", "issued")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Issued requisitions: ${error.message}`);
  const mrs = (data ?? []) as unknown as MrsRaw[];

  const lineIds = mrs.flatMap((m) => (m.material_requisition_lines ?? []).map((l) => l.id));
  const returned = new Map<string, number>();
  if (lineIds.length) {
    const { data: posted, error: pErr } = await s
      .from("department_return_lines")
      .select("mrs_line_id, return_qty, department_returns!inner(status)")
      .eq("department_returns.status", "posted")
      .in("mrs_line_id", lineIds);
    if (pErr) throw new Error(`Posted returns: ${pErr.message}`);
    for (const p of (posted ?? []) as { mrs_line_id: string; return_qty: number }[]) {
      returned.set(p.mrs_line_id, (returned.get(p.mrs_line_id) ?? 0) + (Number(p.return_qty) || 0));
    }
  }

  return mrs
    .map((m) => {
      const lines: ReturnableMrsLine[] = [...(m.material_requisition_lines ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => {
          const issued = Number(l.issued_qty) || 0;
          const back = returned.get(l.id) ?? 0;
          return {
            mrs_line_id: l.id,
            item_id: l.item_id,
            item_name: l.items?.name ?? "—",
            item_code: l.items?.code ?? null,
            issued_qty: issued,
            returned_qty: back,
            returnable_qty: Math.max(0, issued - back),
          };
        });
      return {
        id: m.id,
        code: m.code,
        store_id: m.store_id,
        store_name: m.stores?.name ?? null,
        department: m.department,
        required_date: m.required_date,
        lines,
      };
    })
    .filter((m) => m.id === includeId || m.lines.some((l) => l.returnable_qty > 0));
}

/** The working unit's bins (and the shared ones) — the Bin box on a returned line. */
export async function getReturnBins(): Promise<ReturnBinOption[]> {
  const s = await createClient();
  const { location } = await getCurrentLocation();
  if (!location) return [];
  const { data, error } = await s
    .from("bins")
    .select("id, bin_code, description, inactive, store_id")
    .or(`location_id.eq.${location.id},location_id.is.null`)
    .order("bin_code");
  if (error) throw new Error(`Bins: ${error.message}`);
  return ((data ?? []) as { id: string; bin_code: string; description: string | null; inactive: boolean | null; store_id: string | null }[]).map(
    (b) => ({ id: b.id, code: b.bin_code, description: b.description, inactive: !!b.inactive, store_id: b.store_id }),
  );
}
