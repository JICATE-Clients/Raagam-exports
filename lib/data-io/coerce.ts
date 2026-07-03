import type { IoField } from "./entities";

/**
 * Turn one raw spreadsheet row (keyed by column *header*) into a typed object
 * keyed by DB *column*, collecting human-readable errors. Pure and isomorphic:
 * the import dialog runs it client-side to render the validation preview, and
 * the `bulkImport` server action runs it again as the trust boundary.
 *
 * Empty optional cells are omitted so the Zod schema's `.default()` applies;
 * empty required cells are errors.
 */
export interface CoerceResult {
  value: Record<string, unknown>;
  errors: string[];
}

const asText = (raw: unknown): string =>
  raw == null ? "" : String(raw).trim();

// ── Cell coercion rules — TODO(you): tune these to your real sheets ──────────
// These branches decide how forgiving import feels. Adjust the accepted spellings,
// date formats, and strictness to match the spreadsheets your users actually send.

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "active"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "inactive"]);

function coerceBoolean(text: string): boolean | { error: string } {
  const t = text.toLowerCase();
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return { error: `expected yes/no, got "${text}"` };
}

function coerceNumber(text: string): number | { error: string } {
  const n = Number(text.replace(/,/g, ""));
  return Number.isNaN(n) ? { error: `not a number: "${text}"` } : n;
}

/** Accept ISO (yyyy-mm-dd) or en-IN dd/mm/yyyy; normalize to ISO date string. */
function coerceDate(text: string): string | { error: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return { error: `unrecognized date: "${text}" (use yyyy-mm-dd or dd/mm/yyyy)` };
}

function coerceEnum(
  text: string,
  allowed: readonly string[],
): string | { error: string } {
  const hit = allowed.find((v) => v.toLowerCase() === text.toLowerCase());
  return hit ?? { error: `"${text}" not one of: ${allowed.join(", ")}` };
}
// ─────────────────────────────────────────────────────────────────────────────

export function coerceRow(
  fields: IoField[],
  rawRow: Record<string, unknown>,
): CoerceResult {
  const value: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of fields) {
    const text = asText(rawRow[field.header]);

    if (text === "") {
      if (field.required) errors.push(`${field.header} is required`);
      // else: omit so the schema default / nullable applies
      continue;
    }

    let out: unknown;
    switch (field.kind) {
      case "boolean":
        out = coerceBoolean(text);
        break;
      case "number":
        out = coerceNumber(text);
        break;
      case "date":
        out = coerceDate(text);
        break;
      case "enum":
        out = coerceEnum(text, field.enumValues ?? []);
        break;
      case "uuid":
      case "string":
      default:
        out = text;
    }

    if (out !== null && typeof out === "object" && "error" in out) {
      errors.push(`${field.header}: ${(out as { error: string }).error}`);
    } else {
      value[field.key] = out;
    }
  }

  return { value, errors };
}
