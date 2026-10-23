"use client";

import { CircleCheck, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { StatusTone } from "@/lib/ui/tone";

/**
 * A QUEUE CARD SAYS ITS STATE WITH AN ICON, NOT A WORD (user 2026-10-16:
 * "inside the card Pending / Updated — the tab is already listing that exact
 * word, why list it inside the card again … use only icon: clock, triangle,
 * approved", then "I told you to fix it globally").
 *
 * The tab above a queue names the pile; the card only says how this one
 * stands, in three shapes:
 *  - ⚠ `todo` — work is waiting on US: Pending, Not sent, Draft, Rejected …
 *  - 🕒 `wait` — it is with someone else: Under Progress, Submitted …
 *  - ✔ `done` — Approved, Updated, Acknowledged …
 * The word is kept as the icon's tooltip and accessible name, so nothing is
 * lost to a reader who needs it.
 *
 * ONE TABLE, EXACT MATCH — the `statusTone` rule (AGENTS.md "Status colours
 * come from one table"): case and separators fold, nothing else. A composite
 * label ("Approved · Rev 2", "Rev #2 · Pending") is not guessed at; its caller
 * passes `mark` from the status it was built from. An unknown word falls back
 * to `wait`, the shape that claims nothing.
 *
 * Every queue card uses this — `SampleCards`, `BomQueue`, the budget queue and
 * the approvals inbox. A TABLE keeps its Status words: there is no tab beside
 * each row to say them.
 */
export type StatusMarkKind = "todo" | "wait" | "done";

const norm = (w: string) => w.trim().toLowerCase().replace(/[\s_-]+/g, " ");

const MARKS: Record<string, StatusMarkKind> = {
  // done
  approved: "done",
  "customer approved": "done",
  updated: "done",
  acknowledged: "done",
  completed: "done",
  raised: "done",
  received: "done",
  distributed: "done",
  closed: "done",
  // with someone else
  "under progress": "wait",
  "in progress": "wait",
  submitted: "wait",
  sent: "wait",
  requested: "wait",
  "with approver": "wait",
  "pending approval": "wait",
  "awaiting approval": "wait",
  waiting: "wait",
  // waiting on us
  pending: "todo",
  "awaiting you": "todo",
  "not started": "todo",
  "not sent": "todo",
  "not submitted": "todo",
  "not budgeted": "todo",
  draft: "todo",
  rejected: "todo",
  "customer rejected": "todo",
  returned: "todo",
  "sent back": "todo",
  rework: "todo",
  recalculate: "todo",
  unresolved: "todo",
  overdue: "todo",
  withdrawn: "todo",
};

/** The shape a status word takes on a card; `wait` when the word is unknown. */
export const statusMark = (word: string): StatusMarkKind => MARKS[norm(word)] ?? "wait";

const ICON: Record<StatusMarkKind, LucideIcon> = { todo: TriangleAlert, wait: Clock, done: CircleCheck };
const INK: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted-foreground",
};
/** When the caller gives no tone, the shape picks one. */
// status-tone: exempt -- maps an icon SHAPE (todo/wait/done) to a default tone, not a status word
const MARK_TONE: Record<StatusMarkKind, StatusTone> = { todo: "danger", wait: "info", done: "success" };

export function StatusMark({ word, mark, tone }: { word: string; mark?: StatusMarkKind; tone?: StatusTone }) {
  const m = mark ?? statusMark(word);
  const Icon = ICON[m];
  return (
    <Tooltip label={word}>
      <span role="img" aria-label={word || undefined} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center ${INK[tone ?? MARK_TONE[m]]}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
    </Tooltip>
  );
}
