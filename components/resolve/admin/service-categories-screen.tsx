"use client";

import { useMemo } from "react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { FIELD_WIDTH } from "@/components/ui/field";
import { saveServiceCategory, setServiceCategoryInactive } from "@/lib/resolve/desk-actions";
import {
  PRIORITY_LABEL,
  TICKET_TYPES,
  TICKET_TYPE_LABEL,
  type ServiceCategoryRow,
  type TicketType,
} from "@/lib/resolve/desk-types";
import type { Priority } from "@/lib/resolve/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type TeamOption = { id: string; name: string; inactive: boolean };
type DefaultPriority = Exclude<Priority, "urgent">;

/** Urgent is never a default — it exists only by override (plan §1.3). */
const DEFAULT_PRIORITIES: DefaultPriority[] = ["high", "medium", "low"];

/**
 * Resolve Hub ▸ Administration ▸ Service Categories — what an IT request can
 * be about (plan §2 `rh_sd_categories`), per unit. Each one names its TYPE
 * (incident / service request / change), the TEAM it routes to (skill-based
 * routing, spec §4.2) and the priority FLOOR a request starts at whatever the
 * requester's impact says.
 *
 * THE CODE IS TYPED, AND LOCKED ONCE SAVED — unlike Trades, where it is
 * derived. The knowledge base is shared across units and keyed by category
 * CODE (plan §1.7), so the code is the thing articles point at: renaming the
 * category is safe, changing its code would orphan every article filed under it.
 *
 * Delete switches the category OFF: tickets point at it, and a vanished
 * category would blank them. An off category stops being offered on the form.
 */
export function ServiceCategoriesScreen({
  rows,
  teams,
  perms,
}: {
  rows: ServiceCategoryRow[];
  teams: TeamOption[];
  perms: Perms;
}) {
  const descriptor = useMemo<SimpleMasterDescriptor<ServiceCategoryRow>>(() => {
    // AGENTS "Disabled rows": an off team is not offered — except the one a
    // category already routes to, kept (tagged) so the field never reads blank.
    const held = new Set(rows.map((r) => r.team_id).filter(Boolean));
    const teamOptions = teams
      .filter((t) => !t.inactive || held.has(t.id))
      .map((t) => ({ value: t.id, label: t.inactive ? `${t.name} (inactive)` : t.name }));
    type Payload = {
      code: string;
      name: string;
      description: string | null;
      ticket_type: TicketType;
      team_id: string | null;
      default_priority: DefaultPriority;
      inactive: boolean;
    };
    return {
      entityLabel: "Service Category",
      status: "active",
      editor: "sheet",
      fields: [
        { key: "code", label: "Code", required: true, mono: true, lockedOnEdit: true, widthClass: FIELD_WIDTH.code },
        { key: "name", label: "Name", required: true, widthClass: FIELD_WIDTH.party },
        {
          key: "ticket_type",
          label: "Type",
          kind: "select",
          required: true,
          options: TICKET_TYPES.map((t) => ({ value: t, label: TICKET_TYPE_LABEL[t] })),
          widthClass: FIELD_WIDTH.term,
        },
        { key: "team_id", label: "Team", kind: "select", options: teamOptions, widthClass: FIELD_WIDTH.party },
        {
          key: "default_priority",
          label: "Default Priority",
          kind: "select",
          required: true,
          options: DEFAULT_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
          widthClass: FIELD_WIDTH.code,
        },
        { key: "description", label: "Description", widthClass: FIELD_WIDTH.name },
      ],
      fromRow: (r) => ({
        code: r.code,
        name: r.name,
        ticket_type: r.ticket_type,
        team_id: r.team_id ?? "",
        default_priority: r.default_priority,
        description: r.description ?? "",
      }),
      searchText: (r) => [r.code, r.name, r.team_name, TICKET_TYPE_LABEL[r.ticket_type], r.description].filter(Boolean).join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      dupCheck: { table: "rh_sd_categories", fieldKey: "name", nameColumn: "name" },
      spellSuggest: true,
      validate: (v) => (!v.ticket_type ? "Pick the type" : !v.default_priority ? "Pick the default priority" : null),
      toPayload: (v, s): Payload => ({
        code: String(v.code),
        name: String(v.name),
        description: String(v.description ?? "") || null,
        ticket_type: v.ticket_type as TicketType,
        team_id: String(v.team_id ?? "") || null,
        default_priority: (String(v.default_priority) || "low") as DefaultPriority,
        inactive: !s.active,
      }),
      actions: {
        create: ((p: Payload) => saveServiceCategory(p)) as never,
        update: ((id: string, p: Payload) => saveServiceCategory({ ...p, id })) as never,
        remove: async (id: string) => {
          const res = await setServiceCategoryInactive(id, true);
          return res.ok ? { ok: true as const, inactive: true } : res;
        },
      },
    };
  }, [rows, teams]);

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
