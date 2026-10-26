import "server-only";
import { createClient } from "@/lib/supabase/server";
import { spanWords, dayWords } from "@/components/resolve/admin/span-words";
import { LANE_LABEL } from "./catalog-types";
import type { AssistLane } from "./assist-types";
import { listServiceSla } from "./desk-service";
import { getUnitSettings } from "./service";

/**
 * The one-line summary under each card on Resolve ▸ Settings (the hub at
 * /resolve/setup) — "8 trades · 1 switched off", "12 places without a sticker".
 *
 * Light reads only: each line is one narrow select, run in parallel, under the
 * operator's own RLS (so a unit-scoped table counts this unit). A read that
 * fails leaves its card WITHOUT a line rather than printing "0" — absent is
 * not zero (the same rule `GroupHub` keeps for its counts), and a settings
 * home must not claim a list is empty because a count could not be read.
 */
export type SetupSummary = Record<string, string | null>;

type Res<T> = { data: T[] | null; error: unknown };

async function safe<T>(p: PromiseLike<Res<T>>): Promise<T[] | null> {
  try {
    const r = await p;
    return r.error ? null : (r.data ?? []);
  } catch {
    return null;
  }
}
async function safeCall<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" · ");

export async function getSetupSummary(): Promise<SetupSummary> {
  const s = await createClient();
  const [trades, teams, members, places, rules, areas, items, itCats, concernCats, sla, unit] = await Promise.all([
    safe<{ inactive: boolean }>(s.from("rh_trades").select("inactive")),
    safe<{ id: string; inactive: boolean }>(s.from("rh_teams").select("id, inactive")),
    safe<{ team_id: string; profile_id: string; active: boolean }>(
      s.from("rh_team_members").select("team_id, profile_id, active"),
    ),
    safe<{ inactive: boolean; qr_token: string | null; qr_printed_at: string | null }>(
      s.from("rh_places").select("inactive, qr_token, qr_printed_at"),
    ),
    safe<{ id: string }>(s.from("rh_routing_overrides").select("id")),
    safe<{ id: string; lane: AssistLane; inactive: boolean }>(s.from("rh_catalog_areas").select("id, lane, inactive")),
    safe<{ area_id: string; inactive: boolean }>(s.from("rh_catalog_items").select("area_id, inactive")),
    safe<{ inactive: boolean }>(s.from("rh_sd_categories").select("inactive")),
    safe<{ inactive: boolean; is_sensitive: boolean }>(s.from("rh_complaint_categories").select("inactive, is_sensitive")),
    safeCall(listServiceSla),
    safeCall(getUnitSettings),
  ]);

  const out: SetupSummary = {};

  if (trades) {
    const off = trades.filter((t) => t.inactive).length;
    out["/resolve/setup/trades"] = join(plural(trades.length - off, "trade"), off > 0 && `${off} switched off`);
  }

  if (teams) {
    const live = new Set(teams.filter((t) => !t.inactive).map((t) => t.id));
    const people = members
      ? new Set(members.filter((m) => m.active && live.has(m.team_id)).map((m) => m.profile_id)).size
      : null;
    out["/resolve/setup/teams"] = join(plural(live.size, "team"), people !== null && plural(people, "person", "people"));
  }

  if (places) {
    const on = places.filter((p) => !p.inactive);
    const unprinted = on.filter((p) => !p.qr_printed_at).length;
    out["/resolve/setup/places"] = join(
      plural(on.length, "place"),
      unprinted > 0 ? `${unprinted} without a sticker` : on.length > 0 && "every sticker printed",
    );
  }

  if (rules) {
    out["/resolve/setup/routing"] = rules.length ? plural(rules.length, "special rule") : "No special rules";
  }

  if (areas && items) {
    const laneOf = new Map(areas.filter((a) => !a.inactive).map((a) => [a.id, a.lane]));
    const per = new Map<AssistLane, number>();
    for (const i of items) {
      const lane = !i.inactive ? laneOf.get(i.area_id) : undefined;
      if (lane) per.set(lane, (per.get(lane) ?? 0) + 1);
    }
    const lanes: AssistLane[] = ["fix", "it", "buy", "concern"];
    out["/resolve/setup/problem-catalog"] = lanes.map((l) => `${LANE_LABEL[l]} ${per.get(l) ?? 0}`).join(" · ");
  }

  if (itCats) {
    const off = itCats.filter((c) => c.inactive).length;
    out["/resolve/setup/service-categories"] = join(plural(itCats.length - off, "category", "categories"), off > 0 && `${off} off`);
  }

  if (concernCats) {
    const on = concernCats.filter((c) => !c.inactive);
    const conf = on.filter((c) => c.is_sensitive).length;
    out["/resolve/setup/complaint-categories"] = join(plural(on.length, "category", "categories"), conf > 0 && `${conf} confidential`);
  }

  if (sla) {
    const at = (p: string) => sla.find((x) => x.priority === p);
    const u = at("urgent");
    const h = at("high");
    out["/resolve/setup/service-sla"] = join(
      u && `Urgent ${spanWords(u.response_minutes)}`,
      h && `High ${spanWords(h.response_minutes)}`,
    ) + "…";
  }

  if (unit) {
    out["/resolve/setup/unit-settings"] = join(
      `Ordinary ${dayWords(unit.ordinary_days)}`,
      `Routine ${dayWords(unit.routine_days)}`,
      `${unit.report_limit_24h} reports a day`,
    );
  }

  return out;
}
