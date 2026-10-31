import { redirect } from "next/navigation";

/** MOVED to Purchase ▸ Receiving (user 2026-10-31) — the old address still works. */
export default function VendorReturnsMoved() {
  redirect("/purchase/vendor-returns");
}
