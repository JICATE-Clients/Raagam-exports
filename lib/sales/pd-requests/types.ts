import type { PdRequestStatus } from "@/lib/sales/sample-entry/types";

/**
 * Sample ▸ PD Request · Acknowledge PD Request — the two screens over 0719's
 * `sample_pd_requests` (client spec 2026-10-14, "Product Development Request").
 *
 * RAISED PER SMP (user 2026-10-14; 0724). 0723 moved it onto the SWO the same
 * day and the user reversed it: "The PD request is for smp not for swo". One
 * request names one sample entry; the request shows every style of that SMP,
 * fetched rather than re-typed, with the tech packs carried forward. The one
 * request 0723 raised on an SWO stays on the register as history
 * (`group_id` set, `opportunity_id` null).
 *
 * Both screens answer through the approval engine (workflow
 * `sample_pd_request`), so the inbox and these screens can never disagree.
 *
 * Client-safe: no server imports, so both screens and the actions read it.
 */

/** Where every request goes — the spec's fixed "To Department". */
export const PD_TO_DEPARTMENT = "Sample Department";

/**
 * MAY A NEW REQUEST BE RAISED ON THIS SMP? None sent yet, or the last one
 * came back Not Acknowledged / was withdrawn. One open at a time is also the
 * database's rule (0719's partial unique index); an acknowledged SMP has
 * nothing left to ask.
 */
export function canRaisePd(latest: PdRequestStatus | null): boolean {
  return !latest || latest === "not_acknowledged" || latest === "cancelled";
}

/** A saved SMP — a Pending card and an SMP No option — with its latest request. */
export type PdSmpOption = {
  /** `opportunities.id`. */
  id: string;
  smp_no: string;
  customer: string | null;
  season: string | null;
  style_names: string[];
  sample_types: string[];
  pieces: number;
  /** The earliest line delivery date — when the first piece is owed. */
  target_date: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name?: string | null;
};

/**
 * ONE ROW OF THE PD REQUEST SCREEN (user 2026-10-14: "in pending state list
 * the smp as card type") — one per SMP, carrying its latest request, plus the
 * SWO request 0723 recorded (history, no SMP of its own).
 */
export type PdQueueRow = {
  key: string;
  /** The SMP, or null for the 0723 SWO request. */
  smp: PdSmpOption | null;
  /** The latest request — null while none was sent. */
  request: PdRequestRow | null;
};

/** One style line of the sample, as the request shows it (fetched, never typed). */
export type PdStyleLine = {
  id: string;
  /** The SMP the style belongs to — an SWO carries several. */
  smp_no: string | null;
  sample_no: string | null;
  name: string;
  article_no: string;
  sample_type: string;
  sample_qty: number;
  unit: string;
  /** Target Delivery Date — the line's own. */
  delivery_date: string | null;
  /** Fabric structure · GSM, one per structure picked on Product Info (0715). */
  fabrics: { structure: string; gsm: number | null }[];
  /** The yarn mix from the line's current costing, or null when not costed yet. */
  composition: string | null;
  /** Colour × size pieces from Sample Entry's Quantities — what to make in which colour and size. */
  combos: { combo: string; sizes: { size: string; qty: number }[] }[];
};

/** A file carried forward from Sample Entry — the tech pack and garment images. */
export type PdFile = {
  style: string;
  kind: "Tech Pack" | "Garment Image";
  file_name: string;
  /** A signed URL (the bucket is private, 0686); null when it would not sign. */
  url: string | null;
};

/** Everything the request shows about one SMP (or, for the 0723 request, its SWO). */
export type PdSample = {
  group_id: string | null;
  swo_no: string | null;
  description: string | null;
  smp_nos: string[];
  /** The customer — every one across the SWO's samples on the 0723 request. */
  customer: string | null;
  season: string | null;
  /** Sample Info's Tech Pack status, as words. */
  tech_pack: string | null;
  styles: PdStyleLine[];
  files: PdFile[];
  total_pieces: number;
};

/** A request on the register / the Sample Department's queue. */
export type PdRequestRow = {
  id: string;
  opportunity_id: string | null;
  group_id: string | null;
  /** Set only on the request 0723 raised per SWO (history). */
  swo_no: string | null;
  smp_nos: string[];
  customer: string | null;
  season: string | null;
  style_names: string[];
  sample_types: string[];
  pieces: number;
  /** The earliest line delivery date — when the first piece is owed. */
  target_date: string | null;
  status: PdRequestStatus;
  note: string | null;
  decision_remark: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name?: string | null;
};
