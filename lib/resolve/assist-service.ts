import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canRh } from "./auth";
import { listServiceSla } from "./desk-service";
import { DEFAULT_SERVICE_SLA } from "./desk-types";
import { listReportablePlaces } from "./service";
import { ASSIST_LANES, type AssistArea, type AssistItem, type AssistLane } from "./assist-types";

/**
 * The whole Raagam Assist catalog in ONE call (`rh_assist_catalog`, 0751):
 * areas of every lane with their items, most-used first. Empty for a login
 * without resolve:view — the chat then explains instead of offering taps.
 */
export async function getAssistCatalog(): Promise<AssistArea[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("rh_assist_catalog");
  if (error) throw new Error(`Reading the problem catalog: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as Partial<AssistArea>[];
  return rows
    .filter((a): a is AssistArea => !!a.id && ASSIST_LANES.includes(a.lane as AssistLane))
    .map((a) => ({
      id: a.id,
      lane: a.lane,
      code: a.code,
      label: a.label,
      icon: a.icon || "circle",
      items: ((a.items ?? []) as Partial<AssistItem>[])
        .filter((i): i is AssistItem => !!i.id)
        .map((i) => ({
          id: i.id,
          code: i.code,
          label: i.label,
          synonyms: i.synonyms ?? [],
          details: i.details ?? [],
          dangerous: !!i.dangerous,
          anonymous_ok: !!i.anonymous_ok,
          sensitive: !!i.sensitive,
        })),
    }));
}

/** Who to call before a dangerous item (rh_unit_settings.emergency_contact, 0751). */
export async function getEmergencyContact(): Promise<string | null> {
  const s = await createClient();
  const { data } = await s.from("rh_unit_settings").select("emergency_contact").maybeSingle();
  const v = (data as { emergency_contact?: string | null } | null)?.emergency_contact;
  return v && v.trim() ? v.trim() : null;
}

/** Everything `AssistChat` needs, in one parallel read (the four Resolve Hub
 *  reporting pages all render the same chat). */
export async function loadAssistChat() {
  const [canReport, areas, places, sla, emergencyContact] = await Promise.all([
    canRh("view"),
    getAssistCatalog(),
    listReportablePlaces(),
    listServiceSla(),
    getEmergencyContact(),
  ]);
  const medium =
    sla.find((r) => r.priority === "medium") ?? DEFAULT_SERVICE_SLA.find((r) => r.priority === "medium");
  return {
    canReport,
    areas,
    places: places.map((p) => ({ id: p.id, code: p.code, name: p.name, default_trade_id: p.default_trade_id })),
    replyMinutes: medium?.response_minutes ?? 30,
    emergencyContact,
  };
}
