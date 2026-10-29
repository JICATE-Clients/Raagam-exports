"use client";

import { useMemo } from "react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { FIELD_WIDTH } from "@/components/ui/field";
import { saveVehicle } from "@/lib/logistics/transport/actions";
import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABEL,
  type Vehicle,
  type VehicleType,
} from "@/lib/logistics/transport/types";
import { TransportStatusPill, fmtKg } from "../_shared/transport-ui";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const TYPE_OPTIONS = VEHICLE_TYPES.map((t) => ({ value: t, label: VEHICLE_TYPE_LABEL[t] }));
/** The only two statuses a person sets by hand (VEHICLE_MANUAL_STATUSES). The
 *  other three belong to the trip the vehicle is on and are shown, not edited. */
const AVAILABILITY_OPTIONS = [
  { value: "idle", label: "Available" },
  { value: "maintenance", label: "Maintenance" },
];

/** A payload is a positive number of kilograms; "1,000" is accepted as typed. */
function kgOf(v: unknown): number {
  return Number(String(v ?? "").replace(/,/g, "").trim());
}

/**
 * Logistics ▸ Transport ▸ Vehicles — the fleet master (plan D8: shared master
 * data, no unit). Modelled on Resolve Hub ▸ Trades: a `SimpleMasterScreen`
 * descriptor in the sheet editor, so the duplicate check on the number, the
 * Active switch at the head of the form, the Created pair and the row icons all
 * come from the engine.
 *
 * Delete switches the vehicle OFF: trips point at it, and a vanished vehicle
 * would blank every trip it ever ran.
 */
export function VehiclesScreen({ rows, perms }: { rows: Vehicle[]; perms: Perms }) {
  const descriptor = useMemo<SimpleMasterDescriptor<Vehicle>>(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    type Payload = {
      vehicle_number: string;
      vehicle_type: VehicleType;
      max_payload_kg: number;
      gps_device_id: string | null;
      status: "idle" | "maintenance";
      inactive: boolean;
    };
    return {
      entityLabel: "Vehicle",
      status: "active",
      editor: "sheet",
      fields: [
        { key: "vehicle_number", label: "Vehicle Number", required: true, widthClass: FIELD_WIDTH.code },
        { key: "vehicle_type", label: "Type", kind: "select", required: true, options: TYPE_OPTIONS, widthClass: FIELD_WIDTH.term },
        { key: "max_payload_kg", label: "Max Payload (kg)", required: true, widthClass: FIELD_WIDTH.range },
        // caps-input: exempt -- not reachable here: SimpleMasterScreen capitalises
        // every text field. So the id is stored in capitals, and the webhook
        // upper-cases what the GPS sends before matching
        // (app/api/transport/telematics/route.ts).
        { key: "gps_device_id", label: "GPS Device ID", widthClass: FIELD_WIDTH.code },
        { key: "availability", label: "Availability", kind: "select", options: AVAILABILITY_OPTIONS, widthClass: FIELD_WIDTH.term },
      ],
      extraColumns: [{ header: "Live Status", cell: (r) => <TransportStatusPill status={r.status} /> }],
      mobileTitleKey: "vehicle_number",
      mobileMeta: (r) => `${VEHICLE_TYPE_LABEL[r.vehicle_type]} · ${fmtKg(r.max_payload_kg)}`,
      fromRow: (r) => ({
        vehicle_number: r.vehicle_number,
        vehicle_type: r.vehicle_type,
        max_payload_kg: String(r.max_payload_kg ?? ""),
        gps_device_id: r.gps_device_id ?? "",
        availability: r.status === "maintenance" ? "maintenance" : "idle",
      }),
      searchText: (r) => [r.vehicle_number, VEHICLE_TYPE_LABEL[r.vehicle_type], r.gps_device_id].filter(Boolean).join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      extraFilters: [
        {
          key: "type",
          label: "Type",
          options: TYPE_OPTIONS,
          predicate: (r, v) => r.vehicle_type === v,
        },
      ],
      dupCheck: { table: "transport_vehicles", fieldKey: "vehicle_number", nameColumn: "vehicle_number", label: "vehicle number" },
      validate: (v) => {
        if (!v.vehicle_type) return "Pick the vehicle type";
        const kg = kgOf(v.max_payload_kg);
        if (!Number.isFinite(kg) || kg <= 0) return "Max payload must be a number of kg above 0";
        return null;
      },
      toPayload: (v, s): Payload => ({
        vehicle_number: String(v.vehicle_number),
        vehicle_type: String(v.vehicle_type) as VehicleType,
        max_payload_kg: kgOf(v.max_payload_kg),
        gps_device_id: String(v.gps_device_id ?? "") || null,
        status: v.availability === "maintenance" ? "maintenance" : "idle",
        inactive: !s.active,
      }),
      actions: {
        create: ((p: Payload) => saveVehicle(p)) as never,
        update: ((id: string, p: Payload) => saveVehicle(p, id)) as never,
        // Switched OFF, never removed — the row re-saved with `inactive`. The
        // server refuses it while the vehicle is on a trip, and says so.
        remove: async (id: string) => {
          const r = byId.get(id);
          if (!r) return { ok: false as const, error: "Vehicle not found" };
          const res = await saveVehicle(
            {
              vehicle_number: r.vehicle_number,
              vehicle_type: r.vehicle_type,
              max_payload_kg: r.max_payload_kg,
              gps_device_id: r.gps_device_id,
              status: r.status === "maintenance" ? "maintenance" : "idle",
              inactive: true,
            },
            id,
          );
          return res.ok ? { ok: true as const, inactive: true } : res;
        },
      },
    };
  }, [rows]);

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
