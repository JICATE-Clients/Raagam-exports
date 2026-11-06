import { redirect } from "next/navigation";

/**
 * Time & Attendance ▸ Leave & Encashment is gone from the sidebar (user
 * 2026-11-03: "remove leave & encashment from time and attendance"). HR ▸ Time
 * Off does the same job — Leave, Permission, Encashment, Balances, with the
 * approval flow and the in-advance rule (0798) — and this screen held no
 * records (hr_leaves had 0 rows). Its address answers by opening Time Off, so a
 * bookmark or a remembered workspace tab still lands somewhere that works.
 * Declared in REDIRECTED, scripts/check-module-groups.mts.
 */
export default function LeavePage() {
  redirect("/hr/time-off");
}
