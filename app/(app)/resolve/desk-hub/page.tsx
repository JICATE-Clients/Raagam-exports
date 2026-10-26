import { redirect } from "next/navigation";

/** The Service Desk hub folded into Work + Reports (sidebar de-dup 2026-10-26). */
export default function Page() {
  redirect("/resolve/insights");
}
