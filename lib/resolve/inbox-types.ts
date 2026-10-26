// Resolve Inbox — the one list a resolver works from, and the one list a
// raiser tracks from (user 2026-10-26: "one unified chain", tap-only for both
// sides). Mockup: https://claude.ai/artifact/PPjttWEfrMFJ68AuAc3eBt
//
// Plain types and constants only, so the "use server" actions file and the
// client screen can both import them (a "use server" file may not re-export
// them).

import type { AssistLane } from "./assist-types";
import type { TicketKind } from "./types";

/** A ticket's lane is its KIND seen from the floor — the same four colours
 *  Raagam Assist used when it was raised (ROUTE_LOOK in chat/assist.tsx). */
export const LANE_OF_KIND: Record<TicketKind, AssistLane> = {
  broken: "fix",
  service: "it",
  requirement: "buy",
  complaint: "concern",
};

export const INBOX_TABS = ["mine", "take", "wait", "done"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];
export const INBOX_TAB_LABEL: Record<InboxTab, string> = {
  mine: "Mine",
  take: "To take",
  wait: "Waiting",
  done: "Done",
};

/** Urgency bands, in the order the list shows them. A late ticket is a GROUP
 *  inside Mine, never a fifth tab — one ticket, one place in the list. */
export const INBOX_GROUPS = ["late", "soon", "today", "later", "done"] as const;
export type InboxGroup = (typeof INBOX_GROUPS)[number];
export const INBOX_GROUP_LABEL: Record<InboxGroup, string> = {
  late: "Late",
  soon: "Due within the hour",
  today: "Today",
  later: "Later",
  done: "Finished",
};

export type ClockTone = "ok" | "warn" | "bad" | "idle";

export type InboxRow = {
  id: string;
  kind: TicketKind;
  lane: AssistLane;
  ref_no: string;
  title: string;
  /** One muted line under the title: place · category · quantity. */
  sub: string;
  status: string;
  dangerous: boolean;
  group: InboxGroup;
  /** "42 min left", "25 min late", "Paused" — worked out on the server, so the
   *  list never reads `Date.now()` in a render. */
  clock: string;
  clockTone: ClockTone;
  /** Raiser view only: the ticket is waiting on THEM (confirm, reopen, rate). */
  yourTurn: boolean;
};

export type InboxLists = Record<InboxTab, InboxRow[]>;

/** The raiser's list: what needs their tap first, then everything else. */
export type RaiserLists = { turn: InboxRow[]; open: InboxRow[]; done: InboxRow[] };
