import { requirePermission } from "@/lib/auth/server";
import { getLocations } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import {
  listDevices,
  listPunchesToday,
  countPunchesToday,
  getPunchIdentities,
} from "@/lib/hr/punch-service";
import LiveClient from "../attendance/live-client";

/**
 * Time & Attendance ▸ Live — what the biometric devices are sending right now.
 *
 * ITS OWN SIDEBAR ROW SINCE 2026-11-02 (user: "this only live thing can come
 * under as name Live after the Leave & Encashment, remove from here"). It was
 * the third tab of the Attendance page (`?view=live`); that address now lands
 * on the Attendance Report — a remembered workspace tab kept reopening Live
 * from it (see hr/attendance/page.tsx). Every link in the app points here.
 */
export default async function LivePunchesPage() {
  await requirePermission("hr_payroll", "view");
  /**
   * ADMINS ONLY (user 2026-10-23). What this shows is the RAW device feed — a
   * user id as enrolled on a reader, with no person behind it yet. That is a
   * diagnostic, not an HR record. `has_permission` bypasses for a super admin,
   * so 0733's RLS needs no change. Widen to HR admins by also accepting
   * `hr_payroll` edit.
   */
  await requirePermission("system_admin", "view");

  /**
   * The IST day boundary and the clock are both resolved HERE, on the server,
   * and handed down as props — `live-client.tsx` must not call `Date.now()` in
   * a render (impure, and it would be the viewer's clock rather than the one
   * the punches were stamped against).
   *
   * No location filter: a punch is scoped by its DEVICE's unit through RLS, not
   * by a picker, so narrowing it here would hide rows the viewer may see.
   */
  const serverNowIso = new Date().toISOString();
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(serverNowIso),
  );
  const todayFromIso = `${todayIst}T00:00:00+05:30`;

  const [devices, punches, todayCount, identities, locations] = await Promise.all([
    listDevices(),
    listPunchesToday(todayFromIso),
    countPunchesToday(todayFromIso),
    getPunchIdentities(),
    getLocations(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Live" description="What the biometric devices are sending, as it arrives." />
      <LiveClient
        devices={devices}
        punches={punches}
        identities={identities}
        locations={locations}
        todayCount={todayCount}
        todayFromIso={todayFromIso}
        serverNowIso={serverNowIso}
      />
    </div>
  );
}
