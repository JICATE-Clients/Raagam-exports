"use client";

import { today as todayAtFactory } from "@/lib/calendar";

/**
 * "· 12d" beside a delivery date, and "· 12d late" when it has passed.
 *
 * THE DATE SAYS WHEN AND THE SUFFIX SAYS HOW SOON, which are different
 * questions: a merchandiser scanning a queue is deciding what to plan THIS
 * WEEK, and arithmetic against thirty dates is what they were doing by eye.
 *
 * SILENT BEYOND 60 DAYS. A "· 109d" on an order shipping in December is noise
 * on every card, and noise on every card is what stops the two that say "· 4d"
 * from being seen. Late is never silent and is the only one that takes a
 * colour.
 *
 * NO HYDRATION GUARD IS NEEDED, and that is `todayAtFactory`'s doing rather
 * than luck. It formats in Asia/Kolkata, so the server (UTC) and the operator's
 * browser (IST) agree on what day it is — including during the 5.5 hours every
 * morning when `new Date()` does not. Do not reach for the UTC `today()` that
 * `lib/dashboard/range.ts` exports here.
 */
export function DaysOut({ iso }: { iso: string }) {
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  const now = Date.parse(`${todayAtFactory()}T00:00:00`);
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  const days = Math.round((at - now) / 86_400_000);

  if (days < 0) {
    return <span className="font-normal text-danger"> · {-days}d late</span>;
  }
  if (days === 0) return <span className="font-normal text-danger"> · today</span>;
  if (days > 60) return null;
  return <span className="font-normal text-muted-foreground"> · {days}d</span>;
}
