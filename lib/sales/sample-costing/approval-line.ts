/**
 * Sample Costing — the APPROVAL LINE a report prints (client 2026-10-09: "where
 * is the approver").
 *
 * A costing is approved one of two ways, and nothing on the report said which:
 *
 *   - AUTOMATICALLY on submit, when every quote earns at least the margin floor —
 *     no person involved, `approved_by` stays empty and the remark says so;
 *   - BY THE MD, when a quote falls under the floor — a named person, a date and
 *     usually a remark, decided in the Approvals inbox.
 *
 * PURE, plain data. The INTERNAL line (Cost Sheet) says how and by whom; the
 * BUYER's line (Quotation) says only that it is approved and when — never the
 * margin, the floor, or that the MD had to be asked.
 */
import { fmtDate } from "@/lib/format";
import { MARGIN_FLOOR_PCT } from "./calc";
import type { CostingStatus } from "./types";

/** The stored facts, with the deciding person's name already resolved. */
export type ApprovalFacts = {
  status: CostingStatus;
  isDraft: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  /** Who decided it — the MD's name; null when it cleared by itself. */
  decidedByName: string | null;
  decidedAt: string | null;
  remark: string | null;
  lowestMarginPct: number | null;
};

export type ApprovalTone = "good" | "warn" | "bad" | "muted";

export type ApprovalLine = {
  tone: ApprovalTone;
  /** The headline: "Approved by …", "With the MD since …". */
  text: string;
  /** A second line — the remark or the reason. Null when there is none. */
  detail: string | null;
};

const day = (iso: string | null) => (iso ? fmtDate(iso.slice(0, 10)) : null);
const on = (iso: string | null) => (day(iso) ? ` on ${day(iso)}` : "");

/** The INTERNAL line — how it was approved, and by whom. */
export function approvalLineOf(f: ApprovalFacts, floorPct: number = MARGIN_FLOOR_PCT): ApprovalLine {
  if (f.isDraft || f.status === "draft") {
    return { tone: "muted", text: "Not submitted yet — still a Draft", detail: null };
  }
  if (f.status === "submitted") {
    return {
      tone: "warn",
      text: `With the MD for approval${f.submittedAt ? ` since ${day(f.submittedAt)}` : ""}`,
      detail:
        f.lowestMarginPct != null
          ? `Lowest margin ${f.lowestMarginPct.toFixed(1)}% is under the ${floorPct}% floor, so the MD decides.`
          : null,
    };
  }
  if (f.status === "rejected") {
    return {
      tone: "bad",
      text: `Rejected${f.decidedByName ? ` by ${f.decidedByName}` : ""}${on(f.decidedAt)}`,
      detail: f.remark,
    };
  }
  if (f.status === "superseded") {
    return { tone: "muted", text: "Superseded by a later revision", detail: null };
  }
  // Approved.
  if (f.decidedByName) {
    return { tone: "good", text: `Approved by ${f.decidedByName}${on(f.decidedAt ?? f.approvedAt)}`, detail: f.remark };
  }
  return {
    tone: "good",
    text: `Approved automatically on submit${on(f.approvedAt)}`,
    detail:
      f.lowestMarginPct != null
        ? `Every quote earns at least the ${floorPct}% floor (lowest ${f.lowestMarginPct.toFixed(1)}%), so no one had to approve it.`
        : `Every quote earns at least the ${floorPct}% floor, so no one had to approve it.`,
  };
}

/** The BUYER's line: approved and when — and nothing else, so nothing leaks. */
export function approvalLineForBuyer(f: ApprovalFacts): string | null {
  if (f.status !== "approved") return null;
  const d = day(f.approvedAt ?? f.decidedAt);
  return d ? `Approved on ${d}` : "Approved";
}
