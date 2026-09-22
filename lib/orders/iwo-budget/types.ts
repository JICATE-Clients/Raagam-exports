import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";
import type { IwoFor } from "@/lib/orders/internal-work-orders/types";
import type { IwoBudgetSource } from "./pull";

/**
 * IWO Budget — the budget of an Internal Work Order (0594; client audio
 * 2026-09-19). The row shapes and the save schema; the rules are `rules.ts`,
 * the pull `pull.ts`, the refresh `merge.ts`.
 */

export type IwoBudgetStatus = "draft" | "submitted" | "approved" | "rejected";

export type IwoBudgetLineRow = {
  id: string;
  budget_id: string;
  sno: number;
  source: IwoBudgetSource;
  item_id: string | null;
  process_id: string | null;
  cost_head_id: string | null;
  stage_id: string | null;
  description: string | null;
  specification: string | null;
  combo: string | null;
  basis: "process" | "fabric" | "color" | null;
  qty: number | null;
  uom_id: string | null;
  rate: number | null;
  rate_type: "per_unit" | "flat";
  currency_code: string | null;
  ex_rate: number | null;
  is_foc: boolean;
  is_import: boolean;
  from_bom: boolean;
};

export type IwoBudget = {
  id: string;
  code: string | null;
  iwo_id: string;
  budget_date: string;
  status: IwoBudgetStatus;
  decision_remark: string | null;
  remark: string | null;
  created_by: string | null;
  created_at: string;
  iwo_budget_lines: IwoBudgetLineRow[];
};

/**
 * WHICH GRIDS A WORK ORDER HAS, by its For — the audio's "respective Yarn,
 * Fabric or Accessories purchase / process tabs". A Yarn IWO buys yarn and may
 * process it; a Fabric IWO buys yarn and runs yarn and fabric processes; an
 * Accessories IWO buys trims and may process them. Other Expenses on every one.
 */
export const IWO_BUDGET_GRIDS: Record<IwoFor, { purchase: IwoBudgetSource[]; process: IwoBudgetSource[] }> = {
  yarn: { purchase: ["yarn"], process: ["yarn_process"] },
  fabric: { purchase: ["yarn"], process: ["yarn_process", "fabric_process"] },
  accessories: { purchase: ["material"], process: ["material_process"] },
};

export const IWO_BUDGET_SOURCE_LABELS: Record<IwoBudgetSource, string> = {
  yarn: "Yarn Purchases",
  yarn_process: "Yarn Processes",
  fabric_process: "Fabric Processes",
  material: "Accessories Purchases",
  material_process: "Accessories Processes",
  expense: "Other Expenses",
};

// ---------------------------------------------------------------------------
// What the screen sends
// ---------------------------------------------------------------------------

const num = z.number().nullable().default(null);

export const iwoBudgetLineInput = z.object({
  source: z.enum(["yarn", "yarn_process", "fabric_process", "material", "material_process", "expense"]),
  item_id: z.string().uuid().nullable().default(null),
  process_id: z.string().uuid().nullable().default(null),
  cost_head_id: z.string().uuid().nullable().default(null),
  stage_id: z.string().uuid().nullable().default(null),
  // CAPITALS in the schema (AGENTS.md): free text on a stored line.
  description: capsTextNullable(),
  specification: capsTextNullable(),
  combo: capsTextNullable(),
  basis: z.enum(["process", "fabric", "color"]).nullable().default(null),
  qty: num,
  uom_id: z.string().uuid().nullable().default(null),
  rate: z.number().min(0, "A rate cannot be negative").nullable().default(null),
  rate_type: z.enum(["per_unit", "flat"]).default("per_unit"),
  currency_code: z.string().trim().min(1).nullable().default(null),
  ex_rate: z.number().positive("An exchange rate must be more than 0").nullable().default(null),
  is_foc: z.boolean().default(false),
  is_import: z.boolean().default(false),
  from_bom: z.boolean().default(false),
});

export type IwoBudgetLineInput = z.input<typeof iwoBudgetLineInput>;

export const iwoBudgetInput = z.object({
  iwo_id: z.string().uuid({ message: "Choose the Internal Work Order" }),
  budget_date: z.string().min(1, "Enter the budget date"),
  remark: capsTextNullable(),
  lines: z.array(iwoBudgetLineInput),
});

export type IwoBudgetInput = z.input<typeof iwoBudgetInput>;
export type IwoBudgetParsed = z.infer<typeof iwoBudgetInput>;
