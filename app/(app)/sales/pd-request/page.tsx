import { can, requirePermission } from "@/lib/auth/server";
import { listPdRequests, listPdSwoOptions } from "@/lib/sales/pd-requests/service";
import { canRaisePd } from "@/lib/sales/pd-requests/types";
import { PdRequestScreen } from "./pd-request-screen";

/**
 * SAMPLE ▸ PD REQUEST (client spec 2026-10-14, "Product Development Request")
 * — the merchandiser's official handover to the Sample Department.
 *
 * The register of every request sent, and New PD Request: From (the signed-in
 * merchandiser) · To Department (Sample Department) · SWO No (0723 — one
 * request per SWO, raised after Grouping, never per SMP), every SMP in the SWO
 * fetched on the pick, remarks, and the tech packs carried forward.
 * Sending starts the `sample_pd_request` run, which alerts the department;
 * they answer on Sample ▸ Acknowledge PD Request.
 *
 * `?new=<swo>` opens the form on that SWO, when one may be raised on it.
 */
export const metadata = { title: "PD Request" };

export default async function PdRequestPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requirePermission("sales", "view");
  const [rows, options, canEdit, sp] = await Promise.all([listPdRequests(), listPdSwoOptions(), can("sales", "edit"), searchParams]);
  const initialNew = canEdit && sp.new && options.some((o) => o.id === sp.new && canRaisePd(o.latest)) ? sp.new : null;
  return (
    <PdRequestScreen
      rows={rows}
      options={options}
      canEdit={canEdit}
      from={user.fullName ?? user.email ?? null}
      initialNew={initialNew}
    />
  );
}
