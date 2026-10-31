import { redirect } from "next/navigation";

/** MOVED to /purchase/vendor-returns (user 2026-10-31) — a saved link still opens the return. */
export default async function VendorReturnMoved({ params }: { params: Promise<{ returnId: string }> }) {
  const { returnId } = await params;
  redirect(`/purchase/vendor-returns/${returnId}`);
}
