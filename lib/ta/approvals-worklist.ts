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

export type ApprovalWorklistBucket = "backlog" | "today" | "upcoming" | "resolved";

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
  actualSentDate: string | null;
  actualReceivedDate: string | null;
  status: "pending" | "sent" | "approved" | "rework";
  activeVersion: number;
  proofPath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** `HH:MM:SS` off Postgres `time`, or null — courier dispatch time (doc/ui/order/tafollowup.md §2). */
  actualSentTime: string | null;
  /** A typed courier/waybill/tracking reference, independent of proofPath. */
  proofReference: string | null;
  /** `garment_order_amendments.merchandiser_id` → `employees` — the order's own merchandiser, for the Merchandiser filter. */
  merchandiserId: string | null;
  merchandiserName: string | null;
  daysLate: number;
  bucket: ApprovalWorklistBucket;
  escalated: boolean;
  /**
   * Delay attribution (spec §5). Both are `max(0, …)` and both are `null`
   * until the fact they measure has actually happened — an unsent approval
   * has no merchandiser delay to report yet, and a sent-but-unreceived one
   * has no buyer review to judge. Computed here, on read, from dates already
   * on the row plus `masterLeadDays`; never stored, so there is exactly one
   * place that can disagree with itself.
   */
  merchandiserDelayDays: number | null;
  buyerDelayDays: number | null;
  /** `customer_approval_defaults.lead_time_days` for this buyer+approval, or
   *  null when this customer has no row for it — NO fallback to
   *  `ta_approvals.standard_days` (2026-09-11 correction; see the note above
   *  its computation). */
  masterLeadDays: number | null;
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
    resolved: number;
    escalated: number;
    droppedDraft: number;
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
      resolved: 0,
      escalated: 0,
      droppedDraft: 0,
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
      "id, row_uid, amendment_id, approval_id, target_date, actual_sent_date, actual_received_date, " +
        "actual_sent_time, proof_reference, " +
        "status, active_version, proof_path, mime_type, size_bytes, " +
        "approval:ta_approvals(id, short_name, name, department, requires_proof, standard_days), " +
        "amendment:garment_order_amendments!inner(" +
        "id, code, is_draft, customer_id, merchandiser_id, " +
        "customer:customers(id, name), sales_order:sales_orders(id, order_number), " +
        "merchandiser:employees(id, name))",
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
  let droppedTooOld = 0;

  // A RESOLVED row (approved) is exempt from the backlog-age cutoff — this is
  // a follow-up/tracking board now (spec §7), not only a to-do list, so a
  // sample approved eight months ago must not silently vanish from it.
  const kept = rowsRaw.filter((r) => {
    const a = one(r, "amendment");
    if (a?.is_draft) {
      droppedDraft++;
      return false;
    }
    if (str(r.status) === "approved") return true;
    const targetDate = str(r.target_date);
    if (targetDate && daysBetween(targetDate, t) > BACKLOG_FLOOR_DAYS) {
      droppedTooOld++;
      return false;
    }
    return true;
  });

  /* THIS BUYER'S LEAD-TIME OVERRIDES (0535), batch-fetched for exactly the
   * (customer, approval) pairs on screen — same shape as the order-entry
   * writer's own `getCustomerApprovalDefaults` call, one query instead of
   * one per row. A pair with no override falls back to the approval's own
   * `standard_days`, read straight off the embed above. */
  const customerIds = [...new Set(kept.map((r) => str(one(r, "amendment")?.customer_id)).filter((v): v is string => !!v))];
  const leadOverrides = new Map<string, number>();
  if (customerIds.length) {
    const { data: defaults } = await s
      .from("customer_approval_defaults")
      .select("customer_id, approval_id, lead_time_days")
      .in("customer_id", customerIds);
    for (const d of (defaults ?? []) as { customer_id: string; approval_id: string; lead_time_days: number }[]) {
      leadOverrides.set(`${d.customer_id}:${d.approval_id}`, d.lead_time_days);
    }
  }

  const rows: ApprovalWorklistRow[] = kept.map((r) => {
    const a = one(r, "amendment");
    const appr = one(r, "approval");
    const targetDate = str(r.target_date) ?? t;
    const actualSentDate = str(r.actual_sent_date);
    const actualReceivedDate = str(r.actual_received_date);
    const status = (str(r.status) ?? "pending") as ApprovalWorklistRow["status"];
    const resolved = status === "approved";
    const daysLate = resolved ? 0 : daysBetween(targetDate, t);
    const bucket: ApprovalWorklistBucket = resolved
      ? "resolved"
      : daysLate > 0
        ? "backlog"
        : daysLate === 0
          ? "today"
          : "upcoming";

    const customerId = str(a?.customer_id);
    const approvalId = str(r.approval_id);
    // NO FALLBACK TO `standard_days` (client correction, 2026-09-11 — see
    // markApprovalSent's own header for the write-side half of this same
    // fix). A buyer's "agreed" review window is whatever THEIR OWN
    // Customer Master row says, never the global default — reporting one
    // against a number nobody configured for them would flag a buyer as
    // late against a promise they never made.
    const masterLeadDays =
      customerId && approvalId ? (leadOverrides.get(`${customerId}:${approvalId}`) ?? null) : null;

    // §5: MERCHANDISER DELAY — only meaningful once the approval was actually
    // sent; max(0, …) because an early dispatch is not a delay.
    const merchandiserDelayDays = actualSentDate
      ? Math.max(0, daysBetween(targetDate, actualSentDate))
      : null;
    // §5: BUYER EXCESS DELAY — only meaningful once the buyer has actually
    // responded (received/rejected) AND this buyer has an actual configured
    // lead time to judge them against; the review window itself is
    // actualReceivedDate − actualSentDate, and only the days beyond the
    // buyer's own agreed lead time count against them.
    const buyerDelayDays =
      actualSentDate && actualReceivedDate && masterLeadDays !== null
        ? Math.max(0, daysBetween(actualSentDate, actualReceivedDate) - masterLeadDays)
        : null;

    return {
      id: String(r.id),
      rowUid: str(r.row_uid),
      amendmentId: String(r.amendment_id),
      amendmentCode: str(a?.code),
      orderRef: str(one(a ?? {}, "sales_order")?.order_number),
      buyer: str(one(a ?? {}, "customer")?.name),
      approvalId,
      approval: str(appr?.name) ?? str(appr?.short_name) ?? "—",
      department: str(appr?.department),
      requiresProof: !!appr?.requires_proof,
      targetDate,
      actualSentDate,
      actualReceivedDate,
      status,
      activeVersion: num(r.active_version) || 1,
      proofPath: str(r.proof_path),
      mimeType: str(r.mime_type),
      sizeBytes: r.size_bytes == null ? null : num(r.size_bytes),
      actualSentTime: str(r.actual_sent_time),
      proofReference: str(r.proof_reference),
      merchandiserId: str(a?.merchandiser_id),
      merchandiserName: str(one(a ?? {}, "merchandiser")?.name),
      daysLate,
      bucket,
      escalated: !resolved && daysLate >= ESCALATE_AFTER_DAYS,
      merchandiserDelayDays,
      buyerDelayDays,
      masterLeadDays,
    };
  });

  rows.sort((x, y) => {
    if (x.bucket === "resolved" && y.bucket !== "resolved") return 1;
    if (y.bucket === "resolved" && x.bucket !== "resolved") return -1;
    return y.daysLate - x.daysLate || x.approval.localeCompare(y.approval);
  });

  const counts = {
    scanned,
    backlog: 0,
    today: 0,
    upcoming: 0,
    resolved: 0,
    escalated: 0,
    droppedDraft,
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
      text: `${scanned} approval row${scanned === 1 ? "" : "s"} scanned — ${droppedDraft} on draft orders, ${droppedTooOld} too old to show. Nothing pending.`,
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
