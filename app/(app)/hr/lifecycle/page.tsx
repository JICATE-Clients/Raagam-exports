import { redirect } from "next/navigation";

/**
 * People ▸ Lifecycle was REMOVED (user 2026-11-04: "remove lifecycle from
 * people"). Team Lifecycle — joining checklists, documents, exits and full &
 * final — does the same job, and the old screen held no events. A bookmark or
 * an old workspace tab lands there instead of on a 404.
 */
export default function LifecyclePage() {
  redirect("/hr/team");
}
