/**
 * 12-HOUR TIME, TYPED AND SHOWN — the half of `components/ui/time-input.tsx`
 * that is pure, so `scripts/check-time12.mts` can prove it.
 *
 * The stored value never changes shape: "HH:MM", 24-hour, exactly what
 * `<input type="time">` handed every screen and what a Postgres `time` column
 * takes. Only what the operator SEES and TYPES is 12-hour.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" or "HH:MM:SS" (24-hour) → "09:30 AM". Blank or unreadable → "". */
export function fmt12(value: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value?.trim() ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  if (h > 23) return "";
  return `${pad(h % 12 || 12)}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/** Is this stored value in the afternoon / evening? `null` when blank. */
export function isPm(value: string | null | undefined): boolean | null {
  const m = /^(\d{1,2}):/.exec(value?.trim() ?? "");
  return m ? Number(m[1]) >= 12 : null;
}

/** The same clock time on the other side of noon ("09:30" ⇄ "21:30"). */
export function flipMeridiem(value: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return value;
  return `${pad((Number(m[1]) + 12) % 24)}:${m[2]}`;
}

/**
 * What the operator typed → "HH:MM" (24-hour), or `null` while it is not yet a
 * time. Accepts the ways people write one:
 *
 *   9 · 09 · 930 · 0930 · 9:30 · 9.30 · 9:30pm · 9:30 p · 9 PM · 21:30 · 2130
 *
 * AM/PM, when typed, decides. A 13–23 or 0 hour is read as 24-hour, since it
 * can only mean one thing. A bare 1–12 with no AM/PM keeps the side of noon
 * the field was on (`prev`) — changing Lunch from 2:00 PM by typing "1" means
 * 1 PM — and on an empty field takes the working-day guess: 7–11 morning,
 * 12 and 1–6 afternoon. Either way the box redraws as "01:00 PM" when the
 * operator leaves it, so the reading is never hidden.
 */
export function parseTime12(raw: string, prev?: string | null): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":").replace(/:(?=[ap])/, "");
  const m = /^(\d{1,4})(?::(\d{1,2}))?(a|am|p|pm|a:m|p:m|a:m:|p:m:)?$/.exec(s);
  if (!m) return null;
  let [h, min] = [Number(m[1]), m[2] != null ? Number(m[2]) : 0];
  if (m[2] == null && m[1].length >= 3) {
    // "930" / "0930" / "2130": the last two digits are the minutes.
    h = Number(m[1].slice(0, -2));
    min = Number(m[1].slice(-2));
  } else if (m[1].length > 2) {
    return null;
  }
  if (min > 59) return null;
  const mer = m[3]?.[0] as "a" | "p" | undefined;
  if (mer) {
    if (h < 1 || h > 12) return null;
    return `${pad((h % 12) + (mer === "p" ? 12 : 0))}:${pad(min)}`;
  }
  if (h > 23) return null;
  if (h === 0 || h >= 13) return `${pad(h)}:${pad(min)}`;
  const pm = isPm(prev) ?? (h === 12 || h <= 6);
  return `${pad((h % 12) + (pm ? 12 : 0))}:${pad(min)}`;
}
