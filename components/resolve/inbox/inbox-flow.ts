import type { AssistLane } from "@/lib/resolve/assist-types";
import type { Ticket, TicketAction, TicketKind } from "@/lib/resolve/types";

/*
 * THE INBOX'S RULES, IN ONE PLACE (mockup v4, "okay do" 2026-10-26).
 *
 * 1. A ticket's life is a short chain of STEPS per lane. The step chain is the
 *    ticket's status, said once — there is no status pill beside it.
 * 2. The buttons come from the ticket's action list (`rh_ticket_actions`) and
 *    nothing else. The first PRIMARY action present is the one filled button;
 *    the first SIDE action present sits beside it; the rest go in "More".
 *    A step the database would refuse is never drawn.
 * 3. TAP-ONLY (user 2026-10-26: "user only tapping mode … the assigned member
 *    also can easy handle this"). Every reason, answer and "what did you do"
 *    is a chip; typing is the fallback, never the way.
 */

export const LANE_STEPS: Record<AssistLane, string[]> = {
  fix: ["Raised", "Taken", "Working", "Fixed", "Closed"],
  it: ["Logged", "Assigned", "Working", "Resolved", "Closed"],
  buy: ["Asked", "Approved", "Given"],
  concern: ["Raised", "Taken", "Answered"],
};

export type StepState = { index: number; held: boolean; stopped: string | null };

/** Where in its lane's chain a ticket stands. `stopped` is an end that is not
 *  the last step (cancelled, withdrawn, rejected) — drawn instead of the chain. */
export function stepOf(t: Pick<Ticket, "kind" | "status" | "assignee_id">): StepState {
  const s = t.status;
  const at = (index: number, held = false): StepState => ({ index, held, stopped: null });
  if (s === "cancelled") return { index: 0, held: false, stopped: "Cancelled" };
  if (s === "withdrawn") return { index: 0, held: false, stopped: "Withdrawn" };
  if (s === "rejected") return { index: 0, held: false, stopped: "Rejected" };
  switch (t.kind as TicketKind) {
    case "broken":
      if (s === "open") return at(t.assignee_id ? 1 : 0);
      if (s === "in_progress") return at(2);
      if (s === "blocked") return at(2, true);
      if (s === "fixed") return at(3);
      return at(4);
    case "service":
      if (s === "open") return at(0);
      if (s === "assigned") return at(1);
      if (s === "in_progress") return at(2);
      if (s === "on_hold") return at(2, true);
      if (s === "resolved") return at(3);
      return at(4);
    case "requirement":
      if (s === "open") return at(0);
      if (s === "approved") return at(1);
      return at(2);
    default:
      if (s === "open") return at(t.assignee_id ? 1 : 0);
      if (s === "resolved") return at(2);
      return at(1);
  }
}

/** The inline form a step opens, or null for a one-tap step. */
export type PanelKind = "fix" | "resolve" | "answer" | "give" | "hold" | "assign" | "reject" | "cancel" | "spot";

export type StepButton = { action: TicketAction; label: string; panel: PanelKind | null };

/** In priority order: the first one in the action list is THE next step. */
const PRIMARY: StepButton[] = [
  { action: "claim", label: "Take it", panel: null },
  { action: "sd_claim", label: "Take it", panel: null },
  { action: "unblock", label: "Resume", panel: null },
  { action: "sd_resume", label: "Resume", panel: null },
  { action: "start", label: "Start", panel: null },
  { action: "sd_start", label: "Start work", panel: null },
  { action: "c_start", label: "Start", panel: null },
  { action: "fix", label: "Mark fixed", panel: "fix" },
  { action: "sd_resolve", label: "Resolve", panel: "resolve" },
  { action: "c_resolve", label: "Answer", panel: "answer" },
  { action: "rq_approve", label: "Approve", panel: null },
  { action: "rq_fulfil", label: "Mark given", panel: "give" },
  { action: "owner_confirm", label: "Confirm the fix", panel: null },
  { action: "spot_check", label: "Spot-check", panel: "spot" },
];

const SIDE: StepButton[] = [
  { action: "block", label: "Blocked", panel: "hold" },
  { action: "sd_hold", label: "Hold", panel: "hold" },
  { action: "rq_reject", label: "Reject", panel: "reject" },
  { action: "assign", label: "Reassign", panel: "assign" },
  { action: "sd_assign", label: "Reassign", panel: "assign" },
  { action: "c_assign", label: "Reassign", panel: "assign" },
  { action: "cancel", label: "Cancel", panel: "cancel" },
  { action: "sd_cancel", label: "Cancel", panel: "cancel" },
];

export function stepButtons(actions: TicketAction[]): { primary: StepButton | null; side: StepButton[] } {
  const has = new Set(actions);
  return {
    primary: PRIMARY.find((b) => has.has(b.action)) ?? null,
    side: SIDE.filter((b) => has.has(b.action)),
  };
}

// ---- the tap vocabularies -------------------------------------------------------
// The words a worker would otherwise type, offered as chips. Each IT phrase is
// at least 10 characters because the Service Desk spec (§7.1) requires a root
// cause and the steps of the fix, and the server holds it to that.

export const FIX_DONE = [
  "Replaced a part",
  "Adjusted and re-set",
  "Cleaned it",
  "Tightened it",
  "Re-wired it",
  "Oiled and greased",
  "Welded or repaired",
];
export const IT_CAUSE = [
  "Windows or software update",
  "A wrong setting",
  "Cable loose or damaged",
  "Password or account locked",
  "A worn-out part",
  "Network or internet down",
  "Virus or junk software",
];
export const IT_FIX = [
  "Restarted the device",
  "Reinstalled the software",
  "Changed the setting",
  "Replaced the cable or part",
  "Reset the password",
  "Gave the access needed",
  "Removed the virus",
];
export const HOLD_REASONS: Record<"fix" | "it", string[]> = {
  fix: ["Waiting for a part", "Machine in use, will come back", "Needs another trade", "Raiser is not at the place", "Needs the vendor"],
  it: ["Waiting for a part", "Waiting for the requester", "Needs the vendor", "Needs another team"],
};
export const CONCERN_ANSWERS = [
  "Checked and corrected. You will see it in the next wage.",
  "Spoken to the people involved. It will not happen again.",
  "Passed to management to decide. We will update you.",
  "Checked. It was already correct, and the details are shared with you.",
];
export const GIVE_NOTES = ["Gave everything asked", "Gave part, the rest is ordered", "Gave a substitute item"];
export const REJECT_REASONS = [
  "Already in stock at the line",
  "Not needed for this work",
  "Ask your head to request it",
  "Too costly, use the old one",
];
export const CANCEL_REASONS = ["Raised twice", "Not a real problem", "Fixed by itself", "Raised in the wrong unit"];
export const SPOT_NOTES = ["Checked on the floor, it works", "Not fixed, sending it back"];

export const QUICK_REPLY: Record<AssistLane, string[]> = {
  fix: ["On my way", "Need a part, coming tomorrow", "Please stop the machine", "Fixed, please check"],
  it: ["Please restart and try again", "I'm connecting remotely", "Coming to your desk", "Done, please check"],
  buy: ["In stock, collect from store", "Ordered, 2 days", "Need one more detail"],
  concern: ["We are looking into it", "Need one more detail"],
};
export const QUICK_NOTE = ["Need a part from store", "Not our trade", "Raiser not at the place"];

/** The raiser's side — messages and reasons, all by tap. */
export const RAISER_QUICK = ["Any update?", "It's urgent", "I'm at the place now", "Come after 2 pm", "Thank you"];
export const REOPEN_REASONS = ["Same problem again", "Only partly fixed", "It broke again"];
