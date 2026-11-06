import type { Mood, StripCell, NeedCell } from "@/components/viz/kit";
import { fmtCompactInr } from "@/lib/dashboard/format";
import { fmtDate } from "@/lib/format";
import { count, daysLate, outOf, whenOf, type SayLine, type When } from "./words";

/**
 * PURCHASE ▸ OVERVIEW — the rules, pure (plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW).
 *
 * THE DOUBTFUL DATE (rule 7, found in the live data 2026-11-06). Every open PO read as late —
 * 9 of 9 — but on 8 of them the expected date was the PO's own date: the field defaults to the
 * order date and was never typed. Calling those "late" sends the manager after eight vendors
 * for nothing. So a PO whose expected date equals its order date is NOT late and NOT on time —
 * it is "no real date", said in amber with the fix ("fill in the expected date"). Only a PO
 * with a typed date can be late.
 */

export type PoRow = {
  id: string;
  placed: boolean;
  status: string;
  code: string;
  vendor: string;
  orderDate: string;
  expectedDate: string | null;
  value: number;
  receivedValue: number;
  openQty: number;
  byClass: Map<string, number>;
  createdBy: string | null;
};

/** Open = gone to the vendor and something still to come. */
export const isOpen = (p: PoRow) => p.placed && p.openQty > 0 && p.status !== "closed";

/** The expected date was never typed: missing, or the same day as the order (the default). */
export const dateDoubtful = (p: PoRow) => !p.expectedDate || p.expectedDate.slice(0, 10) === p.orderDate.slice(0, 10);

/** Which time word an OPEN PO is. A doubtful date is "undated", never "late". */
export const poWhen = (p: PoRow, todayIso: string): When => (dateDoubtful(p) ? "undated" : whenOf(p.expectedDate, todayIso));

/** Value still to come: the PO total less what has been received. */
export const openValue = (p: PoRow) => Math.max(0, p.value - p.receivedValue);

export type PurchaseOverview = {
  say: SayLine[];
  strip: StripCell[];
  needs: NeedCell[];
  open: PoRow[];
  late: PoRow[];
  doubtful: PoRow[];
  waiting: PoRow[];
};

export function purchaseOverview(rows: readonly PoRow[], todayIso: string, pendingQc: number | null): PurchaseOverview {
  const placed = rows.filter((p) => p.placed);
  const open = rows.filter(isOpen);
  const waiting = rows.filter((p) => !p.placed && p.status === "pending_approval");
  const doubtful = open.filter(dateDoubtful);
  const dated = open.filter((p) => !dateDoubtful(p));
  const late = dated
    .filter((p) => poWhen(p, todayIso) === "late")
    .sort((a, b) => (a.expectedDate ?? "").localeCompare(b.expectedDate ?? ""));
  const week = dated.filter((p) => ["today", "week"].includes(poWhen(p, todayIso)));
  const toCome = open.reduce((a, p) => a + openValue(p), 0);

  /* ---------------- the sentence ---------------- */
  const say: SayLine[] = [];
  if (open.length === 0 && waiting.length === 0) {
    say.push({ text: placed.length ? `Every purchase order is received or closed (${count(placed.length, "PO")}).` : "No purchase order has been raised yet.", mood: "good" });
  } else if (open.length) {
    say.push({ text: `${count(open.length, "purchase order")} ${open.length === 1 ? "is" : "are"} still open, with ${fmtCompactInr(toCome)} of goods still to come.`, mood: "normal" });
  }
  if (doubtful.length) {
    const all = doubtful.length === open.length;
    const text = all
      ? doubtful.length === 1
        ? "Its expected date is the same as the PO date, so it was probably never filled in, and we can't tell if it is late."
        : "None of them has a real expected date: each is the same as its PO date, so it was probably never filled in, and we can't tell if they are late."
      : `For ${outOf(doubtful.length, open.length)} the expected date is the same as the PO date, so it was probably never filled in, and we can't tell if they are late.`;
    say.push({
      text,
      mood: "look",
      href: `/purchase/orders/${doubtful[0].id}`,
      linkText: doubtful.length === 1 ? "Fill it in" : "Start with the oldest",
    });
  }
  if (late.length) {
    const w = late[0];
    const lead =
      late.length === 1
        ? dated.length === 1 && doubtful.length
          ? `The one with a real date, ${w.code} from ${w.vendor},`
          : `${w.code} from ${w.vendor}`
        : `${count(late.length, "PO")} ${late.length === 1 ? "is" : "are"} past the expected date. The oldest, ${w.code} from ${w.vendor},`;
    say.push({
      text: `${lead} was expected on ${fmtDate(w.expectedDate)} and is ${count(daysLate(w.expectedDate!, todayIso), "day")} late.`,
      mood: "problem",
      href: `/purchase/orders/${w.id}`,
      linkText: "Open the PO",
    });
  } else if (dated.length && !doubtful.length) {
    say.push({ text: "Nothing is late: every open PO is still inside its expected date.", mood: "good" });
  }
  if (waiting.length) {
    say.push({ text: `${count(waiting.length, "PO")} ${waiting.length === 1 ? "is" : "are"} waiting for approval before ${waiting.length === 1 ? "it goes" : "they go"} to the vendor.`, mood: "look", href: "/purchase/po-approval", linkText: "PO Approval" });
  }

  /* ---------------- the strip (every figure with its "out of") ---------------- */
  const mood = (n: number, m: Mood): Mood => (n ? m : "good");
  const strip: StripCell[] = [
    { label: "Still open", value: outOf(open.length, placed.length), hint: open.length ? `${fmtCompactInr(toCome)} to come` : "all received", mood: open.length ? "normal" : "good", href: "/purchase/orders" },
    { label: "No real expected date", value: outOf(doubtful.length, open.length), hint: doubtful.length ? "same as the PO date" : "every date is typed", mood: mood(doubtful.length, "look") },
    { label: "Late", value: outOf(late.length, open.length), hint: late.length ? `oldest ${daysLate(late[0].expectedDate!, todayIso)} d · ${late[0].vendor}` : "nothing overdue", mood: mood(late.length, "problem") },
    { label: "Due this week", value: count(week.length, "PO"), hint: week.length ? "expected in the next 7 days" : "nothing due", mood: week.length ? "normal" : "quiet" },
    { label: "Waiting approval", value: count(waiting.length, "PO"), hint: waiting.length ? fmtCompactInr(waiting.reduce((a, p) => a + p.value, 0)) : "nothing waiting", mood: mood(waiting.length, "look"), href: "/purchase/po-approval" },
  ];

  /* ---------------- what needs doing (at most three, rule 9) ---------------- */
  const needs: NeedCell[] = [
    {
      title: "Fill in expected dates",
      mood: doubtful.length ? "look" : "good",
      count: doubtful.length ? count(doubtful.length, "PO") : "None",
      text: doubtful.length ? doubtful.map((p) => `${p.vendor} (${p.code})`).join(" · ") : "Every open PO has a real expected date",
      href: doubtful[0] ? `/purchase/orders/${doubtful[0].id}` : undefined,
      linkText: "Open the oldest",
    },
    {
      title: "Chase the vendor",
      mood: late.length ? "problem" : "good",
      count: late.length ? count(late.length, "PO") : "None",
      text: late.length ? late.map((p) => `${p.vendor} ${daysLate(p.expectedDate!, todayIso)} d`).join(" · ") : "No vendor is past a real expected date",
      href: late[0] ? `/purchase/orders/${late[0].id}` : undefined,
      linkText: "Open the PO",
    },
    pendingQc != null && pendingQc > 0
      ? { title: "Check quality", mood: "look", count: count(pendingQc, "lot"), text: "received and waiting for QC before they can be used", href: "/stores/qc-pending", linkText: "Pending QC" }
      : {
          title: "Approve POs",
          mood: waiting.length ? "look" : "good",
          count: waiting.length ? count(waiting.length, "PO") : "None",
          text: waiting.length ? waiting.map((p) => `${p.vendor} (${p.code})`).join(" · ") : "Nothing is waiting for approval",
          href: waiting.length ? "/purchase/po-approval" : undefined,
          linkText: "PO Approval",
        },
  ];

  return { say, strip, needs, open, late, doubtful, waiting };
}
