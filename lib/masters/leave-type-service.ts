import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LeaveType } from "./leave-type-types";

export async function listLeaveTypes(): Promise<LeaveType[]> {
  const s = await createClient();
  const { data } = await s.from("leave_types").select("*").order("code");
  return (data ?? []) as LeaveType[];
}
