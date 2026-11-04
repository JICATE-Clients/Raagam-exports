import { redirect } from "next/navigation";

/** Moved to Purchase (2026-11-02), then into the Delivery Challans hub's Department tab (user 2026-11-04). The old Stores address answers. */
export default function Page() {
  redirect("/purchase/dc?type=department");
}
