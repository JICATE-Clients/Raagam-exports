import { redirect } from "next/navigation";

/** MOVED to /purchase/vendor-returns (user 2026-10-31) — a saved print link still opens the DC. */
export default async function VendorReturnPrintMoved({ params }: { params: Promise<{ returnId: string }> }) {
  const { returnId } = await params;
  redirect(`/purchase/vendor-returns/${returnId}/print`);
}
