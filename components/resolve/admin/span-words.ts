/**
 * Minutes read as words — "15 min", "4 h", "1 h 30 min", "1 day", "3 days".
 *
 * Shared by the Settings home (server) and IT response times (client), so the
 * card on the hub and the stepper on the page say a duration the same way.
 * Plain module: no "use client", no server-only import.
 */
export function spanWords(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const day = `${d} ${d === 1 ? "day" : "days"}`;
  return h ? `${day} ${h} h` : day;
}

/** "2 days", "1 day" — a whole-day count for Unit settings' summaries. */
export function dayWords(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}
