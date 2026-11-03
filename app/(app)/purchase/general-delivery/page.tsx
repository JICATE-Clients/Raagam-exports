import DcHubPage from "../dc/page";

/**
 * PURCHASE ▸ PURCHASE STORE ▸ GENERAL DELIVERY (0796) — material sent out to a party for
 * repair, sample, loan or gift, returnable or not. It is a kind of the ONE Delivery Challan
 * (doc/stores/dc-plan.md, "One hub"), so this row opens the DC hub on its General tab rather
 * than a second register: same numbering, same list, same print kit. A real route, not a
 * redirect, so the sidebar row resolves to itself.
 */
type Search = { type?: string; new?: string; edit?: string; receive?: string; order?: string; view?: string };

export default async function GeneralDeliveryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  return DcHubPage({ searchParams: Promise.resolve({ ...sp, type: sp.type ?? "general" }) });
}
