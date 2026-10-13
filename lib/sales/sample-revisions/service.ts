import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getSampleCostingRecord } from "@/lib/sales/sample-costing/service";
import { summaryOf } from "@/lib/sales/sample-costing/types";
import type { CostingKpis, CostingPair, RaisableSample, RevisionKind, RevisionOrigin, RevisionStatus, SampleRevisionRow } from "./types";

/**
 * Sample ▸ Revision — every read (0716). Listings in ENTRY order.
 */

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type RevDb = {
  id: string;
  revision_code: string;
  revision_no: number;
  opportunity_id: string;
  origin: RevisionOrigin;
  kinds: RevisionKind[];
  remarks: string;
  status: RevisionStatus;
  costing_pairs: CostingPair[] | null;
  v0_kpis: CostingKpis[] | null;
  proposed_kpis: CostingKpis[] | null;
  decision_remark: string | null;
  revert_error: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string;
  created_by: string | null;
  opp: One<{ code: string | null; title: string | null; customer: One<{ name: string | null }>; styles: { sno: number | null; name: string | null }[] | null }>;
};

const REV_SELECT =
  "id, revision_code, revision_no, opportunity_id, origin, kinds, remarks, status, costing_pairs, v0_kpis, proposed_kpis, " +
  "decision_remark, revert_error, submitted_at, decided_at, created_at, created_by, " +
  "opp:opportunities!opportunity_id(code, title, customer:customers!customer_id(name), styles(sno, name))";

const toRow = (r: RevDb): SampleRevisionRow => {
  const o = one(r.opp);
  return {
    id: r.id,
    revision_code: r.revision_code,
    revision_no: r.revision_no,
    opportunity_id: r.opportunity_id,
    smp_no: o?.code ?? null,
    customer_name: one(o?.customer ?? null)?.name ?? o?.title ?? null,
    style_names: [...(o?.styles ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0)).map((s) => s.name ?? "").filter(Boolean),
    origin: r.origin,
    kinds: r.kinds,
    remarks: r.remarks,
    status: r.status,
    costing_pairs: r.costing_pairs ?? [],
    v0_kpis: r.v0_kpis,
    proposed_kpis: r.proposed_kpis,
    decision_remark: r.decision_remark,
    revert_error: r.revert_error,
    submitted_at: r.submitted_at,
    decided_at: r.decided_at,
    created_at: r.created_at,
    created_by: r.created_by,
  };
};

export async function listSampleRevisions(): Promise<SampleRevisionRow[]> {
  const s = await createClient();
  const { data, error } = await s.from("sample_revisions").select(REV_SELECT).order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load sample revisions: ${error.message}`);
  return withCreators(((data ?? []) as unknown as RevDb[]).map(toRow));
}

export async function getSampleRevision(id: string): Promise<SampleRevisionRow | null> {
  const s = await createClient();
  const { data, error } = await s.from("sample_revisions").select(REV_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the sample revision: ${error.message}`);
  if (!data) return null;
  const [row] = await withCreators([toRow(data as unknown as RevDb)]);
  return row;
}

/**
 * THE SAMPLES A REVISION CAN BE RAISED ON — locked ones: a saved entry with an
 * approved sample costing and no open revision. An unapproved sample is edited
 * directly, so it is not offered.
 */
export async function listRaisableSamples(): Promise<RaisableSample[]> {
  const s = await createClient();
  const [opps, sheets, open] = await Promise.all([
    s
      .from("opportunities")
      .select("id, code, title, is_draft, customer:customers!customer_id(name), styles(sno, name)")
      .eq("is_draft", false)
      .order("created_at", { ascending: true }),
    s.from("cost_sheets").select("opportunity_id").eq("costing_type", "sample").eq("status", "approved"),
    s.from("sample_revisions").select("opportunity_id").in("status", ["draft", "pending"]),
  ]);
  if (opps.error) throw new Error(`Could not load samples: ${opps.error.message}`);
  if (sheets.error) throw new Error(`Could not load sample costings: ${sheets.error.message}`);
  if (open.error) throw new Error(`Could not load sample revisions: ${open.error.message}`);
  const approved = new Set((sheets.data ?? []).map((r) => r.opportunity_id as string));
  const busy = new Set((open.data ?? []).map((r) => r.opportunity_id as string));
  type O = { id: string; code: string | null; title: string | null; customer: One<{ name: string | null }>; styles: { sno: number | null; name: string | null }[] | null };
  return ((opps.data ?? []) as unknown as O[])
    .filter((o) => approved.has(o.id) && !busy.has(o.id))
    .map((o) => ({
      id: o.id,
      smp_no: o.code,
      customer_name: one(o.customer)?.name ?? o.title ?? null,
      style_names: [...(o.styles ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0)).map((x) => x.name ?? "").filter(Boolean),
    }));
}

/** The cost heads of one costing, as the comparison shows them. */
export async function costingKpisOf(costSheetId: string): Promise<CostingKpis | null> {
  const record = await getSampleCostingRecord(costSheetId);
  if (!record) return null;
  const t = summaryOf(record.draft).groups[0]?.total;
  const sumOf = (...xs: (number | null | undefined)[]) =>
    xs.every((x) => x == null) ? null : Math.round(xs.reduce<number>((a, x) => a + (x ?? 0), 0) * 10000) / 10000;
  return {
    cost_sheet_id: record.id,
    costing_no: record.code,
    version: record.version,
    currency: record.draft.header.currency_code,
    fabric: t?.fabric ?? null,
    trims: t?.trims ?? null,
    cmt: t?.cmt ?? null,
    process: t?.process ?? null,
    overheads: t ? sumOf(t.other, t.wastage, t.overhead, t.extraOverhead) : null,
    gross_cost: t?.grossCost ?? null,
    quoted: t?.quoted ?? t?.calc ?? null,
    margin_pct: t?.effectiveMarginPct ?? null,
  };
}

/**
 * V0 AGAINST PROPOSED, one pair per costing the revision opened. While the
 * revision is being worked the figures are LIVE (re-read from both sheets);
 * once sent to the MD they are the ones frozen with it.
 */
export async function revisionComparison(rev: SampleRevisionRow): Promise<{ v0: CostingKpis | null; proposed: CostingKpis | null }[]> {
  if (rev.status !== "draft" && rev.v0_kpis && rev.proposed_kpis) {
    return rev.costing_pairs.map((p) => ({
      v0: rev.v0_kpis?.find((k) => k.cost_sheet_id === p.parent_id) ?? null,
      proposed: rev.proposed_kpis?.find((k) => k.cost_sheet_id === p.proposed_id) ?? null,
    }));
  }
  return Promise.all(
    rev.costing_pairs.map(async (p) => {
      const [v0, proposed] = await Promise.all([costingKpisOf(p.parent_id), costingKpisOf(p.proposed_id)]);
      return { v0, proposed };
    }),
  );
}

/**
 * THE OPEN REVISION A COSTING SHEET IS THE PROPOSAL OF, if any — what the
 * costing save guards against and the editor names.
 */
export async function revisionForCosting(
  costSheetId: string,
): Promise<{ id: string; revision_code: string; status: "draft" | "pending"; kinds: SampleRevisionRow["kinds"]; parent_id: string } | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("sample_revisions")
    .select("id, revision_code, status, kinds, costing_pairs")
    .in("status", ["draft", "pending"])
    .filter("costing_pairs", "cs", JSON.stringify([{ proposed_id: costSheetId }]))
    .maybeSingle();
  if (error) throw new Error(`Could not read the sample revision: ${error.message}`);
  if (!data) return null;
  const pair = ((data.costing_pairs ?? []) as CostingPair[]).find((p) => p.proposed_id === costSheetId);
  if (!pair) return null;
  return {
    id: data.id as string,
    revision_code: data.revision_code as string,
    status: data.status as "draft" | "pending",
    kinds: data.kinds as SampleRevisionRow["kinds"],
    parent_id: pair.parent_id,
  };
}
