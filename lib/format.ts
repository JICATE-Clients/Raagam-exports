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

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Date + time, e.g. "02 Jul 2026, 3:45 pm" — for audit trails / timestamps. */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
