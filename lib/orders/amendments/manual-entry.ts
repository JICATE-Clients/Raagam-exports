/**
 * "⚠️ MANUAL ENTRY NEEDED" — ONE SENTENCE, EVERY SCREEN (doc/order/amenment
 * update.md §3.2, 0619).
 *
 * "If an amendment adds a new trim item, new fabric process, or new color
 * combo that lacks an established purchase or job-work rate, the system alerts
 * the user:  Manual Entry Needed: [Material BOM] -> "Dyed Zipper" requires a
 * Unit Purchase Rate.  The UI highlights the missing input cell in amber/red
 * and provides a one-click jump button directly to the exact screen and field."
 *
 * The budget screen (inside the editor) and the Amendment Entry page (outside
 * it) both print this list; both read this file, so the operator is never shown
 * two wordings for one gap. The JUMP is a deep link the budget screen answers:
 * `/orders/budgets?budget=<id>&line=<budgetLineKey>&field=<field>` — the line
 * named by WHAT IT IS (`budgetLineKey`), because a budget's line ids and screen
 * row keys both change on every save.
 *
 * Client-safe.
 */

/** Which MODULE a budget line's rate belongs to — the `[Material BOM]` of the sentence. */
export function moduleOfBudgetSource(source: string): string {
  switch (source) {
    case "fabric":
    case "yarn":
    case "yarn_process":
    case "fabric_process":
      return "Fabric BOM";
    case "material":
    case "material_process":
      return "Material BOM";
    case "garment_process":
      return "Order Entry";
    default:
      return "Order Budget";
  }
}

/** The missing input's own name — a purchase rate, a job-work rate, an exchange rate. */
export function missingFieldWord(source: string, field: string | undefined): string {
  if (field === "ex_rate") return "an Exchange Rate";
  if (field === "currency") return "a Currency";
  if (field && field !== "rate") return `a ${field.replace(/_/g, " ")}`;
  switch (source) {
    case "fabric":
    case "yarn":
    case "material":
      return "a Unit Purchase Rate";
    case "yarn_process":
    case "fabric_process":
    case "material_process":
    case "garment_process":
      return "a Job-Work Rate";
    default:
      return "a Rate";
  }
}

export type ManualEntryItem = {
  /** Stable for React and for "next". */
  key: string;
  /** The whole sentence, in the spec's shape. */
  message: string;
  /** The module in brackets. */
  module: string;
  /** Where the jump lands: a URL (outside the editor) or nothing (the caller jumps). */
  href?: string;
};

export function manualEntryMessage(v: { source: string; name: string; field?: string }): string {
  return `Manual Entry Needed: [${moduleOfBudgetSource(v.source)}] -> "${v.name.trim() || "a line"}" requires ${missingFieldWord(v.source, v.field)}.`;
}

/** The budget screen's deep link to one line's cell. */
export function budgetCellHref(budgetId: string, lineKey: string, field = "rate"): string {
  return `/orders/budgets?budget=${encodeURIComponent(budgetId)}&line=${encodeURIComponent(lineKey)}&field=${encodeURIComponent(field)}`;
}
