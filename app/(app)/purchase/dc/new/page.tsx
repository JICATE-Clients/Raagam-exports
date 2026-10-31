import { redirect } from "next/navigation";

/**
 * Retired 2026-10-31: a job-work DC always goes out against a Process Order (0786, user
 * decision), so a new one is raised on Stores ▸ Process DC. A Production DC is raised on
 * Stores ▸ Production DC; Rejection / Replacement DCs come from a GRN.
 */
export default function NewDcPage() {
  redirect("/stores/process-dc?send=new");
}
