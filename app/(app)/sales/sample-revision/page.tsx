import { redirect } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { listRaisableSamples, listSampleRevisions } from "@/lib/sales/sample-revisions/service";
import { RevisionListScreen } from "./revision-list-screen";

/**
 * Sample ▸ Revision (0716, doc/sample/sample revion.md) — the register of
 * sample revisions, and the door to raise one on a locked (costing approved)
 * sample.
 *
 * `?raise=<sample>` — Costing's "Raise Revision": the form opens on that
 * sample, or, when it already has an open revision, that revision opens.
 */
export default async function SampleRevisionPage({ searchParams }: { searchParams: Promise<{ raise?: string }> }) {
  await requirePermission("sales", "view");
  const { raise } = await searchParams;
  const [rows, raisable, canEdit] = await Promise.all([listSampleRevisions(), listRaisableSamples(), can("sales", "edit")]);
  if (raise) {
    const open = rows.find((r) => r.opportunity_id === raise && (r.status === "draft" || r.status === "pending"));
    if (open) redirect(`/sales/sample-revision/${open.id}`);
  }
  const initialRaise = raise && canEdit && raisable.some((o) => o.id === raise) ? raise : null;
  return <RevisionListScreen rows={rows} raisable={raisable} canEdit={canEdit} initialRaise={initialRaise} />;
}
