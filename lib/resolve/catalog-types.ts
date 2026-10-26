// Problem Catalog administration (0751, doc/resolve/assist-catalog-plan.md §4)
// — the row shapes Administration ▸ Problem Catalog edits. Types only: a
// "use server" file may not re-export them.

import type { AssistLane } from "./assist-types";

export const LANE_LABEL: Record<AssistLane, string> = {
  fix: "Fix",
  it: "IT",
  buy: "Buy",
  concern: "Concern",
};

export type CatalogAreaRow = {
  id: string;
  lane: AssistLane;
  code: string;
  label: string;
  icon: string;
  details: string[];
  sort: number;
  inactive: boolean;
  created_by: string | null;
  created_at: string;
};

export type CatalogItemRow = {
  id: string;
  area_id: string;
  code: string;
  label: string;
  synonyms: string[];
  /** NULL = the area's chips. */
  details: string[] | null;
  dangerous: boolean;
  trade_code: string | null;
  sd_category_code: string | null;
  complaint_category_code: string | null;
  sort: number;
  inactive: boolean;
  used_count: number;
  created_by: string | null;
  created_at: string;
};

/** The routing words each lane points at, BY CODE (the 0749 rule). */
export type RoutingCode = { code: string; name: string; inactive: boolean };
export type CatalogRouting = { trades: RoutingCode[]; it: RoutingCode[]; concern: RoutingCode[] };

/** Which item column routes a lane — Buy has none (it goes to Stores). */
export const LANE_ROUTE_COLUMN: Record<AssistLane, "trade_code" | "sd_category_code" | "complaint_category_code" | null> = {
  fix: "trade_code",
  it: "sd_category_code",
  buy: null,
  concern: "complaint_category_code",
};
