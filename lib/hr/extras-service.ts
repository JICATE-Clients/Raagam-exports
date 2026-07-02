import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeType } from "./extras-types";
import type {
  HrAdvance,
  HrAdjustment,
  HrCompEvent,
  HrLeave,
  HrLifecycleEvent,
  HrStatutoryDoc,
} from "./extras-types";

/** A pickable employee across the three employee tables. */
export type EmployeeOption = {
  type: EmployeeType;
  id: string;
  code: string | null;
  name: string;
};

/** Combined worker + staff + contractor picker list. */
export async function getEmployees(): Promise<EmployeeOption[]> {
  const s = await createClient();
  const [{ data: workers }, { data: staff }, { data: contractors }] = await Promise.all([
    s.from("workers").select("id, code, name").eq("is_active", true).order("name"),
    s.from("staff").select("id, code, name").eq("is_active", true).order("name"),
    s.from("contractors").select("id, code, name").eq("is_active", true).order("name"),
  ]);
  const map = (rows: Record<string, unknown>[] | null, type: EmployeeType): EmployeeOption[] =>
    (rows ?? []).map((r) => ({
      type,
      id: r.id as string,
      code: (r.code as string | null) ?? null,
      name: r.name as string,
    }));
  return [
    ...map((workers ?? []) as Record<string, unknown>[], "worker"),
    ...map((staff ?? []) as Record<string, unknown>[], "staff"),
    ...map((contractors ?? []) as Record<string, unknown>[], "contractor"),
  ];
}

export async function listAdvances(): Promise<HrAdvance[]> {
  const s = await createClient();
  const { data } = await s.from("hr_advances").select("*").order("created_at", { ascending: false });
  return (data ?? []) as HrAdvance[];
}
export async function listAdjustments(): Promise<HrAdjustment[]> {
  const s = await createClient();
  const { data } = await s.from("hr_adjustments").select("*").order("created_at", { ascending: false });
  return (data ?? []) as HrAdjustment[];
}
export async function listCompEvents(): Promise<HrCompEvent[]> {
  const s = await createClient();
  const { data } = await s.from("hr_comp_events").select("*").order("created_at", { ascending: false });
  return (data ?? []) as HrCompEvent[];
}
export async function listLeaves(): Promise<HrLeave[]> {
  const s = await createClient();
  const { data } = await s.from("hr_leaves").select("*").order("created_at", { ascending: false });
  return (data ?? []) as HrLeave[];
}
export async function listLifecycleEvents(): Promise<HrLifecycleEvent[]> {
  const s = await createClient();
  const { data } = await s.from("hr_lifecycle_events").select("*").order("created_at", { ascending: false });
  return (data ?? []) as HrLifecycleEvent[];
}
export async function listStatutoryDocs(): Promise<HrStatutoryDoc[]> {
  const s = await createClient();
  const { data } = await s.from("hr_statutory_docs").select("*").order("created_at", { ascending: false });
  return (data ?? []) as HrStatutoryDoc[];
}
