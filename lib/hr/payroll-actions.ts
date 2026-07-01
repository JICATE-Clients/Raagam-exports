"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { payrollRunInput } from "@/lib/hr/types";
import type { PayrollRunInput } from "@/lib/hr/types";
import {
  computeWorkerPayroll,
  computeContractorNetting,
  computeStaffSalary,
  money,
} from "@/lib/hr/calc";
import {
  getSettings,
  getActiveWorkers,
  getAttendanceAggregates,
  getPieceAggregates,
  getActiveStaff,
} from "@/lib/hr/payroll-service";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

function revalidatePayroll(runId?: string): void {
  revalidatePath("/hr/payroll");
  if (runId) revalidatePath(`/hr/payroll/${runId}`);
}

// ---------- create run ----------

export async function createRun(
  data: PayrollRunInput,
): Promise<{ ok: true; runId: string } | ErrResult> {
  if (!(await can("hr_payroll", "create"))) throw new Error("Forbidden");

  const parsed = payrollRunInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (parsed.data.period_start > parsed.data.period_end) {
    return { ok: false, error: "Period start must be before period end" };
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: run, error } = await supabase
    .from("payroll_runs")
    .insert({
      run_kind: parsed.data.run_kind,
      period_type: parsed.data.period_type,
      period_start: parsed.data.period_start,
      period_end: parsed.data.period_end,
      location_id: parsed.data.location_id ?? null,
      notes: parsed.data.notes ?? null,
      status: "draft",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !run) {
    return { ok: false, error: error?.message ?? "Failed to create run" };
  }

  revalidatePayroll();
  return { ok: true, runId: (run as { id: string }).id };
}

// ---------- calculate ----------

export async function calculatePayroll(runId: string): Promise<ActionResult> {
  if (!(await can("hr_payroll", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // fetch the run
  const { data: runRaw } = await supabase
    .from("payroll_runs")
    .select("id, run_kind, period_start, period_end, location_id, status")
    .eq("id", runId)
    .maybeSingle();

  if (!runRaw) return { ok: false, error: "Run not found" };

  const run = runRaw as {
    id: string;
    run_kind: "worker" | "staff";
    period_start: string;
    period_end: string;
    location_id: string | null;
    status: string;
  };

  if (run.status !== "draft" && run.status !== "calculated") {
    return { ok: false, error: "Run can only be recalculated while in draft or calculated status" };
  }

  const settings = await getSettings();
  if (!settings) return { ok: false, error: "Payroll settings not configured" };

  // wipe existing lines for idempotency
  await supabase.from("payroll_lines").delete().eq("payroll_run_id", runId);
  await supabase.from("contractor_payroll").delete().eq("payroll_run_id", runId);

  if (run.run_kind === "worker") {
    const workers = await getActiveWorkers(run.location_id);

    if (workers.length > 0) {
      const workerIds = workers.map((w) => w.id);

      const [attRows, pieceRows] = await Promise.all([
        getAttendanceAggregates(run.period_start, run.period_end, workerIds),
        getPieceAggregates(run.period_start, run.period_end, workerIds),
      ]);

      const attMap = new Map(attRows.map((a) => [a.worker_id, a]));
      const pieceMap = new Map(pieceRows.map((p) => [p.worker_id, p]));

      // compute each worker's line
      const lineInserts: Record<string, unknown>[] = [];
      const contractorItems: Map<string, { pieces: number; pieceRate: number; actualGross: number }[]> = new Map();

      for (const worker of workers) {
        const att = attMap.get(worker.id) ?? { days_present: 0, ot_hours: 0, extra_hours: 0 };
        const pieces = pieceMap.get(worker.id)?.total_pieces ?? 0;

        const result = computeWorkerPayroll(
          worker,
          { daysPresent: att.days_present, otHours: att.ot_hours },
          { extraHours: att.extra_hours, pieces },
          settings,
        );

        lineInserts.push({
          payroll_run_id: runId,
          worker_id: worker.id,
          staff_id: null,
          worker_type: worker.worker_type,
          days_worked: result.daysPresent,
          ot_hours: result.otHours,
          ot_wage: result.otWage,
          actual_gross: result.actualGross,
          esi: result.esi,
          pf: result.pf,
          actual_net: result.actualNet,
          pieces: result.pieces,
          extra_wage: result.extraWage,
          total_net: result.totalNet,
          details: {
            shiftPay: result.shiftPay,
            otMultiplier: settings.ot_multiplier,
            esiRate: settings.esi_rate,
            pfRate: settings.pf_rate,
            workerType: result.workerType,
          },
        });

        // collect contractor_piece workers for netting
        if (worker.worker_type === "contractor_piece" && worker.contractor_id) {
          const existing = contractorItems.get(worker.contractor_id) ?? [];
          existing.push({
            pieces,
            pieceRate: worker.piece_rate,
            actualGross: result.actualGross,
          });
          contractorItems.set(worker.contractor_id, existing);
        }
      }

      if (lineInserts.length > 0) {
        const { error: lineErr } = await supabase.from("payroll_lines").insert(lineInserts);
        if (lineErr) return { ok: false, error: lineErr.message };
      }

      // contractor netting
      const contractorInserts: Record<string, unknown>[] = [];
      for (const [contractorId, items] of contractorItems) {
        const netting = computeContractorNetting(items);
        contractorInserts.push({
          payroll_run_id: runId,
          contractor_id: contractorId,
          total_pieces: netting.totalPieces,
          piece_amount: netting.pieceAmount,
          sum_actual_wages: netting.sumActualWages,
          extra_wage: netting.extraWage,
        });
      }

      if (contractorInserts.length > 0) {
        const { error: cErr } = await supabase.from("contractor_payroll").insert(contractorInserts);
        if (cErr) return { ok: false, error: cErr.message };
      }
    }
  } else {
    // staff run
    const staff = await getActiveStaff(run.location_id);
    const staffInserts: Record<string, unknown>[] = [];

    for (const s of staff) {
      const result = computeStaffSalary(s, settings);
      staffInserts.push({
        payroll_run_id: runId,
        worker_id: null,
        staff_id: s.id,
        worker_type: null,
        days_worked: 0,
        ot_hours: 0,
        ot_wage: 0,
        actual_gross: result.gross,
        esi: result.esi,
        pf: result.pf,
        actual_net: result.net,
        pieces: 0,
        extra_wage: 0,
        total_net: result.net,
        details: {
          monthly_salary: s.monthly_salary,
          esiRate: settings.esi_rate,
          pfRate: settings.pf_rate,
        },
      });
    }

    if (staffInserts.length > 0) {
      const { error: sErr } = await supabase.from("payroll_lines").insert(staffInserts);
      if (sErr) return { ok: false, error: sErr.message };
    }
  }

  // mark calculated
  const { error: updateErr } = await supabase
    .from("payroll_runs")
    .update({ status: "calculated" })
    .eq("id", runId);

  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePayroll(runId);
  return { ok: true };
}

// ---------- approve ----------

export async function approvePayroll(runId: string): Promise<ActionResult> {
  if (!(await can("hr_payroll", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: runRaw } = await supabase
    .from("payroll_runs")
    .select("id, status, code, run_kind")
    .eq("id", runId)
    .maybeSingle();

  const run = runRaw as { id: string; status: string; code: string | null; run_kind: string } | null;
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "calculated") {
    return { ok: false, error: "Run must be in calculated status to approve" };
  }

  const user = await getAppUser();
  const { error } = await supabase
    .from("payroll_runs")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "payroll_run.approved",
    entityType: "payroll_run",
    entityId: runId,
    metadata: { code: run.code, run_kind: run.run_kind },
  });

  revalidatePayroll(runId);
  return { ok: true };
}

// ---------- lock ----------

export async function lockPayroll(runId: string): Promise<ActionResult> {
  if (!(await can("hr_payroll", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: runRaw } = await supabase
    .from("payroll_runs")
    .select("id, status, code, run_kind, period_start, period_end")
    .eq("id", runId)
    .maybeSingle();

  const run = runRaw as {
    id: string;
    status: string;
    code: string | null;
    run_kind: string;
    period_start: string;
    period_end: string;
  } | null;

  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "approved") {
    return { ok: false, error: "Run must be approved before locking" };
  }

  // lock worker piece records in the period
  await supabase
    .from("worker_piece_records")
    .update({ is_locked: true })
    .gte("work_date", run.period_start)
    .lte("work_date", run.period_end);

  const { error } = await supabase
    .from("payroll_runs")
    .update({ status: "locked" })
    .eq("id", runId);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "payroll_run.locked",
    entityType: "payroll_run",
    entityId: runId,
    metadata: { code: run.code, run_kind: run.run_kind },
  });

  // Payroll lock → auto-posted GL journal. Admin client (HR user lacks finance
  // perms). Best-effort: a GL hiccup must not undo the lock.
  //   Dr Wages/Staff Salary (gross + extra)
  //   Cr Bank A/C1 (net) · Cr ESI Payable · Cr PF Payable · Cr Bank A/C2 (extra)
  try {
    const admin = createAdminClient();
    const { data: linesData } = await admin
      .from("payroll_lines")
      .select("actual_gross, actual_net, esi, pf, extra_wage")
      .eq("payroll_run_id", runId);
    const agg = (
      (linesData ?? []) as {
        actual_gross: number;
        actual_net: number;
        esi: number;
        pf: number;
        extra_wage: number;
      }[]
    ).reduce(
      (a, l) => ({
        gross: a.gross + (l.actual_gross || 0),
        net: a.net + (l.actual_net || 0),
        esi: a.esi + (l.esi || 0),
        pf: a.pf + (l.pf || 0),
        extra: a.extra + (l.extra_wage || 0),
      }),
      { gross: 0, net: 0, esi: 0, pf: 0, extra: 0 },
    );

    if (agg.gross > 0) {
      const { data: accts } = await admin.from("gl_accounts").select("id, code");
      const acc = new Map(
        ((accts ?? []) as { id: string; code: string }[]).map((a) => [a.code, a.id]),
      );
      const wagesCode = run.run_kind === "staff" ? "5210" : "5200";
      const jlines = [
        { code: wagesCode, debit: money(agg.gross + agg.extra), credit: 0, description: "Wages" },
        { code: "1010", debit: 0, credit: money(agg.net), description: "Net wages — A/C 1" },
        { code: "2100", debit: 0, credit: money(agg.esi), description: "ESI payable" },
        { code: "2110", debit: 0, credit: money(agg.pf), description: "PF payable" },
        { code: "1020", debit: 0, credit: money(agg.extra), description: "Extra wages — A/C 2" },
      ].filter((l) => l.debit > 0 || l.credit > 0);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const totalDebit = money(jlines.reduce((s, l) => s + l.debit, 0));
      const totalCredit = money(jlines.reduce((s, l) => s + l.credit, 0));
      const { data: entry } = await admin
        .from("journal_entries")
        .insert({
          entry_date: run.period_end,
          narration: `Payroll ${run.code ?? ""} (${run.run_kind})`.trim(),
          reference_type: "payroll_run",
          reference_id: runId,
          is_auto: true,
          status: "posted",
          posted_at: new Date().toISOString(),
          total_debit: totalDebit,
          total_credit: totalCredit,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      const entryId = (entry as { id: string } | null)?.id;
      if (entryId) {
        await admin.from("journal_lines").insert(
          jlines
            .map((l, i) => ({
              journal_entry_id: entryId,
              gl_account_id: acc.get(l.code) ?? null,
              debit: l.debit,
              credit: l.credit,
              description: l.description,
              sort_order: i,
            }))
            .filter((l) => l.gl_account_id),
        );
      }
      revalidatePath("/finance/ledger");
    }
  } catch {
    // best-effort GL posting
  }

  revalidatePayroll(runId);
  return { ok: true };
}

// ---------- mark paid ----------

export async function markPaid(runId: string): Promise<ActionResult> {
  if (!(await can("hr_payroll", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: runRaw } = await supabase
    .from("payroll_runs")
    .select("id, status, code, run_kind")
    .eq("id", runId)
    .maybeSingle();

  const run = runRaw as {
    id: string;
    status: string;
    code: string | null;
    run_kind: string;
  } | null;

  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "locked") {
    return { ok: false, error: "Run must be locked before marking as paid" };
  }

  const { error } = await supabase
    .from("payroll_runs")
    .update({ status: "paid" })
    .eq("id", runId);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "payroll_run.paid",
    entityType: "payroll_run",
    entityId: runId,
    metadata: { code: run.code, run_kind: run.run_kind },
  });

  revalidatePayroll(runId);
  return { ok: true };
}
