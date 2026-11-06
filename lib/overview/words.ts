import { addDays, daysBetween } from "@/lib/calendar";
import type { Mood } from "@/components/viz/kit";

/**
 * THE MODULE OVERVIEWS' SHARED WORDS (plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW,
 * "Making the data easy to understand"). Pure and client-safe: plain data in, words out.
 *
 *   rule 1  — a page opens with a SENTENCE, built here from the same figures the strip shows,
 *             so the words and the numbers can never disagree. No AI writes them.
 *   rule 3  — every number has an "out of".
 *   rule 4  — time words, not status words: Late · Today · This week · Later.
 */

/** One line of the opening sentence block. `mood` colours its dot; the words carry the meaning. */
export type SayLine = { text: string; mood: Mood; href?: string; linkText?: string };

export type When = "late" | "today" | "week" | "later" | "undated";

export const WHEN_WORD: Record<When, string> = {
  late: "Late",
  today: "Today",
  week: "This week",
  later: "Later",
  undated: "No date",
};

export const WHEN_MOOD: Record<When, Mood> = {
  late: "problem",
  today: "look",
  week: "normal",
  later: "quiet",
  undated: "look",
};

/** Which time word a due date is, seen from `todayIso`. "This week" = the next 7 days. */
export function whenOf(due: string | null | undefined, todayIso: string): When {
  if (!due) return "undated";
  const d = due.slice(0, 10);
  if (d < todayIso) return "late";
  if (d === todayIso) return "today";
  if (d <= addDays(todayIso, 7)) return "week";
  return "later";
}

/** Whole days late (positive) or left (negative is never returned — use `daysLeft`). */
export const daysLate = (due: string, todayIso: string) => Math.max(0, daysBetween(due.slice(0, 10), todayIso));
export const daysLeft = (due: string, todayIso: string) => daysBetween(todayIso, due.slice(0, 10));

/** "1 order" / "3 orders" — a count with its noun. */
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** "3 of 9" — rule 3. */
export const outOf = (part: number, whole: number) => `${part.toLocaleString("en-IN")} of ${whole.toLocaleString("en-IN")}`;

/** "in 26 days" / "today" / "12 days ago" — how a person says a date relative to now. */
export function relDays(due: string, todayIso: string): string {
  const n = daysBetween(todayIso, due.slice(0, 10));
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** The time the figures were read, as the factory says it: "10:42" (IST). */
export function asOfNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(now);
}

/** Up to `max` names joined for a sentence: "A, B and 3 more". */
export function names(list: readonly string[], max = 2): string {
  const u = [...new Set(list.filter(Boolean))];
  if (u.length <= max) return u.length === 2 ? `${u[0]} and ${u[1]}` : (u[0] ?? "");
  return `${u.slice(0, max).join(", ")} and ${u.length - max} more`;
}
