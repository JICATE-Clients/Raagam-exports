import { redirect } from "next/navigation";

/**
 * The cost sheet's old address. It moved into Costing ▸ Reports (2026-10-09) so
 * the Cost Sheet and the Quotation share one door, like Order Entry's reports;
 * a redirect rather than a deletion keeps every saved link and bookmark working.
 */
export default async function CostSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sales/sample-costing/${id}/reports?tab=cost-sheet`);
}
