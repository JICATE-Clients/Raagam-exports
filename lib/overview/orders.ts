import type { NeedCell, StripCell } from "@/components/viz/kit";
import { count, names, outOf, relDays, whenOf, daysLeft, type SayLine } from "./words";

/**
 * ORDERS ▸ OVERVIEW — the rules, pure (plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW).
 *
 * An order is "on the books" from Order Entry until its sales order is closed, cancelled or
 * rejected (the analytics loader already leaves those out). Its three states are the RE's own
 * (`re_status`): open (not approved yet), approved, amending (a Revision is open on it).
 *
 * T&A PROGRESS IS SAID TO BE UNMEASURABLE, never guessed (rule 7): on 2026-11-06 none of the
 * order steps carried an actual date, so "how far along is each order" has no honest answer
 * yet. The sentence says so, with the count, instead of drawing an empty progress bar.
 */

export type OrderRow = {
  id: string;
  reNo: string;
  buyer: string;
  merchandiser: string;
  merchandiserId: string | null;
  deliveryDate: string | null;
  qty: number;
  status: string;
};

export type RevisionRow = { id: string; entryNo: string; orderId: string; modules: string };
export type DraftBudgetRow = { id: string; code: string; orderIds: string[]; status: string };

export type OrdersOverview = {
  say: SayLine[];
  strip: StripCell[];
  needs: NeedCell[];
  notApproved: OrderRow[];
  pastDelivery: OrderRow[];
};

export function ordersOverview(v: {
  orders: readonly OrderRow[];
  revisions: readonly RevisionRow[];
  budgets: readonly DraftBudgetRow[];
  /** Null when the operator cannot open Order Progress — the line is then left out. */
  steps: { total: number; withActual: number } | null;
  todayIso: string;
}): OrdersOverview {
  const { orders, revisions, budgets, todayIso: t } = v;
  const byId = new Map(orders.map((o) => [o.id, o]));
  const dated = orders.filter((o) => o.deliveryDate).sort((a, b) => a.deliveryDate!.localeCompare(b.deliveryDate!));
  const pastDelivery = dated.filter((o) => whenOf(o.deliveryDate, t) === "late");
  const upcoming = dated.filter((o) => whenOf(o.deliveryDate, t) !== "late");
  const in30 = upcoming.filter((o) => daysLeft(o.deliveryDate!, t) <= 30);
  const notApproved = orders.filter((o) => o.status === "open");
  const label = (o: OrderRow) => `${o.buyer} (${o.reNo})`;

  /* ---------------- the sentence ---------------- */
  const say: SayLine[] = [];
  if (!orders.length) {
    say.push({ text: "No order is on the books yet.", mood: "quiet" });
  } else {
    const next = upcoming[0];
    say.push({
      text: `${count(orders.length, "order")} ${orders.length === 1 ? "is" : "are"} on the books.${
        next ? ` The next to ship is ${label(next)}, ${relDays(next.deliveryDate!, t)}.` : ""
      }`,
      mood: "normal",
      href: next ? `/orders/garment-orders?open=${next.id}` : undefined,
      linkText: next ? "Open it" : undefined,
    });
  }
  if (pastDelivery.length) {
    say.push({
      text: `${count(pastDelivery.length, "order")} ${pastDelivery.length === 1 ? "has" : "have"} passed the delivery date: ${names(pastDelivery.map(label))}.`,
      mood: "problem",
      href: `/orders/garment-orders?open=${pastDelivery[0].id}`,
      linkText: "Open the oldest",
    });
  }
  if (notApproved.length) {
    say.push({
      text: `${outOf(notApproved.length, orders.length)} ${notApproved.length === 1 ? "is" : "are"} not approved yet: ${names(notApproved.map(label))}.`,
      mood: "look",
      href: `/orders/garment-orders?open=${notApproved[0].id}`,
      linkText: notApproved.length === 1 ? "Open it" : "Open the first",
    });
  }
  for (const r of revisions.slice(0, 2)) {
    const o = byId.get(r.orderId);
    say.push({
      text: `Revision ${r.entryNo} is open on ${o ? label(o) : "an order"}${r.modules ? `, changing ${r.modules}` : ""}.`,
      mood: "look",
      href: `/orders/order-amendments/${r.id}`,
      linkText: "Open the revision",
    });
  }
  if (revisions.length > 2) say.push({ text: `${count(revisions.length - 2, "more revision")} open.`, mood: "look", href: "/orders/order-amendments", linkText: "Order Revisions" });
  if (budgets.length) {
    say.push({
      text: `${count(budgets.length, "budget")} ${budgets.length === 1 ? "is" : "are"} not sent to the MD yet: ${names(budgets.map((b) => b.code))}.`,
      mood: "look",
      href: `/orders/budgets?budget=${budgets[0].id}`,
      linkText: "Open the budget",
    });
  }
  if (v.steps && v.steps.total > 0 && v.steps.withActual === 0) {
    say.push({
      text: `Progress against the T&A plan can't be measured yet: none of the ${v.steps.total.toLocaleString("en-IN")} steps has an actual date.`,
      mood: "quiet",
    });
  }
  if (orders.length && !pastDelivery.length && !notApproved.length && !revisions.length && !budgets.length) {
    say.push({ text: "Every order is approved, nothing is being revised, and no budget is waiting to be sent.", mood: "good" });
  }

  /* ---------------- the strip ---------------- */
  const strip: StripCell[] = [
    { label: "On the books", value: count(orders.length, "order"), hint: `${orders.reduce((a, o) => a + o.qty, 0).toLocaleString("en-IN")} pcs`, mood: "normal", href: "/orders/garment-orders" },
    {
      label: "Ship in 30 days",
      value: outOf(in30.length, orders.length),
      hint: in30.length ? `next ${relDays(in30[0].deliveryDate!, t)}` : "none in the next month",
      mood: pastDelivery.length ? "problem" : in30.length ? "look" : "quiet",
    },
    { label: "Not approved", value: outOf(notApproved.length, orders.length), hint: notApproved.length ? names(notApproved.map((o) => o.buyer)) : "all approved", mood: notApproved.length ? "look" : "good" },
    { label: "Under revision", value: count(revisions.length, "order"), hint: revisions.length ? revisions.map((r) => r.entryNo).join(", ") : "none open", mood: revisions.length ? "look" : "good", href: "/orders/order-amendments" },
    { label: "Budgets not sent", value: count(budgets.length, "budget"), hint: budgets.length ? names(budgets.map((b) => b.code)) : "all with the MD or approved", mood: budgets.length ? "look" : "good", href: "/orders/budgets" },
  ];

  /* ---------------- what needs doing ---------------- */
  const needs: NeedCell[] = [
    {
      title: "Approve orders",
      mood: notApproved.length ? "look" : "good",
      count: notApproved.length ? count(notApproved.length, "order") : "None",
      text: notApproved.length ? notApproved.map(label).join(" · ") : "Every order on the books is approved",
      href: notApproved[0] ? `/orders/garment-orders?open=${notApproved[0].id}` : undefined,
      linkText: "Open the first",
    },
    {
      title: "Finish revisions",
      mood: revisions.length ? "look" : "good",
      count: revisions.length ? count(revisions.length, "revision") : "None",
      text: revisions.length ? revisions.map((r) => `${r.entryNo}${r.modules ? ` · ${r.modules}` : ""}`).join(" · ") : "No revision is open",
      href: revisions[0] ? `/orders/order-amendments/${revisions[0].id}` : undefined,
      linkText: "Open the revision",
    },
    {
      title: "Send budgets",
      mood: budgets.length ? "look" : "good",
      count: budgets.length ? count(budgets.length, "budget") : "None",
      text: budgets.length ? budgets.map((b) => b.code).join(" · ") : "No budget is waiting to be sent",
      href: budgets[0] ? `/orders/budgets?budget=${budgets[0].id}` : undefined,
      linkText: "Open the budget",
    },
  ];

  return { say, strip, needs, notApproved, pastDelivery };
}
