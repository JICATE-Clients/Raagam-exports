"use client";

import { useMemo } from "react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { FIELD_WIDTH } from "@/components/ui/field";
import { isInactive } from "@/lib/masters/inactive";
import { savePlace } from "@/lib/logistics/transport/actions";
import {
  PLACE_KINDS,
  type PlaceKind,
  type TransportPlace,
} from "@/lib/logistics/transport/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Opt = { id: string; name: string; inactive?: boolean | null };

const KIND_LABEL: Record<PlaceKind, string> = { unit: "Our Unit", vendor: "Vendor", other: "Other" };
const KIND_OPTIONS = PLACE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));

/** A coordinate box: blank is "no geofence yet", anything else must be a number. */
function numOrNull(v: unknown): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  return s === "" ? null : Number(s);
}

/**
 * Logistics ▸ Transport ▸ Transport Places — every stop a vehicle can start or
 * end at (plan D3). A place is a ROW, not typed text, because geofencing needs
 * coordinates and "Dyeing Unit A" typed three ways is three places.
 *
 * Same engine as Vehicles (`SimpleMasterScreen`, sheet editor). Unit and Vendor
 * are offered whatever the Kind, and `validate` asks for the one the Kind needs
 * — the same rule `placeInput`'s superRefine applies on the server, so the
 * screen only says it sooner.
 *
 * Lat / Lng / Radius are optional: a place without them still books trips; it
 * simply never moves a trip by GPS (plan D6 — GPS is optional).
 */
export function PlacesScreen({
  rows,
  perms,
  units,
  vendors,
}: {
  rows: TransportPlace[];
  perms: Perms;
  units: Opt[];
  vendors: Opt[];
}) {
  const descriptor = useMemo<SimpleMasterDescriptor<TransportPlace>>(() => {
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
    // AGENTS.md "Disabled rows": a switched-off vendor is not offered — but a
    // place that already names one keeps it, so editing it does not blank the FK.
    const heldVendors = new Set(rows.map((r) => r.vendor_id).filter(Boolean));
    const vendorOptions = [
      { value: "", label: "" },
      ...vendors
        .filter((v) => !isInactive(v) || heldVendors.has(v.id))
        .map((v) => ({ value: v.id, label: isInactive(v) ? `${v.name} (inactive)` : v.name })),
    ];
    const unitOptions = [{ value: "", label: "" }, ...units.map((u) => ({ value: u.id, label: u.name }))];

    type Payload = {
      name: string;
      kind: PlaceKind;
      location_id: string | null;
      vendor_id: string | null;
      lat: number | null;
      lng: number | null;
      radius_m: number;
      inactive: boolean;
    };
    return {
      entityLabel: "Place",
      status: "active",
      editor: "sheet",
      fields: [
        { key: "name", label: "Place Name", required: true, widthClass: FIELD_WIDTH.name },
        { key: "kind", label: "Kind", kind: "select", required: true, options: KIND_OPTIONS, widthClass: FIELD_WIDTH.code },
        {
          key: "location_id",
          label: "Unit",
          kind: "select",
          options: unitOptions,
          optionLabel: (v) => unitName.get(v) ?? "—",
          widthClass: FIELD_WIDTH.term,
        },
        {
          key: "vendor_id",
          label: "Vendor",
          kind: "select",
          options: vendorOptions,
          optionLabel: (v) => vendorName.get(v) ?? "—",
          widthClass: FIELD_WIDTH.party,
        },
        { key: "lat", label: "Latitude", widthClass: FIELD_WIDTH.code },
        { key: "lng", label: "Longitude", widthClass: FIELD_WIDTH.code },
        { key: "radius_m", label: "Radius (m)", widthClass: FIELD_WIDTH.range },
      ],
      mobileTitleKey: "name",
      mobileMeta: (r) =>
        [KIND_LABEL[r.kind], r.location_id ? unitName.get(r.location_id) : r.vendor_id ? vendorName.get(r.vendor_id) : null]
          .filter(Boolean)
          .join(" · "),
      fromRow: (r) => ({
        name: r.name,
        kind: r.kind,
        location_id: r.location_id ?? "",
        vendor_id: r.vendor_id ?? "",
        lat: r.lat == null ? "" : String(r.lat),
        lng: r.lng == null ? "" : String(r.lng),
        radius_m: String(r.radius_m ?? 200),
      }),
      searchText: (r) =>
        [r.name, KIND_LABEL[r.kind], r.location_id && unitName.get(r.location_id), r.vendor_id && vendorName.get(r.vendor_id)]
          .filter(Boolean)
          .join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      extraFilters: [{ key: "kind", label: "Kind", options: KIND_OPTIONS, predicate: (r, v) => r.kind === v }],
      dupCheck: { table: "transport_places", fieldKey: "name", nameColumn: "name" },
      spellSuggest: true,
      validate: (v) => {
        if (!v.kind) return "Pick the kind of place";
        if (v.kind === "unit" && !v.location_id) return "Pick the unit this place is";
        if (v.kind === "vendor" && !v.vendor_id) return "Pick the vendor this place is";
        const lat = numOrNull(v.lat);
        const lng = numOrNull(v.lng);
        if ((lat == null) !== (lng == null)) return "Give both latitude and longitude, or neither";
        if (lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return "Latitude is between -90 and 90";
        if (lng != null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return "Longitude is between -180 and 180";
        const r = numOrNull(v.radius_m);
        if (r != null && (!Number.isInteger(r) || r < 20 || r > 50000)) return "Radius is a whole number of metres, 20 to 50,000";
        return null;
      },
      toPayload: (v, s): Payload => {
        const kind = String(v.kind) as PlaceKind;
        return {
          name: String(v.name),
          kind,
          // Only the link the Kind means is kept — a unit place carrying a stale
          // vendor would read as both.
          location_id: kind === "unit" ? String(v.location_id) || null : null,
          vendor_id: kind === "vendor" ? String(v.vendor_id) || null : null,
          lat: numOrNull(v.lat),
          lng: numOrNull(v.lng),
          radius_m: numOrNull(v.radius_m) ?? 200,
          inactive: !s.active,
        };
      },
      actions: {
        create: ((p: Payload) => savePlace(p)) as never,
        update: ((id: string, p: Payload) => savePlace(p, id)) as never,
        // Switched OFF, never removed — requests and trips point at places.
        remove: async (id: string) => {
          const r = rows.find((x) => x.id === id);
          if (!r) return { ok: false as const, error: "Place not found" };
          const res = await savePlace(
            {
              name: r.name,
              kind: r.kind,
              location_id: r.location_id,
              vendor_id: r.vendor_id,
              lat: r.lat,
              lng: r.lng,
              radius_m: r.radius_m,
              inactive: true,
            },
            id,
          );
          return res.ok ? { ok: true as const, inactive: true } : res;
        },
      },
    };
  }, [rows, units, vendors]);

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
