import { can, requirePermission } from "@/lib/auth/server";
import { listPdRequests } from "@/lib/sales/pd-requests/service";
import { PdAcknowledgeScreen } from "./pd-acknowledge-screen";

/**
 * SAMPLE ▸ ACKNOWLEDGE PD REQUEST (client spec 2026-10-14) — the Sample
 * Department's queue. The supervisor opens a request, reviews the specs and
 * piece count, and answers Acknowledged (accepts the sample job) or Not
 * Acknowledged (with a reason, which reaches the merchandiser). The answer is
 * the `sample_pd_request` run's approve / reject — the approvals inbox carries
 * the same item, and its row lands here (`?open=<request>`).
 *
 * A request is for one SWO (0723) — the batch Sample ▸ Grouping made — and
 * shows every SMP in it.
 */
export const metadata = { title: "Acknowledge PD Request" };

export default async function PdAcknowledgePage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  await requirePermission("sales", "view");
  const [rows, canApprove, sp] = await Promise.all([listPdRequests(), can("approvals", "approve"), searchParams]);
  const open = sp.open && rows.some((r) => r.id === sp.open) ? sp.open : null;
  return <PdAcknowledgeScreen rows={rows} canApprove={canApprove} initialOpen={open} />;
}
