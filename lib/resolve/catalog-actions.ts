"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getAppUser } from "@/lib/auth/server";
import { checkDuplicateName } from "@/lib/masters/dup-guard";
import { createClient } from "@/lib/supabase/server";
import { ASSIST_LANES } from "./assist-types";
import { canRh } from "./auth";
import { fail, ok, type Result } from "./result";
import { firstIssue, ticketIdSchema } from "./schemas";

/*
 * Problem Catalog writes (0751) — Administration ▸ Problem Catalog. Plain
 * table writes under RLS (`rh_catalog_*_write` = resolve:create, the `admin`
 * key); the gate here only words the refusal before the database does.
 *
 * Delete switches a row OFF: tickets point at an item (`catalog_item_id`),
 * and the chat drops an off row from its lists (`rh_assist_catalog`).
 *
 * Types are imported, never re-exported (a type re-exported from a
 * "use server" file is a runtime ReferenceError tsc does not see).
 */

const NO_ACCESS = "You do not have access to do this in Resolve Hub";

type PgError = { code?: string; message: string } | null;
function dbError(e: NonNullable<PgError>): string {
  if (e.code === "P0001") return e.message;
  if (e.code === "23505") return "That code already exists";
  if (e.code === "42501") return NO_ACCESS;
  return `Could not save: ${e.message}`;
}

async function adminGate(): Promise<string | null> {
  if (!(await getAppUser())) return "Sign in to continue";
  if (!(await canRh("admin"))) return NO_ACCESS;
  return null;
}

function revalidate() {
  revalidatePath("/resolve", "layout");
}

/** "NEEDLE, broken needle ,," → ["NEEDLE", "BROKEN NEEDLE"] — CAPITALS, no blanks, no repeats. */
const wordList = z
  .union([z.array(z.string()), z.string()])
  .nullish()
  .transform((v) => {
    const parts = Array.isArray(v) ? v : (v ?? "").split(",");
    return [...new Set(parts.map((p) => p.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  })
  .pipe(z.array(z.string().max(60, "Keep each word under 60 characters")));

const codeField = z
  .string()
  .trim()
  .toUpperCase()
  .max(40, "Keep the code under 40 characters")
  .regex(/^[A-Z0-9-]*$/, "A code is letters, digits and dashes only")
  .optional()
  .default("");

const optCode = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.toUpperCase() : null));

const sortField = z.coerce.number().int("Sort is a whole number").min(0).max(9999).default(0);

const areaSchema = z.object({
  id: z.string().uuid().optional(),
  lane: z.enum(ASSIST_LANES, "Pick the lane"),
  code: codeField,
  label: z
    .string()
    .trim()
    .min(1, "Name the area")
    .max(60, "Keep the name under 60 characters")
    .transform((s) => s.toUpperCase()),
  icon: z.string().trim().min(1, "Pick an icon").max(40),
  details: wordList,
  sort: sortField,
  inactive: z.boolean().default(false),
});
type CatalogAreaInput = z.input<typeof areaSchema>;

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  area_id: z.string().uuid("Pick the area"),
  code: codeField,
  label: z
    .string()
    .trim()
    .min(1, "Say the problem")
    .max(120, "Keep the problem under 120 characters")
    .transform((s) => s.toUpperCase()),
  synonyms: wordList,
  /** Blank = the area's chips (stored NULL). */
  details: wordList.transform((v) => (v.length ? v : null)),
  dangerous: z.boolean().default(false),
  trade_code: optCode,
  sd_category_code: optCode,
  complaint_category_code: optCode,
  sort: sortField,
  inactive: z.boolean().default(false),
});
type CatalogItemInput = z.input<typeof itemSchema>;

type Sb = Awaited<ReturnType<typeof createClient>>;

/** A code made from the words when none is typed: `F-SEW` + `NEEDLE BREAKING` → `F-SEW-NEEDLEBREA`,
 *  suffixed 2, 3 … on collision. */
async function freeCode(s: Sb, table: string, prefix: string, label: string): Promise<string> {
  const stem = `${prefix}-${label.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "X"}`;
  const { data, error } = await s.from(table).select("code").ilike("code", `${stem}%`);
  if (error) throw new Error(error.message);
  const taken = new Set(((data ?? []) as { code: string }[]).map((r) => r.code.toUpperCase()));
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
  return `${stem}-${Date.now()}`;
}

const LANE_PREFIX = { fix: "F", it: "I", buy: "B", concern: "C" } as const;

export async function saveCatalogArea(v: CatalogAreaInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = areaSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  const dup = await checkDuplicateName(s, "rh_catalog_areas", p.data.label, {
    nameColumn: "label",
    excludeId: p.data.id,
    scope: { lane: p.data.lane },
  });
  if (!dup.ok) return fail(dup.error);
  const { id, ...row } = p.data;
  try {
    if (!id && !row.code) row.code = await freeCode(s, "rh_catalog_areas", LANE_PREFIX[row.lane], row.label);
  } catch (e) {
    return fail(`Could not make a code: ${e instanceof Error ? e.message : String(e)}`);
  }
  // The code is locked once saved — tickets' reports and the seed key on it.
  const { code, ...editable } = row;
  const res = id
    ? await s.from("rh_catalog_areas").update(editable).eq("id", id).select("id").single()
    : await s.from("rh_catalog_areas").insert({ ...editable, code }).select("id").single();
  if (res.error) return fail(dbError(res.error));
  revalidate();
  return ok({ id: (res.data as { id: string }).id });
}

export async function setCatalogAreaInactive(id: string, inactive: boolean): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(id).success) return fail("That area could not be found");
  const s = await createClient();
  const { error } = await s.from("rh_catalog_areas").update({ inactive }).eq("id", id);
  if (error) return fail(dbError(error));
  revalidate();
  return ok();
}

export async function saveCatalogItem(v: CatalogItemInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = itemSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  const dup = await checkDuplicateName(s, "rh_catalog_items", p.data.label, {
    nameColumn: "label",
    excludeId: p.data.id,
    label: "problem",
  });
  if (!dup.ok) return fail(dup.error);

  // The area decides which ONE routing column the item may carry.
  const area = await s.from("rh_catalog_areas").select("lane, code").eq("id", p.data.area_id).maybeSingle();
  if (area.error) return fail(dbError(area.error));
  if (!area.data) return fail("That area could not be found");
  const lane = (area.data as { lane: keyof typeof LANE_PREFIX; code: string }).lane;
  const { id, ...row } = p.data;
  const routed = {
    ...row,
    trade_code: lane === "fix" ? row.trade_code : null,
    sd_category_code: lane === "it" ? row.sd_category_code : null,
    complaint_category_code: lane === "concern" ? row.complaint_category_code : null,
    dangerous: lane === "fix" || lane === "it" ? row.dangerous : false,
  };
  try {
    if (!id && !routed.code) {
      routed.code = await freeCode(s, "rh_catalog_items", (area.data as { code: string }).code, routed.label);
    }
  } catch (e) {
    return fail(`Could not make a code: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { code, ...editable } = routed;
  const res = id
    ? await s.from("rh_catalog_items").update(editable).eq("id", id).select("id").single()
    : await s.from("rh_catalog_items").insert({ ...editable, code }).select("id").single();
  if (res.error) return fail(dbError(res.error));
  revalidate();
  return ok({ id: (res.data as { id: string }).id });
}

export async function setCatalogItemInactive(id: string, inactive: boolean): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(id).success) return fail("That problem could not be found");
  const s = await createClient();
  const { error } = await s.from("rh_catalog_items").update({ inactive }).eq("id", id);
  if (error) return fail(dbError(error));
  revalidate();
  return ok();
}
