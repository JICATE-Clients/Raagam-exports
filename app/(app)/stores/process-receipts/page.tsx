import { redirect } from "next/navigation";

/** Retired 2026-10-31: job work is sent and received on Purchase ▸ Receiving ▸ Delivery Challans (0786 · 0787). */
export default function Page() {
  redirect("/purchase/dc?type=process");
}
