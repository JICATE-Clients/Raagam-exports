import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";

/* ADMINISTRATION OPENS ON USERS (user 2026-10-01). The module row used to land
   on a hand-maintained card grid that duplicated the sidebar's own children —
   every other screen here is one click away in the rail, so the landing page
   was a stop on the way to Users, the screen this module is opened for. Same
   permission as /admin/users, so the redirect cannot send anyone somewhere the
   gate would refuse; the gate stays here so an unpermitted caller is refused
   at the module root rather than one hop later. */
export default async function AdminPage() {
  await requirePermission("system_admin", "view");
  /* OPENS ON ITS OVERVIEW since 2026-11-06 (wave 2); Users stays the first screen in the
     sidebar under it. Same gate, so nobody is sent where they would be refused. */
  redirect("/admin/overview");
}
