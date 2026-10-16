import { can, requirePermission } from "@/lib/auth/server";
import { listPdRequests, listPdSmpOptions } from "@/lib/sales/pd-requests/service";
import { canRaisePd } from "@/lib/sales/pd-requests/types";
import { PdRequestScreen } from "./pd-request-screen";

/**
 * SAMPLE ▸ PD REQUEST (client spec 2026-10-14, "Product Development Request")
 * — the merchandiser's official handover to the Sample Department.
 *
 * PER SMP (user 2026-10-14: "The PD request is for smp not for swo"; 0724
 * reversed 0723's per-SWO request). Pending lists every saved SMP the
 * department has not acknowledged, as cards; New PD Request: From (the
 * signed-in merchandiser) · To Department (Sample Department) · SMP No, its
 * styles fetched on the pick, remarks, and the tech packs carried forward.
 * Sending starts the `sample_pd_request` run, which alerts the department;
 * they answer on Sample ▸ PD Acknowledge.
 *
 * `?new=<opportunity id>` opens the form on that SMP, when one may be raised on it.
 */
export const metadata = { title: "PD Request" };

export default async function PdRequestPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requirePermission("sales", "view");
  const [rows, options, canEdit, sp] = await Promise.all([listPdRequests(), listPdSmpOptions(), can("sales", "edit"), searchParams]);
  // The SMP's latest request — `rows` are oldest-first.
  const latest = sp.new ? (rows.filter((r) => r.opportunity_id === sp.new).at(-1)?.status ?? null) : null;
  const initialNew = canEdit && sp.new && options.some((o) => o.id === sp.new) && canRaisePd(latest) ? sp.new : null;
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
