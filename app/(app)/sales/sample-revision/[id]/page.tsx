import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { getSampleRevision, revisionComparison } from "@/lib/sales/sample-revisions/service";
import { RevisionDetailScreen } from "./revision-detail-screen";

/** One Sample Revision — its modules, the V0 / proposed comparison, Send to MD. */
export default async function SampleRevisionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales", "view");
  const { id } = await params;
  const rev = await getSampleRevision(id);
  if (!rev) notFound();
  const [comparison, canEdit] = await Promise.all([revisionComparison(rev), can("sales", "edit")]);
  return <RevisionDetailScreen rev={rev} comparison={comparison} canEdit={canEdit} />;
}
