/**
 * THE NOTIFICATION EVENT REGISTRY — every alert this app can raise, declared
 * once (doc/admin/notification-management-plan.md §2).
 *
 * AN ALERT THE SYSTEM CANNOT NAME IS AN ALERT NOBODY CAN CONFIGURE. Until
 * 2026-10-01 the only identity a notification had was its title text, which
 * changes per order — so "switch off the CAD overdue alert" or "copy the
 * Factory Manager on order risk" had nothing to attach to. Now `notify()` takes
 * one of these keys first, a typo is a type error, and a new alert does not
 * compile until it is declared here.
 *
 * WHO OWNS WHAT:
 *   - this file owns MEANING — label, who the code sends it to, mandatory;
 *   - `notification_event_settings` (0673) owns POLICY — on/off, push, the
 *     admin's CC list. Seeded from here; `npm run check:notification-events`
 *     fails the build if the two disagree.
 *
 * Client-safe and pure: the admin screen renders from it, `notify()` reads it.
 */

export type NotificationEventDef = {
  /** Groups the catalog on the admin screen. */
  module: "approvals" | "orders" | "cad" | "ta" | "admin";
  label: string;
  /**
   * Who the CODE sends it to, in the operator's words. The admin can ADD
   * people (CC) but never remove these — "the merchandiser of this order" is
   * per-record knowledge a role picker cannot express (plan §4.2).
   */
  audience: string;
  /**
   * A fixed audience the admin screen can resolve TODAY to warn "nobody holds
   * this role" before the first alert falls back. Null when the audience is
   * decided per record.
   */
  staticAudience: { role: string } | null;
  /**
   * CANNOT BE SWITCHED OFF. These are how a document leaves an approval
   * queue; disabling one does not quiet the app, it strands budgets (plan
   * §4.1). Push stays switchable; the bell row does not.
   */
  mandatory: boolean;
  /** Default for the push channel (the bell row is always written). */
  push: boolean;
  /**
   * Whether an alert that resolves to nobody goes to the administrators
   * (0660). False where an empty list is a legitimate answer.
   */
  fallbackToAdmins: boolean;
};

export const NOTIFICATION_EVENTS = {
  // ---- Approvals ------------------------------------------------------------
  "approval.pending": {
    module: "approvals",
    label: "Approval needed",
    audience: "The approvers of the step the document is now at",
    staticAudience: null,
    mandatory: true,
    push: true,
    fallbackToAdmins: true,
  },
  "approval.revision_pending": {
    module: "approvals",
    label: "Order revision needs approval",
    audience: "The approvers of the revision's budget",
    staticAudience: null,
    mandatory: true,
    push: true,
    fallbackToAdmins: true,
  },
  "approval.decided": {
    module: "approvals",
    label: "Approval decided",
    audience: "Whoever submitted it, and the orders' merchandisers",
    staticAudience: null,
    mandatory: true,
    push: true,
    fallbackToAdmins: true,
  },
  "approval.sla_reminder": {
    module: "approvals",
    label: "Approval overdue (reminder)",
    audience: "The approvers it is still waiting on",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },
  "approval.sla_escalated": {
    module: "approvals",
    label: "Your request was escalated",
    audience: "Whoever submitted it",
    staticAudience: null,
    // lib/approvals/sla.ts tellTheRequester: "not configurable and should not
    // be: it is information about their own document".
    mandatory: true,
    push: true,
    fallbackToAdmins: false,
  },
  "approval.sla_missed": {
    module: "approvals",
    label: "No longer waiting on you",
    audience: "The approvers it moved past — only where the flow step asks (Notify missed approver)",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: false,
  },

  // ---- CAD ------------------------------------------------------------------
  "cad.new_order": {
    module: "cad",
    label: "New order needs marker weights",
    audience: "Everyone holding the CAD Technician role",
    staticAudience: { role: "CAD Technician" },
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },
  "cad.weights_ready": {
    module: "cad",
    label: "CAD piece weights are ready",
    audience: "The order's merchandiser, else the merchandising desk (Orders ▸ Edit)",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },
  "cad.pattern_ready": {
    module: "cad",
    label: "Pattern is Ready",
    audience: "Whoever assigned the CAD version, else the merchandiser, else the merchandising desk",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },

  // ---- Orders ---------------------------------------------------------------
  "order.community_message": {
    module: "orders",
    label: "Order channel update",
    audience: "The people in the order's community channel",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: false,
  },
  "order.risk": {
    module: "orders",
    label: "Order at risk",
    audience: "The order's merchandiser, and the Managing Director",
    staticAudience: { role: "Managing Director" },
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },
  "workflow.milestone_overdue": {
    module: "orders",
    label: "Pre-production milestone overdue",
    audience: "The milestone's owner, else the order's merchandiser",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },
  "workflow.milestones_escalated": {
    module: "orders",
    label: "Milestones escalated (daily summary)",
    audience: "The Managing Director",
    staticAudience: { role: "Managing Director" },
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },

  // ---- T&A ------------------------------------------------------------------
  "ta.buyer_link": {
    module: "ta",
    label: "Buyer approval link update",
    audience: "The order's merchandiser, else the merchandising desk (Orders ▸ Edit)",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: true,
  },

  // ---- Administration -------------------------------------------------------
  "admin.test": {
    module: "admin",
    label: "Test notification",
    audience: "The person the administrator picks",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: false,
  },
  "admin.broadcast": {
    module: "admin",
    label: "Announcement",
    audience: "The people the administrator picks",
    staticAudience: null,
    mandatory: false,
    push: true,
    fallbackToAdmins: false,
  },
} as const satisfies Record<string, NotificationEventDef>;

export type NotificationEventKey = keyof typeof NOTIFICATION_EVENTS;

export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[];

export function notificationEvent(key: string): NotificationEventDef | null {
  return (NOTIFICATION_EVENTS as Record<string, NotificationEventDef>)[key] ?? null;
}

export const EVENT_MODULE_LABEL: Record<NotificationEventDef["module"], string> = {
  approvals: "Approvals",
  orders: "Orders",
  cad: "CAD",
  ta: "T&A",
  admin: "Administration",
};
