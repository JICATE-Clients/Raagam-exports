import "server-only";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { readBuyerPo, type PoReadInput } from "./anthropic";
import { autoMatch, storedFromDraft, type PoMasters } from "./seed";
import {
  PO_IMPORT_BUCKET,
  PO_IMPORT_MAX_BYTES,
  poFileKind,
  poImportStoredSchema,
  type PoImportRow,
  type PoImportStored,
} from "./types";

type SB = Awaited<ReturnType<typeof createClient>>;

/**
 * The masters a PO draft is matched against — the five lists and nothing
 * else. Deliberately NOT `getAmendmentFormData()`, which loads every order,
 * consignee, process and port to open the editor; the review screen needs five
 * small lists. Reads run side by side (AGENTS.md / "Load time = round trips").
 *
 * Inactive rows are SELECTED (so a held choice still resolves) and the matcher
 * skips them — the "Disabled rows" rule.
 */
export async function loadPoMasters(sb?: SB): Promise<PoMasters> {
  const db = sb ?? (await createClient());
  const [cust, sizes, cur, ctry, styles] = await Promise.all([
    db.from("customers").select("id, code, name, inactive").order("name"),
    db.from("config_lookups").select("id, code, name").eq("kind", "size").order("name"),
    db.from("currencies").select("code, name, symbol").order("code"),
    db.from("countries").select("id, code, name, inactive").order("name"),
    db
      .from("garment_styles")
      .select(
        "id, code, style_name, article_no, style_description, unit_kind, blocked, " +
          // The same embed `getStyleRows` uses (0394 kept the old constraint name).
          "category:categories!garment_styles_style_category_id_fkey(name)",
      )
      .order("created_at"),
  ]);
  for (const [what, r] of [
    ["Customers", cust],
    ["Sizes", sizes],
    ["Currencies", cur],
    ["Countries", ctry],
    ["Styles", styles],
  ] as const) {
    // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — an empty customer list
    // would make every PO read "matches no customer", which looks like data.
    if (r.error) throw new Error(`${what} could not be read: ${r.error.message}`);
  }
  return {
    customers: (cust.data ?? []) as PoMasters["customers"],
    sizes: (sizes.data ?? []) as PoMasters["sizes"],
    currencies: (cur.data ?? []) as PoMasters["currencies"],
    countries: (ctry.data ?? []) as PoMasters["countries"],
    styles: ((styles.data ?? []) as unknown as {
      id: string;
      code: string | null;
      style_name: string | null;
      article_no: string | null;
      style_description: string | null;
      unit_kind: string | null;
      blocked: boolean | null;
      category?: { name: string } | null;
    }[]).map((s) => ({
      id: s.id,
      code: s.code,
      name: s.style_name ?? "",
      article_no: s.article_no,
      style_category: s.category?.name ?? null,
      style_description: s.style_description,
      unit_kind: s.unit_kind,
      blocked: s.blocked,
    })),
  };
}

const SELECT = "id, storage_path, file_name, mime_type, status, extracted, error, created_at";

function rowOf(r: Record<string, unknown>): PoImportRow {
  const parsed = r.extracted ? poImportStoredSchema.safeParse(r.extracted) : null;
  return {
    id: String(r.id),
    storage_path: String(r.storage_path),
    file_name: String(r.file_name),
    mime_type: (r.mime_type as string | null) ?? null,
    status: r.status as PoImportRow["status"],
    extracted: parsed?.success ? parsed.data : null,
    error: (r.error as string | null) ?? null,
    created_at: String(r.created_at),
  };
}

export async function getPoImport(id: string, sb?: SB): Promise<PoImportRow | null> {
  const db = sb ?? (await createClient());
  const { data, error } = await db.from("order_po_imports").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`The PO import could not be read: ${error.message}`);
  return data ? rowOf(data as Record<string, unknown>) : null;
}

/** The latest imports, newest first — the "recent uploads" strip. */
export async function listRecentPoImports(limit = 10): Promise<PoImportRow[]> {
  // created-by: exempt -- a short "recent uploads" strip on the import screen, not a listing of records
  const db = await createClient();
  const { data, error } = await db
    .from("order_po_imports")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Recent PO imports could not be read: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(rowOf);
}

/** A spreadsheet as CSV-ish text, sheet by sheet — what the reader is given for Excel. */
async function workbookText(buf: ArrayBuffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`--- Sheet: ${ws.name} ---`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const t = (cell.text ?? "").replace(/\r?\n/g, " ").trim();
        cells.push(/[",]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      });
      if (cells.some((c) => c)) out.push(cells.join(","));
    });
  });
  return out.join("\n");
}

function base64Of(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

export type ExtractOutcome =
  | { ok: true; stored: PoImportStored }
  | { ok: false; status: number; error: string };

/**
 * Read an uploaded PO into a draft and store it. Session client throughout, so
 * RLS and the bucket's own policies stand behind the permission check here.
 */
export async function extractPoImport(importId: string): Promise<ExtractOutcome> {
  if (!(await can("orders", "create"))) {
    return { ok: false, status: 403, error: "You need permission to create orders to read a buyer PO." };
  }
  const sb = await createClient();
  const row = await getPoImport(importId, sb);
  if (!row) return { ok: false, status: 404, error: "That PO upload was not found." };

  const kind = poFileKind(row.file_name, row.mime_type);
  if (!kind) return { ok: false, status: 400, error: "Only PDF, Excel (.xlsx), CSV or image files can be read." };

  const { data: blob, error: dlErr } = await sb.storage.from(PO_IMPORT_BUCKET).download(row.storage_path);
  if (dlErr || !blob) {
    return { ok: false, status: 400, error: `The uploaded file could not be opened: ${dlErr?.message ?? "missing"}` };
  }
  if (blob.size > PO_IMPORT_MAX_BYTES) {
    return { ok: false, status: 400, error: "The file is larger than 15 MB. Upload a smaller copy." };
  }
  const buf = await blob.arrayBuffer();

  let input: PoReadInput;
  try {
    if (kind === "pdf") input = { kind: "pdf", base64: base64Of(buf) };
    else if (kind === "image") {
      const m = (row.mime_type ?? "").toLowerCase();
      const mediaType = m === "image/png" ? "image/png" : m === "image/webp" ? "image/webp" : "image/jpeg";
      input = { kind: "image", base64: base64Of(buf), mediaType };
    } else if (kind === "xlsx") input = { kind: "text", text: await workbookText(buf), fileName: row.file_name };
    else input = { kind: "text", text: new TextDecoder().decode(buf), fileName: row.file_name };
  } catch (e) {
    return { ok: false, status: 400, error: `The file could not be opened: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (input.kind === "text" && !input.text.trim()) {
    return { ok: false, status: 400, error: "The spreadsheet is empty." };
  }

  const read = await readBuyerPo(input);
  if (!read.ok) {
    await sb.from("order_po_imports").update({ status: "failed", error: read.detail }).eq("id", importId);
    const status = read.reason === "not_configured" ? 503 : read.reason === "failed" ? 502 : 422;
    return { ok: false, status, error: read.detail };
  }

  const stored = autoMatch(storedFromDraft(read.draft), await loadPoMasters(sb));
  const { error: upErr } = await sb
    .from("order_po_imports")
    .update({ status: "extracted", extracted: stored, error: null })
    .eq("id", importId);
  if (upErr) return { ok: false, status: 500, error: `The draft could not be saved: ${upErr.message}` };
  return { ok: true, stored };
}
