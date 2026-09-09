import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { daysBetween, today } from "@/lib/calendar";
import { BACKLOG_FLOOR_DAYS, ESCALATE_AFTER_DAYS } from "./worklist";

/**
 * The Approvals Worklist — the transaction-entry half of doc/approval.md's
 * Order Transaction Ledger. `garment_order_amendment_ta_approvals` (the
 * ta-approvals-engine branch, already live) stores status/dates/proof, but no
 * screen anywhere lets a merchandiser actually change them — the order-entry
 * T&A tab only shows a picker and a read-only target date. This is that
 * screen, structured like `lib/ta/worklist.ts`'s own worklist (same buckets,
 * same "an empty worklist is the dangerous failure" discipline) because it is
 * the same shape of problem one table over.
 *
 * NO DEPARTMENT SCOPING, DELIBERATELY, UNLIKE THE ACTIVITY WORKLIST. Every one
 * of the 18 approval milestones is MERCHANDISING today (`ta_approvals
 * .department`, 0542) — `ta_activities`' six-way department split
 * (`ta_department_assigns`) answers a question this table does not yet ask.
 * Add scoping here the day a second department owns an approval, not before;
 * a filter with one branch is not a filter, it is a rule to build later.
 */

export type ApprovalWorklistBucket = "backlog" | "today" | "upcoming";

export interface ApprovalWorklistRow {
  id: string;
  rowUid: string | null;
  amendmentId: string;
  amendmentCode: string | null;
  orderRef: string | null;
  buyer: string | null;
  approvalId: string | null;
  approval: string;
  department: string | null;
  requiresProof: boolean;
  targetDate: string;
  status: "pending" | "sent" | "approved" | "rework";
  activeVersion: number;
  proofPath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  daysLate: number;
  bucket: ApprovalWorklistBucket;
  escalated: boolean;
}

export interface ApprovalWorklistNote {
  level: "info" | "warn" | "danger";
  text: string;
}

export interface ApprovalWorklist {
  today: string;
  rows: ApprovalWorklistRow[];
  counts: {
    scanned: number;
    backlog: number;
    today: number;
    upcoming: number;
    escalated: number;
    droppedDraft: number;
    droppedResolved: number;
    droppedTooOld: number;
  };
  notes: ApprovalWorklistNote[];
  available: boolean;
  canComplete: boolean;
}

type Row = Record<string, unknown>;
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

function one(row: Row, key: string): Row | null {
  const v = row[key];
  if (Array.isArray(v)) return (v[0] as Row) ?? null;
  return (v as Row) ?? null;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /schema cache|does not exist|could not find the table/i.test(error.message ?? "");
}

function empty(available: boolean): ApprovalWorklist {
  return {
    today: today(),
    rows: [],
    counts: {
      scanned: 0,
      backlog: 0,
      today: 0,
      upcoming: 0,
      escalated: 0,
      droppedDraft: 0,
      droppedResolved: 0,
      droppedTooOld: 0,
    },
    notes: available
      ? []
      : [
          {
            level: "warn",
            text: "The approvals tracker is not in this database yet.",
          },
        ],
    available,
    canComplete: false,
  };
}

export async function getApprovalsWorklist(): Promise<ApprovalWorklist> {
  const s = await createClient();
  const canComplete = await can("orders", "edit");
  const t = today();

  const { data, error } = await s
    .from("garment_order_amendment_ta_approvals")
    .select(
      "id, row_uid, amendment_id, approval_id, target_date, status, active_version, " +
        "proof_path, mime_type, size_bytes, " +
        "approval:ta_approvals(id, short_name, name, department, requires_proof), " +
        "amendment:garment_order_amendments!inner(" +
        "id, code, is_draft, " +
        "customer:customers(id, name), sales_order:sales_orders(id, order_number))",
    )
    .order("target_date", { ascending: true });

  if (error) {
    if (isMissingTable(error)) return empty(false);
    return {
      ...empty(true),
      notes: [{ level: "danger", text: `Could not load the approvals worklist: ${error.message}` }],
    };
  }

  const rowsRaw = arr(data);
  const scanned = rowsRaw.length;
  let droppedDraft = 0;
  let droppedResolved = 0;
  let droppedTooOld = 0;

  const kept = rowsRaw.filter((r) => {
    const a = one(r, "amendment");
    if (a?.is_draft) {
      droppedDraft++;
      return false;
    }
    // "Resolved" means nothing left for a merchandiser to DO right now —
    // an approved row is done, and REWORK never rests on the live row (0543).
    if (str(r.status) === "approved") {
      droppedResolved++;
      return false;
    }
    const targetDate = str(r.target_date);
    if (targetDate && daysBetween(targetDate, t) > BACKLOG_FLOOR_DAYS) {
      droppedTooOld++;
      return false;
    }
    return true;
  });

  const rows: ApprovalWorklistRow[] = kept.map((r) => {
    const a = one(r, "amendment");
    const appr = one(r, "approval");
    const targetDate = str(r.target_date) ?? t;
    const daysLate = daysBetween(targetDate, t);
    const bucket: ApprovalWorklistBucket = daysLate > 0 ? "backlog" : daysLate === 0 ? "today" : "upcoming";
    return {
      id: String(r.id),
      rowUid: str(r.row_uid),
      amendmentId: String(r.amendment_id),
      amendmentCode: str(a?.code),
      orderRef: str(one(a ?? {}, "sales_order")?.order_number),
      buyer: str(one(a ?? {}, "customer")?.name),
      approvalId: str(r.approval_id),
      approval: str(appr?.name) ?? str(appr?.short_name) ?? "—",
      department: str(appr?.department),
      requiresProof: !!appr?.requires_proof,
      targetDate,
      status: (str(r.status) ?? "pending") as ApprovalWorklistRow["status"],
      activeVersion: num(r.active_version) || 1,
      proofPath: str(r.proof_path),
      mimeType: str(r.mime_type),
      sizeBytes: r.size_bytes == null ? null : num(r.size_bytes),
      daysLate,
      bucket,
      escalated: daysLate >= ESCALATE_AFTER_DAYS,
    };
  });

  rows.sort((x, y) => y.daysLate - x.daysLate || x.approval.localeCompare(y.approval));

  const counts = {
    scanned,
    backlog: 0,
    today: 0,
    upcoming: 0,
    escalated: 0,
    droppedDraft,
    droppedResolved,
    droppedTooOld,
  };
  for (const row of rows) {
    counts[row.bucket]++;
    if (row.escalated) counts.escalated++;
  }

  const notes: ApprovalWorklistNote[] = [];
  if (scanned === 0) {
    notes.push({ level: "info", text: "No approval rows exist yet — none of this database's orders have an Approvals tab entry." });
  } else if (rows.length === 0) {
    notes.push({
      level: "info",
      text: `${scanned} approval row${scanned === 1 ? "" : "s"} scanned — ${droppedDraft} on draft orders, ${droppedResolved} already approved, ${droppedTooOld} too old to show. Nothing pending.`,
    });
  }

  return {
    today: t,
    rows,
    counts,
    notes,
    available: true,
    canComplete,
  };
}
