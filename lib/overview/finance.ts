import type { NeedCell, StripCell } from "@/components/viz/kit";
import { fmtCompactInr } from "@/lib/dashboard/format";
import { count, daysLate, outOf, whenOf, type SayLine } from "./words";

/**
 * FINANCE ▸ OVERVIEW — "What do we owe, and what is coming in?" (wave 3, 2026-11-06; plan
 * https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW).
 *
 * OWED = a vendor bill's total less what is paid, for every bill not cancelled. A bill is
 * UNMATCHED while its 3-way match (bill ↔ PO ↔ GRN) reads `exception` — it should not be paid
 * until someone looks. A bill with NO DUE DATE cannot be late or on time (rule 7): it is said in
 * amber, never counted as on time. On 2026-11-06 all 10 bills were drafts, unmatched and undated.
 *
 * MONEY IN is the receivables, raised from shipments. With no shipment yet there is nothing to
 * receive — the page says where it will come from instead of drawing ₹0 as if it were an answer.
 */

export type BillRow = { id: string; code: string; vendor: string; po: string | null; status: string; match: string | null; due: string | null; total: number; paid: number };

export const owedOf = (b: BillRow) => Math.max(0, b.total - b.paid);

export function financeOverview(bills: readonly BillRow[], receivables: number | null, shipments: number | null, todayIso: string) {
  const live = bills.filter((b) => b.status !== "cancelled" && owedOf(b) > 0);
  const owed = live.reduce((a, b) => a + owedOf(b), 0);
  const unmatched = live.filter((b) => b.match === "exception");
  const undated = live.filter((b) => !b.due);
  const late = live.filter((b) => b.due && whenOf(b.due, todayIso) === "late").sort((a, b) => a.due!.localeCompare(b.due!));
  const drafts = live.filter((b) => b.status === "draft");

  const say: SayLine[] = [];
  if (!bills.length) say.push({ text: "No vendor bill has been entered yet; they are raised from GRNs.", mood: "quiet" });
  else say.push({ text: `We owe ${fmtCompactInr(owed)} to vendors on ${count(live.length, "bill")}.`, mood: "normal", href: "/finance/payables", linkText: "Payables" });
  if (unmatched.length)
    say.push({
      text: `${outOf(unmatched.length, live.length)} bills don't match their PO and GRN, so they should not be paid until someone checks them.`,
      mood: "problem",
      href: "/finance/payables",
      linkText: "Check the bills",
    });
  if (undated.length)
    say.push({ text: `${outOf(undated.length, live.length)} have no due date, so we can't tell what is late.`, mood: "look", href: "/finance/payables", linkText: "Add due dates" });
  if (late.length)
    say.push({ text: `${count(late.length, "bill")} ${late.length === 1 ? "is" : "are"} past due; the oldest, ${late[0].code} from ${late[0].vendor}, by ${count(daysLate(late[0].due!, todayIso), "day")}.`, mood: "problem", href: "/finance/payables", linkText: "Payables" });
  if (receivables === 0)
    say.push({
      text: `Nothing is due to come in yet: receivables are raised from shipments${shipments === 0 ? ", and no shipment has been made" : ""}.`,
      mood: "quiet",
    });

  const strip: StripCell[] = [
    { label: "Owed to vendors", value: fmtCompactInr(owed), hint: `${count(live.length, "bill")}`, mood: "normal", href: "/finance/payables" },
    { label: "Don't match PO / GRN", value: outOf(unmatched.length, live.length), hint: unmatched.length ? "hold payment" : "all matched", mood: unmatched.length ? "problem" : "good" },
    { label: "No due date", value: outOf(undated.length, live.length), hint: undated.length ? "can't tell if late" : "every bill dated", mood: undated.length ? "look" : "good" },
    { label: "Still draft", value: outOf(drafts.length, live.length), hint: drafts.length ? "not confirmed" : "none", mood: drafts.length ? "look" : "good" },
    { label: "Due to come in", value: receivables == null ? "—" : receivables ? count(receivables, "receivable") : "Nothing yet", hint: receivables ? "" : "comes from shipments", mood: "quiet", href: "/finance/receivables" },
  ];

  const needs: NeedCell[] = [
    { title: "Check unmatched bills", mood: unmatched.length ? "problem" : "good", count: unmatched.length ? count(unmatched.length, "bill") : "None", text: unmatched.length ? unmatched.map((b) => `${b.vendor} (${b.code})`).join(" · ") : "Every bill matches its PO and GRN", href: unmatched.length ? "/finance/payables" : undefined, linkText: "Payables" },
    { title: "Add due dates", mood: undated.length ? "look" : "good", count: undated.length ? count(undated.length, "bill") : "None", text: undated.length ? "a bill without a due date can never show as late" : "Every bill has a due date", href: undated.length ? "/finance/payables" : undefined, linkText: "Payables" },
    { title: "Confirm drafts", mood: drafts.length ? "look" : "good", count: drafts.length ? count(drafts.length, "draft") : "None", text: drafts.length ? `${fmtCompactInr(drafts.reduce((a, b) => a + owedOf(b), 0))} in draft bills` : "No bill is left in draft", href: drafts.length ? "/finance/payables" : undefined, linkText: "Payables" },
  ];

  return { say, strip, needs, live, owed, unmatched };
}
