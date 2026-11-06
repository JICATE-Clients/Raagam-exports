import type { NeedCell, StripCell } from "@/components/viz/kit";
import { daysBetween } from "@/lib/calendar";
import { count, names, outOf, type SayLine } from "./words";

/**
 * SAMPLE ▸ OVERVIEW — the rules, pure (plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW,
 * wave 2, built 2026-11-06).
 *
 * The enquiry's journey is read from its CHECKPOINTS, never a status column (the entry has
 * none): costed = a current cost sheet exists; sent = it is submitted to the buyer; approved =
 * the buyer said yes; became an order = a sales order names the enquiry (`opportunity_id`).
 * An order typed without naming its enquiry cannot be counted — the sentence says so rather
 * than inventing the link.
 *
 * "Open" work is an enquiry that has not become an order and whose costing was not rejected.
 */

export type SampleRow = {
  id: string;
  code: string;
  title: string;
  buyer: string;
  merchandiser: string;
  merchandiserId: string | null;
  received: string;
  costing: { status: "draft" | "submitted" | "approved" | "rejected"; submittedAt: string | null } | null;
  becameOrder: boolean;
};

export const stageOf = (e: SampleRow): "new" | "costing" | "with_buyer" | "approved" | "rejected" | "order" =>
  e.becameOrder
    ? "order"
    : !e.costing
      ? "new"
      : e.costing.status === "draft"
        ? "costing"
        : e.costing.status === "submitted"
          ? "with_buyer"
          : e.costing.status;

/** Days a submitted costing has waited on the buyer; null when it was never submitted. */
export const waitingDays = (e: SampleRow, todayIso: string) =>
  e.costing?.status === "submitted" && e.costing.submittedAt ? Math.max(0, daysBetween(e.costing.submittedAt.slice(0, 10), todayIso)) : null;

export function sampleOverview(rows: readonly SampleRow[], todayIso: string) {
  const open = rows.filter((e) => !e.becameOrder && e.costing?.status !== "rejected");
  const notCosted = open.filter((e) => !e.costing).sort((a, b) => a.received.localeCompare(b.received));
  const drafting = open.filter((e) => e.costing?.status === "draft");
  const withBuyer = open
    .filter((e) => e.costing?.status === "submitted")
    .sort((a, b) => (waitingDays(b, todayIso) ?? 0) - (waitingDays(a, todayIso) ?? 0));
  const approved = rows.filter((e) => e.costing?.status === "approved" && !e.becameOrder);
  const orders = rows.filter((e) => e.becameOrder);
  const age = (e: SampleRow) => Math.max(0, daysBetween(e.received, todayIso));
  const label = (e: SampleRow) => `${e.buyer} (${e.code})`;

  const say: SayLine[] = [];
  if (!rows.length) say.push({ text: "No sample enquiry has been entered yet.", mood: "quiet" });
  else
    say.push({
      text: `${count(open.length, "sample enquiry", "sample enquiries")} ${open.length === 1 ? "is" : "are"} open; ${outOf(orders.length, rows.length)} became an order.`,
      mood: "normal",
    });
  if (notCosted.length)
    say.push({
      text: `${count(notCosted.length, "enquiry", "enquiries")} ${notCosted.length === 1 ? "has" : "have"} no costing yet; the oldest, ${label(notCosted[0])}, came in ${age(notCosted[0])} days ago.`,
      mood: age(notCosted[0]) > 7 ? "problem" : "look",
      href: "/sales/sample-costing",
      linkText: "Start a costing",
    });
  if (withBuyer.length) {
    const w = withBuyer[0];
    const d = waitingDays(w, todayIso);
    say.push({
      text: `${count(withBuyer.length, "costing")} ${withBuyer.length === 1 ? "is" : "are"} waiting on the buyer${
        d != null ? `; ${label(w)} for ${count(d, "day")}` : " (the date each was sent is not recorded, so how long can't be said)"
      }.`,
      mood: d != null && d > 7 ? "problem" : "look",
      href: "/sales/sample-costing",
      linkText: "Sample Costing",
    });
  }
  if (approved.length)
    say.push({
      text: `${count(approved.length, "approved costing")} ${approved.length === 1 ? "has" : "have"} no order naming ${approved.length === 1 ? "it" : "them"} yet: ${names(approved.map(label))}.`,
      mood: "look",
    });
  if (rows.length && !notCosted.length && !withBuyer.length && !approved.length && !drafting.length)
    say.push({ text: "Every enquiry is costed, answered and followed through.", mood: "good" });

  const strip: StripCell[] = [
    { label: "Open enquiries", value: outOf(open.length, rows.length), hint: `${orders.length} became an order`, mood: "normal", href: "/sales/sample-entry" },
    { label: "No costing yet", value: count(notCosted.length, "enquiry", "enquiries"), hint: notCosted.length ? `oldest ${age(notCosted[0])} d` : "all costed", mood: notCosted.length ? "look" : "good", href: "/sales/sample-costing" },
    { label: "Costing in draft", value: count(drafting.length, "costing"), hint: drafting.length ? "not sent to the buyer" : "none", mood: drafting.length ? "look" : "good" },
    {
      label: "With the buyer",
      value: count(withBuyer.length, "costing"),
      hint: withBuyer.length ? (waitingDays(withBuyer[0], todayIso) != null ? `longest ${waitingDays(withBuyer[0], todayIso)} d` : "sent date not recorded") : "nothing waiting",
      mood: withBuyer.length ? "look" : "good",
    },
    { label: "Approved, no order", value: count(approved.length, "costing"), hint: approved.length ? names(approved.map((e) => e.buyer)) : "none", mood: approved.length ? "look" : "good" },
  ];

  const needs: NeedCell[] = [
    {
      title: "Start a costing",
      mood: notCosted.length ? "look" : "good",
      count: notCosted.length ? count(notCosted.length, "enquiry", "enquiries") : "None",
      text: notCosted.length ? notCosted.map(label).join(" · ") : "Every enquiry has a costing",
      href: notCosted.length ? "/sales/sample-costing" : undefined,
      linkText: "Sample Costing",
    },
    {
      title: "Chase the buyer",
      mood: withBuyer.length ? "look" : "good",
      count: withBuyer.length ? count(withBuyer.length, "costing") : "None",
      text: withBuyer.length ? withBuyer.map((e) => { const d = waitingDays(e, todayIso); return d != null ? `${e.buyer} ${d} d` : `${e.buyer} (${e.code})`; }).join(" · ") : "No costing is waiting on a buyer",
      href: withBuyer.length ? "/sales/sample-costing" : undefined,
      linkText: "Sample Costing",
    },
    {
      title: "Send costings",
      mood: drafting.length ? "look" : "good",
      count: drafting.length ? count(drafting.length, "draft") : "None",
      text: drafting.length ? drafting.map(label).join(" · ") : "No costing is left in draft",
      href: drafting.length ? "/sales/sample-costing" : undefined,
      linkText: "Sample Costing",
    },
  ];

  const funnel = [
    { key: "enq", label: "Enquiry", value: rows.length },
    { key: "costed", label: "Costed", value: rows.filter((e) => e.costing).length },
    { key: "sent", label: "Sent to buyer", value: rows.filter((e) => e.costing && e.costing.status !== "draft").length },
    { key: "approved", label: "Buyer approved", value: rows.filter((e) => e.costing?.status === "approved").length },
    { key: "order", label: "Became an order", value: orders.length },
  ];

  return { say, strip, needs, notCosted, withBuyer, funnel, age };
}
