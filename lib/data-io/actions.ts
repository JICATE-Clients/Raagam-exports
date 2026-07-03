"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getIoEntity } from "./entities";
import { coerceRow } from "./coerce";

export interface RowError {
  /** 1-based spreadsheet line (header is line 1, so data starts at 2). */
  row: number;
  message: string;
}

export type ImportResult =
  | { ok: true; imported: number; skipped: number; errors: RowError[] }
  | { ok: false; error: string };

export type DeleteResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * Validate + bulk-insert/upsert raw spreadsheet rows for an entity. Rows arrive
 * header-keyed (untrusted); we re-coerce and re-validate here — the client
 * preview is advisory, this is the trust boundary. Invalid rows are skipped and
 * reported; valid rows are written in a single statement.
 */
export async function bulkImport(
  entityKey: string,
  rawRows: Record<string, string>[],
): Promise<ImportResult> {
  const entity = getIoEntity(entityKey);
  if (!entity) return { ok: false, error: "Unknown entity" };
  if (entity.exportOnly || !entity.schema) {
    return { ok: false, error: "Import not supported for this entity" };
  }
  if (!(await can(entity.module, "create"))) {
    return { ok: false, error: "Forbidden" };
  }
  const schema = entity.schema;

  const valid: Record<string, unknown>[] = [];
  const errors: RowError[] = [];

  rawRows.forEach((rawRow, i) => {
    const line = i + 2;
    const { value, errors: coerceErrors } = coerceRow(entity.fields, rawRow);
    if (coerceErrors.length) {
      errors.push({ row: line, message: coerceErrors.join("; ") });
      return;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      errors.push({
        row: line,
        message: parsed.error.issues[0]?.message ?? "Validation failed",
      });
      return;
    }
    valid.push(parsed.data as Record<string, unknown>);
  });

  if (valid.length === 0) {
    return { ok: true, imported: 0, skipped: errors.length, errors };
  }

  const supabase = await createClient();
  const query = entity.upsertConflict
    ? supabase.from(entity.table).upsert(valid, { onConflict: entity.upsertConflict })
    : supabase.from(entity.table).insert(valid);
  const { error } = await query;
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "bulk_import",
    entityType: entity.table,
    metadata: { imported: valid.length, skipped: errors.length },
  });
  entity.revalidate.forEach((path) => revalidatePath(path));

  return { ok: true, imported: valid.length, skipped: errors.length, errors };
}

/**
 * Bulk soft-delete: set `is_active = false` for the given ids. Matches how the
 * app already treats master-data deletion (masters/HR have no hard delete), so
 * it never orphans documents that reference these records.
 */
export async function bulkDelete(
  entityKey: string,
  ids: string[],
): Promise<DeleteResult> {
  const entity = getIoEntity(entityKey);
  if (!entity) return { ok: false, error: "Unknown entity" };
  if (!(await can(entity.module, "delete"))) {
    return { ok: false, error: "Forbidden" };
  }
  if (ids.length === 0) return { ok: false, error: "No rows selected" };

  const supabase = await createClient();
  const { error } = await supabase
    .from(entity.table)
    .update({ is_active: false })
    .in("id", ids);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "bulk_deactivate",
    entityType: entity.table,
    metadata: { count: ids.length },
  });
  entity.revalidate.forEach((path) => revalidatePath(path));

  return { ok: true, count: ids.length };
}
