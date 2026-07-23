"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createSeason, updateSeason, deleteSeason } from "@/lib/masters/season-actions";
import type { Season } from "@/lib/masters/season-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const descriptor: SimpleMasterDescriptor<Season> = {
  entityLabel: "Season",
  ioEntityKey: "seasons",
  status: "active",
  fields: [
    { key: "season", label: "Season", required: true, widthClass: "w-32" },
    { key: "season_yr", label: "Year", widthClass: "w-24" },
    { key: "season_name", label: "Season Name" },
  ],
  fromRow: (r) => ({
    season: r.season ?? "",
    season_yr: r.season_yr ?? "",
    season_name: r.season_name ?? "",
  }),
  searchText: (r) => [r.season, r.season_yr, r.season_name].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    season: String(v.season) || null,
    season_yr: String(v.season_yr) || null,
    season_name: String(v.season_name) || null,
    inactive: !s.active,
  }),
  dupCheck: { table: "seasons", fieldKey: "season_name", nameColumn: "season_name" },
  actions: { create: createSeason, update: updateSeason, remove: deleteSeason },
};

export function SeasonMasterScreen({ rows, perms }: { rows: Season[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
