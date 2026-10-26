import { redirect } from "next/navigation";

/** Named complaints joined My Reports (2026-10-26) — one list of everything I raised. */
export default function Page() {
  redirect("/resolve/my-reports");
}
