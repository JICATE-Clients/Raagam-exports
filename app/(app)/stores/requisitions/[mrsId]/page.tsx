import { redirect } from "next/navigation";

/** Moved with its list to /purchase/requisitions (user 2026-11-02). Old record links still land. */
export default async function Page({ params }: { params: Promise<{ mrsId: string }> }) {
  const { mrsId } = await params;
  redirect(`/purchase/requisitions/${mrsId}`);
}
