import { redirect } from "next/navigation";
import { getVendorReturn } from "@/lib/stores/extras-service";

/** A Rejection / Replacement DC opens inside Delivery Challans now (user 2026-11-02). */
export default async function VendorReturnMoved({ params }: { params: Promise<{ returnId: string }> }) {
  const { returnId } = await params;
  const doc = await getVendorReturn(returnId);
  redirect(`/purchase/dc?view=${returnId}&type=${doc?.dc_kind === "replacement" ? "replacement" : "rejection"}`);
}
