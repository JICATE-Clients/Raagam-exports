import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
import { BROKEN_STATUSES } from "./types";

/*
 * Zod for every Resolve Hub write. CAPITALS (AGENTS.md) are applied HERE, in
 * the schema, never only in the action — titles, names and descriptions alike
 * (the Textarea exemption was withdrawn by the client). Notes, reasons and
 * comments are capitalised too; they are stored values like any other.
 */

const uuid = z.string().uuid("Pick a value from the list");
// `.nullish()` BEFORE the transform: Zod 4 decides a key may be absent from
// the schema's input side, and a union containing z.undefined() is not enough.
const uuidOrNull = z
  .union([z.string().uuid(), z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));

/** "true" / "on" / "1" from FormData, or a real boolean. */
const boolish = z
  .union([z.boolean(), z.string()])
  .nullish()
  .transform((v) => v === true || v === "true" || v === "on" || v === "1");

/** A coordinate rounded to 4 dp (~11 m) — the column is numeric(9,4), and a
 *  report needs the building, not the desk. Blank → null. */
function coord(limit: number) {
  return z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > limit) {
        ctx.addIssue({ code: "custom", message: "Location reading is not valid" });
        return z.NEVER;
      }
      return Math.round(n * 10_000) / 10_000;
    });
}

const reasonText = (what: string) =>
  z
    .string()
    .trim()
    .min(3, `Say ${what}`)
    .max(1000, "Keep it under 1000 characters")
    .transform((s) => s.toUpperCase());

export const submitBrokenSchema = z.object({
  // Empty = "my place isn't listed": the form folds the typed place into the
  // description and the server routes it as needs-sorting (plan §5, rule 4/5).
  place_id: uuidOrNull,
  trade_id: uuidOrNull,
  title: capsName("Say what is broken").pipe(z.string().max(120, "Keep the title under 120 characters")),
  description: capsTextNullable().pipe(
    z.string().max(2000, "Keep the description under 2000 characters").nullable().optional(),
  ),
  is_dangerous: boolish,
  gps_lat: coord(90),
  gps_lng: coord(180),
  source: z.enum(["form", "qr", "ai"]).default("form"),
});
export type SubmitBrokenInput = z.infer<typeof submitBrokenSchema>;

export const ticketIdSchema = uuid;
export const reasonSchema = (what = "why") => reasonText(what);

export const fixSchema = z.object({
  id: uuid,
  note: capsTextNullable().pipe(z.string().max(1000).nullable().optional()),
});

export const spotCheckSchema = z.object({
  id: uuid,
  pass: z.boolean(),
  note: capsTextNullable().pipe(z.string().max(1000).nullable().optional()),
});

export const editReportSchema = z.object({
  id: uuid,
  title: capsName("Say what is broken").pipe(z.string().max(120, "Keep the title under 120 characters")),
  description: capsTextNullable().pipe(z.string().max(2000).nullable().optional()),
});

export const reclassifySchema = z.object({
  trade_id: uuidOrNull,
  severity: z.enum(["critical", "high", "medium", "low"]),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  is_routine: z.boolean(),
});

export const noteSchema = z.object({
  id: uuid,
  body: z
    .string()
    .trim()
    .min(1, "Write the note")
    .max(2000, "Keep the note under 2000 characters")
    .transform((s) => s.toUpperCase()),
  visibility: z.enum(["internal", "reporter"]),
});

export const rateSchema = z.object({
  id: uuid,
  stars: z.coerce.number().int().min(1, "Pick 1 to 5 stars").max(5, "Pick 1 to 5 stars"),
  comment: capsTextNullable().pipe(z.string().max(1000).nullable().optional()),
});

export const assignSchema = z.object({
  ids: z.array(uuid).min(1, "Pick at least one job").max(200, "Assign at most 200 jobs at once"),
  assigneeId: uuid,
});

export const jobsFilterSchema = z.object({
  status: z.enum(BROKEN_STATUSES).optional(),
  trade_id: z.string().uuid().optional(),
  overdue: z.boolean().optional(),
});
export type JobsFilter = z.infer<typeof jobsFilterSchema>;

// ---- admin masters ----------------------------------------------------------

const code = z
  .string()
  .trim()
  .min(1, "Code is required")
  .max(30, "Keep the code under 30 characters")
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9/_-]*$/, "Use letters, digits, - / _ only"));

export const tradeSchema = z.object({
  id: z.string().uuid().optional(),
  code,
  name: capsName("Name is required").pipe(z.string().max(80)),
  description: capsTextNullable(),
  inactive: z.boolean().default(false),
});
export type TradeInput = z.input<typeof tradeSchema>;

export const placeSchema = z.object({
  id: z.string().uuid().optional(),
  code,
  name: capsName("Name is required").pipe(z.string().max(120)),
  kind: z.enum(["building", "floor", "room", "area", "machine", "asset"]),
  parent_id: uuidOrNull,
  asset_id: uuidOrNull,
  caretaker_id: uuidOrNull,
  default_trade_id: uuidOrNull,
  inactive: z.boolean().default(false),
});
export type PlaceInput = z.input<typeof placeSchema>;

export const teamSchema = z.object({
  id: z.string().uuid().optional(),
  trade_id: uuid,
  name: capsName("Name is required").pipe(z.string().max(80)),
  lead_id: uuidOrNull,
  inactive: z.boolean().default(false),
  members: z
    .array(z.object({ profile_id: uuid, active: z.boolean().default(true) }))
    .default([])
    .refine((m) => new Set(m.map((x) => x.profile_id)).size === m.length, "A person is listed twice"),
});
export type TeamInput = z.input<typeof teamSchema>;

export const routingOverrideSchema = z
  .object({
    id: z.string().uuid().optional(),
    trade_id: uuidOrNull,
    place_id: uuidOrNull,
    owner_id: uuid,
    note: capsTextNullable(),
  })
  .refine((v) => v.trade_id || v.place_id, "Pick a place, a trade, or both");
export type RoutingOverrideInput = z.input<typeof routingOverrideSchema>;

// Bounds mirror rh_unit_settings' check constraints (0739). A due period
// starts at 1 (0 would make every job late the moment it is reported); a
// window may be 0, which switches it off.
const days = (label: string, min = 1) =>
  z.coerce
    .number()
    .int(`${label} must be whole days`)
    .min(min, `${label} must be at least ${min}`)
    .max(365, `${label} must be at most 365`);

export const triageWeightsSchema = z.object({
  severity: z.object({ critical: z.number(), high: z.number(), medium: z.number(), low: z.number() }),
  priority: z.object({ urgent: z.number(), high: z.number(), medium: z.number(), low: z.number() }),
  per_day_open: z.number(),
  age_cap: z.number(),
  reopened: z.number(),
  disputed: z.number(),
  repeated: z.number(),
  unassigned: z.number(),
});

export const unitSettingsSchema = z.object({
  unit_head_id: uuidOrNull,
  estate_owner_id: uuidOrNull,
  director_ids: z.array(uuid).default([]),
  timezone: z.string().trim().min(1).default("Asia/Kolkata"),
  escalation_hour: z.coerce.number().int().min(0).max(23),
  ordinary_days: days("Ordinary"),
  routine_days: days("Routine"),
  purchase_days: days("Purchase"),
  dup_window_days: days("Duplicate window", 0),
  dispute_window_days: days("Dispute window", 0),
  report_limit_24h: z.coerce.number().int().min(1).max(1000),
  // 0 = no spot checks: every photographed fix closes itself.
  spot_check_one_in: z.coerce.number().int().min(0).max(1000),
  page_cap_per_day: z.coerce.number().int().min(0).max(10000),
  suppress_notifications: z.boolean(),
  triage_weights: triageWeightsSchema.optional(),
  // complaints (plan §10.1, 0745)
  superior_handler_id: uuidOrNull,
  complaint_response_hours: z.coerce.number().int().min(1, "Response time must be at least 1 hour").max(2160).optional(),
  // Raagam Assist (0751). Absent keeps the column as it is; blank clears it.
  requirement_owner_id: uuidOrNull.optional(),
  emergency_contact: z
    .string()
    .trim()
    .max(120, "Keep the emergency contact under 120 characters")
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v.toUpperCase() : null)),
});
export type UnitSettingsInput = z.input<typeof unitSettingsSchema>;

// ---- complaints (plan §10) ---------------------------------------------------

export const submitComplaintSchema = z.object({
  category_id: uuid,
  subject: capsName("Give the complaint a subject").pipe(z.string().max(160, "Keep the subject under 160 characters")),
  description: z
    .string()
    .trim()
    .min(1, "Describe what happened")
    .max(4000, "Keep the description under 4000 characters")
    .transform((s) => s.toUpperCase()),
  is_anonymous: boolish,
  about_superior: boolish,
});
export type SubmitComplaintInput = z.input<typeof submitComplaintSchema>;

export const resolutionSchema = z
  .string()
  .trim()
  .min(3, "Write the resolution — it is what the complainant reads")
  .max(4000, "Keep the resolution under 4000 characters")
  .transform((s) => s.toUpperCase());

export const complaintCategorySchema = z.object({
  id: z.string().uuid().optional(),
  code,
  name: capsName("Name is required").pipe(z.string().max(80)),
  description: capsTextNullable(),
  is_sensitive: z.boolean().default(false),
  anonymous_allowed: z.boolean().default(false),
  handler_id: uuidOrNull,
  response_hours: z.coerce.number().int("Whole hours only").min(1, "At least 1 hour").max(2160, "At most 2160 hours"),
  inactive: z.boolean().default(false),
  members: z
    .array(z.object({ profile_id: uuid, role: z.enum(["committee", "oversight"]) }))
    .default([])
    .refine((m) => new Set(m.map((x) => x.profile_id)).size === m.length, "A person is listed twice"),
});
export type ComplaintCategoryInput = z.input<typeof complaintCategorySchema>;

/** First Zod message, for a `Result` error. */
export function firstIssue(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Some values are not valid";
}
