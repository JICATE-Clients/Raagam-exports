import { redirect } from "next/navigation";

/** Moved with its list to /purchase/opening-stock (user 2026-11-02). Old record links still land. */
export default async function Page({ params }: { params: Promise<{ openingId: string }> }) {
  const { openingId } = await params;
  redirect(`/purchase/opening-stock/${openingId}`);
}
