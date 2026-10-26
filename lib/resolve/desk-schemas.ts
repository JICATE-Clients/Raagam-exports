import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
import { DESK_CHANNELS, IMPACTS, OVERRIDE_KINDS, TICKET_TYPES } from "./desk-types";

/*
 * Zod for every Service Desk write (doc/resolve/service-desk-plan.md). Same
 * rules as schemas.ts: CAPITALS are applied HERE, in the schema — titles,
 * descriptions, root causes and knowledge-base steps alike (the client chose
 * capitals everywhere, prose included).
 */

const uuid = z.string().uuid("Pick a value from the list");
// `.nullish()` BEFORE the transform (Zod 4 — see schemas.ts).
const uuidOrNull = z
  .union([z.string().uuid(), z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));

const capsText = (min: number, what: string, max: number) =>
  z
    .string()
    .trim()
    .min(min, what)
    .max(max, `Keep it under ${max} characters`)
    .transform((s) => s.toUpperCase());

const code = z
  .string()
  .trim()
  .min(1, "Code is required")
  .max(30, "Keep the code under 30 characters")
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9/_-]*$/, "Use letters, digits, - / _ only"));

const lowPriority = z.enum(["high", "medium", "low"]);

// ---- intake ------------------------------------------------------------------

export const submitServiceSchema = z.object({
  category_id: uuid,
  title: capsName("Say what you need help with").pipe(z.string().max(120, "Keep the title under 120 characters")),
  description: capsText(3, "Say what happened, or what you need", 4000),
  impact: z.enum(IMPACTS, "Say how much it stops your work"),
  source: z.enum(["form", ...DESK_CHANNELS]).default("form"),
  // Set only by Log a Call: the caller the ticket is raised for.
  requester_id: uuidOrNull,
});
export type SubmitServiceInput = z.input<typeof submitServiceSchema>;

export const kbQuerySchema = z.object({
  q: z.string().trim().max(200),
  category_code: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
});

// ---- work --------------------------------------------------------------------

export const startServiceSchema = z
  .object({
    pause_ticket_id: uuidOrNull,
    pause_message: capsTextNullable().pipe(z.string().max(1000, "Keep the message under 1000 characters").nullable().optional()),
  })
  .refine((v) => !v.pause_ticket_id || !!v.pause_message, {
    message: "Write the message the paused requester will read",
    path: ["pause_message"],
  });
export type StartServiceInput = z.input<typeof startServiceSchema>;

export const resolveServiceSchema = z.object({
  // Both are mandatory (spec §7.1): the next technician reads them.
  root_cause: capsText(10, "Say what caused it (at least 10 characters)", 2000),
  resolution: capsText(10, "Write the steps that fixed it (at least 10 characters)", 4000),
  kb_article_id: uuidOrNull,
});
export type ResolveServiceInput = z.input<typeof resolveServiceSchema>;

export const overrideSchema = z.object({
  kind: z.enum(OVERRIDE_KINDS, "Pick why it jumps the queue"),
  note: capsText(3, "Say why it is urgent", 1000),
});
export type OverrideInput = z.input<typeof overrideSchema>;

export const reclassifyServiceSchema = z
  .object({
    category_id: uuidOrNull,
    ticket_type: z.enum(TICKET_TYPES).nullish().transform((v) => v ?? null),
    // Urgent is an OVERRIDE, with its reason — never a reclassification.
    priority: z
      .enum(["urgent", "high", "medium", "low"])
      .nullish()
      .transform((v) => v ?? null)
      .refine((v) => v !== "urgent", "Urgent is set by Override, with its reason"),
  })
  .refine((v) => v.category_id || v.ticket_type || v.priority, "Change the category, the type or the priority");
export type ReclassifyServiceInput = z.input<typeof reclassifyServiceSchema>;

// ---- knowledge base ----------------------------------------------------------

export const kbArticleSchema = z.object({
  id: z.string().uuid().optional(),
  title: capsName("Give the article a title").pipe(z.string().max(160, "Keep the title under 160 characters")),
  problem: capsText(3, "Describe the problem it solves", 4000),
  // The editor keeps a blank end row (tail row) — dropped here, never saved.
  steps: z
    .array(z.string())
    .default([])
    .transform((a) => a.map((s) => s.trim().toUpperCase()).filter(Boolean))
    .pipe(
      z
        .array(z.string().max(1000, "Keep each step under 1000 characters"))
        .min(1, "Write at least one step")
        .max(50, "Keep it to 50 steps"),
    ),
  tags: z
    .array(z.string())
    .default([])
    .transform((a) => [...new Set(a.map((s) => s.trim().toUpperCase()).filter(Boolean))])
    .pipe(z.array(z.string().max(40, "Keep each tag under 40 characters")).max(20, "Keep it to 20 tags")),
  category_code: z
    .union([code, z.literal("")])
    .nullish()
    .transform((v) => (v ? v : null)),
  source_ticket_id: uuidOrNull,
});
export type KbArticleInput = z.input<typeof kbArticleSchema>;

export const kbFeedbackSchema = z.object({
  id: uuid,
  helpful: z.boolean(),
  ticket_id: uuidOrNull,
});

// ---- administration ----------------------------------------------------------

export const serviceCategorySchema = z.object({
  id: z.string().uuid().optional(),
  code,
  name: capsName("Name is required").pipe(z.string().max(80)),
  description: capsTextNullable(),
  ticket_type: z.enum(TICKET_TYPES, "Pick the type"),
  team_id: uuidOrNull,
  default_priority: lowPriority.default("low"),
  inactive: z.boolean().default(false),
});
export type ServiceCategoryInput = z.input<typeof serviceCategorySchema>;

const minutes = (label: string) =>
  z.coerce
    .number()
    .int(`${label} must be whole minutes`)
    .min(1, `${label} must be at least 1 minute`)
    .max(43_200, `${label} must be at most 30 days`);

export const serviceSlaSchema = z
  .array(
    z
      .object({
        priority: z.enum(["urgent", "high", "medium", "low"]),
        response_minutes: minutes("Response"),
        resolution_minutes: minutes("Resolution"),
      })
      .refine((r) => r.resolution_minutes >= r.response_minutes, "Resolution cannot be shorter than response"),
  )
  .length(4, "Set all four priorities")
  .refine((rows) => new Set(rows.map((r) => r.priority)).size === 4, "Each priority once");
export type ServiceSlaInput = z.input<typeof serviceSlaSchema>;

const days = (label: string, min = 1) =>
  z.coerce
    .number()
    .int(`${label} must be whole days`)
    .min(min, `${label} must be at least ${min}`)
    .max(365, `${label} must be at most 365`);

export const deskUnitSettingsSchema = z
  .object({
    desk_manager_id: uuidOrNull,
    sd_auto_close_days: days("Auto-close"),
    sd_stale_remind_days: days("Stale reminder"),
    sd_stale_escalate_days: days("Stale escalation"),
    // 0 = a closed ticket cannot be reopened, only a resolved one.
    sd_reopen_days: days("Reopen window", 0),
  })
  .refine((v) => v.sd_stale_escalate_days >= v.sd_stale_remind_days, {
    message: "Escalate on the same day as the reminder or later",
    path: ["sd_stale_escalate_days"],
  });
export type DeskUnitSettingsInput = z.input<typeof deskUnitSettingsSchema>;
