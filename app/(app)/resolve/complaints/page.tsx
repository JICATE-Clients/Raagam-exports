import { redirect } from "next/navigation";

/** Complaints are worked in the one Inbox (sidebar de-dup 2026-10-26). */
export default function Page() {
  redirect("/resolve/inbox");
}
