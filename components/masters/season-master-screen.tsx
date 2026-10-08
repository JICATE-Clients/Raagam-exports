"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createSeason, updateSeason, deleteSeason } from "@/lib/masters/season-actions";
import type { Season } from "@/lib/masters/season-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

/**
 * Master Data ▸ System ▸ Season (2026-10-06). The buying cycles Sample Entry's
 * Season picks from — Q1, Q2, Q3, Q4 seeded by 0686. Season Name is what the
 * picker shows and the one the duplicate check guards (`uq_seasons_season_name`).
 */
const descriptor: SimpleMasterDescriptor<Season> = {
  entityLabel: "Season",
  status: "active",
  fields: [
    { key: "season", label: "Season", required: true, mono: true, widthClass: "w-32" },
    { key: "season_name", label: "Season Name", required: true },
  ],
  fromRow: (r) => ({
    season: r.season ?? "",
    season_name: r.season_name ?? "",
  }),
  searchText: (r) => [r.season, r.season_name].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    season: String(v.season ?? ""),
    season_name: String(v.season_name ?? ""),
    inactive: !s.active,
  }),
  // Rows-only: a season name is the client's own calendar word, no vocabulary.
  spellSuggest: true,
  dupCheck: { table: "seasons", fieldKey: "season_name", nameColumn: "season_name", label: "season" },
  blockEntity: "season",
  actions: { create: createSeason, update: updateSeason, remove: deleteSeason },
};

export function SeasonMasterScreen({ rows, perms }: { rows: Season[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
