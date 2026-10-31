import { redirect } from "next/navigation";

/** Retired 2026-10-31: job work is sent and received on Stores ▸ Process DC (0786 · 0787). */
export default function Page() {
  redirect("/stores/process-dc");
}
