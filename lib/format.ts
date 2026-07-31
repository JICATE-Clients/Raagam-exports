/** Shared display formatters. */

export function fmtMoney(
  value: number | null | undefined,
  currency: string | null = "INR",
): string {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toLocaleString("en-IN")}`.trim();
  }
}

export function fmtNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-IN");
}

// ============================================================================
// Dates — DD/MM/YYYY everywhere (client 2026-07-29).
//
// Built by hand rather than via `toLocaleDateString`. Two reasons:
//
// 1. A locale is a REQUEST, not a guarantee. "en-IN" happens to render
//    DD/MM/YYYY today, but the output depends on the ICU data the runtime
//    ships — and it differed between the Node server render and the browser
//    hydration. A fixed business format should not be negotiated with a
//    locale database.
// 2. Timezone. A Postgres `date` column arrives as the plain string
//    "2026-07-29". `new Date("2026-07-29")` parses that as UTC midnight, so
//    `getDate()` west of UTC returns the 28th — the date silently shifts by a
//    day. Formatting the string directly cannot drift, because no instant is
//    involved. Only genuine timestamps (`timestamptz`, audit trails) go
//    through `Date`, where local-time conversion is what you actually want.
// ============================================================================

/** A bare `date` column: "2026-07-29", no time and therefore no timezone. */
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** DD/MM/YYYY, e.g. "29/07/2026". */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const dateOnly = ISO_DATE_ONLY.exec(value.trim());
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Date + time, e.g. "29/07/2026, 3:45 pm" — for audit trails / timestamps.
 *
 * The clock stays 12-hour with am/pm, which is what the screens showed before
 * and what the client reads. Only the DATE half changed. Switching to 24-hour
 * is a one-line change here and nowhere else.
 */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}, ${time}`;
}
