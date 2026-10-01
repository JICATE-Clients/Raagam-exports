"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
// A regular staff member (My Profile) writes only through `updateMyProfile`.
import { isOwnProfileOnly, myStaffId } from "@/lib/hr/own-profile";
import { SELF_CHILDREN, SELF_COLUMNS } from "@/lib/hr/self-profile";
import { createAdminClient } from "@/lib/supabase/server";
import {
  contractorInput,
  workerInput,
  staffInput,
  payrollSettingsInput,
  type ContractorInput,
  type WorkerInput,
  type PersonInput,
  type StaffInput,
  type PersonKind,
  PARENT_COLUMN,
  type PayrollSettingsInput,
} from "@/lib/hr/types";

type Result = { ok: true } | { ok: false; error: string };

/* ---- Contractors ---- */

export async function createContractor(data: ContractorInput): Promise<Result> {
  if (!(await can("hr_payroll", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = contractorInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("contractors").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/contractors");
  return { ok: true };
}

export async function updateContractor(id: string, data: ContractorInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = contractorInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("contractors").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/contractors");
  return { ok: true };
}

/**
 * A PERSON RECORD NEEDS A PHOTOGRAPH (client 2026-09-18: "photo should be
 * mand"). The editor blocks Save on it as well; this is the guard behind it.
 *
 * NOT DECLARED IN `personInput`, and that is the decision worth reading. The
 * schema is what `lib/data-io/entities.ts` parses a SPREADSHEET with, for both
 * `workers` and `staff` — and a spreadsheet row carries no photograph. Putting
 * the rule there would not make bulk import stricter, it would make it
 * impossible. So it sits on the door an operator comes through, and an IMPORT
 * CAN STILL BRING IN A ROW WITH NO FACE: do not read the column as never-null
 * until that hole is closed on purpose.
 */
function missingPhoto(data: { photo_url?: string | null }): Result | null {
  return String(data.photo_url ?? "").trim()
    ? null
    : { ok: false, error: "Photo is required." };
}

/* ---- Workers ---- */

export async function createWorker(
  data: WorkerInput,
  children?: StaffChildren,
): Promise<Result> {
  if (!(await can("hr_payroll", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = workerInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const noPhoto = missingPhoto(parsed.data);
  if (noPhoto) return noPhoto;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("workers")
    .insert(withoutBlankLocation(parsed.data))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  if (children) {
    const childErr = await replacePersonChildren(supabase, "worker", row.id, children);
    if (childErr) return { ok: false, error: childErr };
  }
  revalidatePath("/hr/workers");
  return { ok: true };
}

export async function updateWorker(
  id: string,
  data: WorkerInput,
  children?: StaffChildren,
): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = workerInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const noPhoto = missingPhoto(parsed.data);
  if (noPhoto) return noPhoto;
  const supabase = await createClient();
  const { error } = await supabase
    .from("workers")
    .update(withoutBlankLocation(parsed.data))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (children) {
    const childErr = await replacePersonChildren(supabase, "worker", id, children);
    if (childErr) return { ok: false, error: childErr };
  }
  revalidatePath("/hr/workers");
  return { ok: true };
}

/* ---- Staff ---- */

/**
 * A BLANK LOCATION IS OMITTED, NOT SENT AS NULL.
 *
 * `staff.location_id` is NOT NULL with `default current_location()` (0487) —
 * the unit a row belongs to, defaulting to the one the operator is working in.
 * A column default only fires when the key is ABSENT: send `location_id: null`
 * explicitly and Postgres takes the null and rejects it
 * (`23502 null value in column "location_id" … violates not-null constraint`),
 * which is exactly what a round-trip against the live table did before this
 * existed.
 *
 * So a blank Location means "wherever I am", which is what the column was built
 * to say — not an error to show the operator, and not a field to make mandatory
 * on a screen where the answer is almost always the current unit.
 *
 * The same treatment on UPDATE: the column cannot hold null, so a blank there
 * means "leave it as it is" rather than "clear it".
 */
function withoutBlankLocation(data: PersonInput): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if (out.location_id == null) delete out.location_id;
  return out;
}

/** The four child lists, as the editor sends them. */
export type StaffChildren = {
  family: Record<string, unknown>[];
  experience: Record<string, unknown>[];
  internalRefs: Record<string, unknown>[];
  nominations: Record<string, unknown>[];
  bankAccounts: Record<string, unknown>[];
  externalRefs: Record<string, unknown>[];
  emergencyContacts: Record<string, unknown>[];
  shifts: Record<string, unknown>[];
  education: Record<string, unknown>[];
  technical: Record<string, unknown>[];
  languages: Record<string, unknown>[];
};

/**
 * REPLACE, NOT MERGE — delete every child row for this staff member and insert
 * what the editor holds.
 *
 * The alternative is diffing three lists by a database id the form does not
 * carry (rows are re-keyed on load, so `key` is React's and nothing else). A
 * replace is one round trip per table, cannot leave an orphan behind, and makes
 * "what is in the form" and "what is in the table" the same statement.
 *
 * The cost is honest and small: these lists are a handful of rows per employee,
 * and nothing else references them — a family member has no id anyone links to.
 * Do NOT copy this to a table whose rows are pointed at from elsewhere.
 *
 * `sno` is the row's ORDER, assigned here from the array index, so the list
 * comes back in the sequence the operator arranged it.
 */
async function replacePersonChildren(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: PersonKind,
  id: string,
  children: StaffChildren,
): Promise<string | null> {
  // The seven `hr_*` tables take either parent (0553); this is the one place
  // that decides which column, so no query can pick the wrong one.
  const parent = PARENT_COLUMN[kind];
  const tables = [
    ["hr_family_members", children.family],
    ["hr_work_experience", children.experience],
    ["hr_internal_references", children.internalRefs],
    ["hr_nominations", children.nominations],
    ["hr_bank_accounts", children.bankAccounts],
    ["hr_external_references", children.externalRefs],
    ["hr_emergency_contacts", children.emergencyContacts],
    // Shifts are a WORKER section only (client 2026-09-11), so a staff save
    // must not reach this table at all — not even to write nothing to it.
    //
    // "Send an empty list" would NOT have been equivalent: the delete below
    // runs before the `rows.length` check, by design, because that is what
    // makes removing the last row of a list stick. So a staff save carrying
    // `shifts: []` would DELETE the spells of any staff member who has them —
    // silently, from a screen that no longer displays them. 0554 deliberately
    // gave the table a `staff_id` with its own exclusion constraint, so those
    // rows are legal data; this change is about what the editor offers, not
    // about making them invalid.
    ...(kind === "worker"
      ? ([["hr_shift_assignments", children.shifts]] as const)
      : ([] as const)),
    // The three grids behind General's popups (0556). Both kinds have them —
    // only Shifts above is worker-only.
    ["hr_education", children.education],
    ["hr_technical_details", children.technical],
    ["hr_languages", children.languages],
  ] as const;

  for (const [table, rows] of tables) {
    const { error: delErr } = await supabase.from(table).delete().eq(parent, id);
    if (delErr) return delErr.message;
    if (!rows.length) continue;
    const payload = rows.map((r, i) => ({ ...r, [parent]: id, sno: i + 1 }));
    const { error: insErr } = await supabase.from(table).insert(payload);
    if (insErr) return insErr.message;
  }
  return null;
}

export async function createStaff(
  data: StaffInput,
  children?: StaffChildren,
): Promise<Result> {
  if (!(await can("hr_payroll", "create")) || (await isOwnProfileOnly())) {
    return { ok: false, error: "Forbidden" };
  }
  const parsed = staffInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const noPhoto = missingPhoto(parsed.data);
  if (noPhoto) return noPhoto;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("staff")
    .insert(withoutBlankLocation(parsed.data))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  if (children) {
    const childErr = await replacePersonChildren(supabase, "staff", row.id, children);
    if (childErr) return { ok: false, error: childErr };
  }
  revalidatePath("/hr/staff");
  return { ok: true };
}

export async function updateStaff(
  id: string,
  data: StaffInput,
  children?: StaffChildren,
): Promise<Result> {
  if (!(await can("hr_payroll", "edit")) || (await isOwnProfileOnly())) {
    return { ok: false, error: "Forbidden" };
  }
  const parsed = staffInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const noPhoto = missingPhoto(parsed.data);
  if (noPhoto) return noPhoto;
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff")
    .update(withoutBlankLocation(parsed.data))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (children) {
    const childErr = await replacePersonChildren(supabase, "staff", id, children);
    if (childErr) return { ok: false, error: childErr };
  }
  revalidatePath("/hr/staff");
  return { ok: true };
}

/* ---- My Profile ---- */

/** Where each self-editable child list lives. */
const SELF_CHILD_TABLE: Record<(typeof SELF_CHILDREN)[number], string> = {
  family: "hr_family_members",
  emergencyContacts: "hr_emergency_contacts",
  education: "hr_education",
  technical: "hr_technical_details",
  languages: "hr_languages",
};

/**
 * A REGULAR STAFF MEMBER SAVES THEIR OWN PERSONAL DETAILS (user 2026-10-01).
 *
 * The record is NEVER taken from the browser: it is the caller's own
 * `myStaffId`, resolved on the server from their login (lib/auth/self-service.ts).
 * Of what is sent, only `SELF_COLUMNS` and the `SELF_CHILDREN` lists are
 * written (lib/hr/self-profile.ts) — salary, bank, statutory, posting, name and
 * email are dropped however the request was built, so a hand-made POST can
 * change nothing the screen does not offer.
 *
 * Service role, after that match: such a login usually holds no unit, so the
 * unit-scoped RLS that guards `staff` for operators would refuse the row. The
 * same applies to the child tables, which are scoped through it.
 *
 * Validation is the operators' schema (`staffInput`), so a value that would be
 * refused on the Staff screen is refused here, and the photo rule holds.
 */
export async function updateMyProfile(
  data: StaffInput,
  children: Partial<StaffChildren>,
): Promise<Result> {
  const id = await myStaffId();
  if (!id || !(await can("hr_payroll", "view"))) return { ok: false, error: "Forbidden" };
  const parsed = staffInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const noPhoto = missingPhoto(parsed.data);
  if (noPhoto) return noPhoto;

  const src = parsed.data as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const c of SELF_COLUMNS) if (c in src) patch[c] = src[c];

  const admin = createAdminClient();
  const { error } = await admin.from("staff").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  // REPLACE, as `replacePersonChildren` does — but only these lists, and a row
  // can never name another parent: any id / staff_id / worker_id it carries is
  // stripped before `staff_id` is set to the caller's own.
  for (const key of SELF_CHILDREN) {
    const rows = children[key];
    if (!Array.isArray(rows)) continue; // not sent → left exactly as it was
    const table = SELF_CHILD_TABLE[key];
    const { error: delErr } = await admin.from(table).delete().eq("staff_id", id);
    if (delErr) return { ok: false, error: delErr.message };
    if (!rows.length) continue;
    const payload = rows.map((r, i) => {
      const { id: _id, staff_id: _s, worker_id: _w, ...rest } = r as Record<string, unknown>;
      void _id; void _s; void _w;
      return { ...rest, staff_id: id, sno: i + 1 };
    });
    const { error: insErr } = await admin.from(table).insert(payload);
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidatePath(`/hr/staff/${id}`);
  return { ok: true };
}

/* ---- Settings ---- */

export async function updateSettings(id: string, data: PayrollSettingsInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = payrollSettingsInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("payroll_settings")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/settings");
  return { ok: true };
}
