// Raagam Assist — the problem catalog and the one tap-first submit
// (doc/resolve/assist-catalog-plan.md, migration 0751). Types only: a
// "use server" file may not re-export them.

export const ASSIST_LANES = ["fix", "it", "buy", "concern"] as const;
export type AssistLane = (typeof ASSIST_LANES)[number];

export type AssistItem = {
  id: string;
  code: string;
  /** The ticket subject, CAPITALS. */
  label: string;
  synonyms: string[];
  /** "What happened" chips — the item's own, else its area's. */
  details: string[];
  dangerous: boolean;
  /** Concern only — from the current unit's category the item routes to. */
  anonymous_ok: boolean;
  sensitive: boolean;
};

export type AssistArea = {
  id: string;
  lane: AssistLane;
  code: string;
  label: string;
  /** A lucide icon name (kebab-case), mapped in the chat. */
  icon: string;
  /** Most-used first (0751 `rh_assist_catalog`). */
  items: AssistItem[];
};

export const NEEDED_BY = ["today", "week", "month"] as const;
export type NeededBy = (typeof NEEDED_BY)[number];
export const NEEDED_BY_LABEL: Record<NeededBy, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
};

export const RQ_REASONS = ["ran_out", "broken", "new_joiner", "new_work", "other"] as const;
export type RqReason = (typeof RQ_REASONS)[number];
export const RQ_REASON_LABEL: Record<RqReason, string> = {
  ran_out: "Ran out",
  broken: "Old one broken",
  new_joiner: "New joiner",
  new_work: "New work",
  other: "Other",
};

/** Requirement statuses (0751) — "open" reads as Pending to people. */
export const RQ_STATUS_LABEL: Record<"open" | "approved" | "rejected" | "fulfilled" | "withdrawn", string> = {
  open: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  fulfilled: "Given",
  withdrawn: "Withdrawn",
};

/** What every lane's Send returns — the receipt drawn in the chat. */
export type AssistReceipt = {
  lane: AssistLane;
  /** NULL only for an anonymous concern: nothing ties it to the person. */
  ticket_id: string | null;
  ref_no: string;
  owner_name: string | null;
  /** Fix / Buy: due; IT: resolution due. */
  due_at: string | null;
  /** IT: first response by; Concern: response by. */
  response_due_at: string | null;
  /** Anonymous concern only — shown ONCE. */
  tracking_token: string | null;
  needs_sorting: boolean;
};
