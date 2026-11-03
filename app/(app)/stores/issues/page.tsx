import { redirect } from "next/navigation";

/** Stores ▸ Issues & Requisitions moved to Purchase (Requisitions → General Items, Inter-dept → Purchase Store) (user 2026-11-02, purchase child alignment). The group's old hub address answers. */
export default function Page() {
  redirect("/purchase/general-items");
}
