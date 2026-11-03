import { redirect } from "next/navigation";

/** Moved with its list to /purchase/csp-receipts (user 2026-11-02). Old record links still land. */
export default async function Page({ params }: { params: Promise<{ cspId: string }> }) {
  const { cspId } = await params;
  redirect(`/purchase/csp-receipts/${cspId}`);
}
