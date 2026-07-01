import type { Worker, Staff, PayrollSettings, WorkerType } from "./types";

/** Round to 2 decimals (currency). */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Cap OT hours to the per-day maximum from settings. */
export function capDailyOt(otHours: number, settings: PayrollSettings): number {
  return Math.min(otHours, settings.max_ot_hours_per_day);
}

export interface ActualWageInput {
  daysPresent: number; // count of present days in the period
  otHours: number; // total OT hours in the period (already daily-capped at entry)
}

export interface ActualWageResult {
  daysPresent: number;
  otHours: number;
  shiftPay: number;
  otWage: number;
  actualGross: number; // A/C 1 gross
  esi: number;
  pf: number;
  actualNet: number; // A/C 1 net (after ESI + PF)
}

/**
 * ACTUAL WAGE — identical for all three worker types (PRD).
 *   weekly = shift_wage/day * days + OT hours wage (paid DOUBLE)
 *   ESI + PF are deducted on the actual wage ONLY; paid from A/C 1.
 */
export function computeActualWage(
  worker: Pick<
    Worker,
    "shift_wage_per_day" | "hourly_wage" | "esi_applicable" | "pf_applicable"
  >,
  input: ActualWageInput,
  settings: Pick<PayrollSettings, "ot_multiplier" | "esi_rate" | "pf_rate">,
): ActualWageResult {
  const shiftPay = money(worker.shift_wage_per_day * input.daysPresent);
  const otWage = money(
    input.otHours * worker.hourly_wage * settings.ot_multiplier,
  );
  const actualGross = money(shiftPay + otWage);
  const esi = worker.esi_applicable ? money(actualGross * settings.esi_rate) : 0;
  const pf = worker.pf_applicable ? money(actualGross * settings.pf_rate) : 0;
  const actualNet = money(actualGross - esi - pf);
  return {
    daysPresent: input.daysPresent,
    otHours: input.otHours,
    shiftPay,
    otWage,
    actualGross,
    esi,
    pf,
    actualNet,
  };
}

export interface ExtraWageInput {
  extraHours: number; // extra shift hours in the week (for shift workers)
  pieces: number; // pieces made in the period (for piece workers)
}

/**
 * EXTRA WAGE — varies by worker type; paid from A/C 2 with NO ESI/PF.
 *   • shift:            extra_hours * hourly_wage − OT wage already paid (floor 0)
 *   • company_piece:    pieces * piece_rate − actual wage earned        (floor 0)
 *   • contractor_piece: 0 at worker level — the extra is paid to the
 *                       CONTRACTOR via computeContractorNetting().
 */
export function computeExtraWage(
  worker: Pick<Worker, "worker_type" | "hourly_wage" | "piece_rate">,
  input: ExtraWageInput,
  actual: Pick<ActualWageResult, "otWage" | "actualGross">,
): number {
  switch (worker.worker_type) {
    case "shift":
      return money(
        Math.max(0, input.extraHours * worker.hourly_wage - actual.otWage),
      );
    case "company_piece":
      return money(
        Math.max(0, input.pieces * worker.piece_rate - actual.actualGross),
      );
    case "contractor_piece":
      return 0;
  }
}

export interface ContractorNettingItem {
  pieces: number;
  pieceRate: number;
  actualGross: number; // each tagged worker's actual gross wage
}

export interface ContractorNettingResult {
  totalPieces: number;
  pieceAmount: number;
  sumActualWages: number;
  extraWage: number; // piece value − Σ actual wages (floor 0), paid to contractor
}

/**
 * CONTRACTOR PAYROLL (PRD):
 *   {Σ pieces by all tagged workers × piece rate} − {Σ actual wages of those workers}
 */
export function computeContractorNetting(
  items: ContractorNettingItem[],
): ContractorNettingResult {
  const totalPieces = items.reduce((s, i) => s + i.pieces, 0);
  const pieceAmount = money(items.reduce((s, i) => s + i.pieces * i.pieceRate, 0));
  const sumActualWages = money(items.reduce((s, i) => s + i.actualGross, 0));
  const extraWage = money(Math.max(0, pieceAmount - sumActualWages));
  return { totalPieces, pieceAmount, sumActualWages, extraWage };
}

export interface StaffSalaryResult {
  gross: number;
  esi: number;
  pf: number;
  net: number;
}

/** Monthly staff salary with ESI/PF deductions. */
export function computeStaffSalary(
  staff: Pick<Staff, "monthly_salary" | "esi_applicable" | "pf_applicable">,
  settings: Pick<PayrollSettings, "esi_rate" | "pf_rate">,
): StaffSalaryResult {
  const gross = money(staff.monthly_salary);
  const esi = staff.esi_applicable ? money(gross * settings.esi_rate) : 0;
  const pf = staff.pf_applicable ? money(gross * settings.pf_rate) : 0;
  return { gross, esi, pf, net: money(gross - esi - pf) };
}

/** Convenience: full per-worker payroll line for any worker type. */
export interface WorkerPayrollResult extends ActualWageResult {
  workerType: WorkerType;
  pieces: number;
  extraWage: number;
  totalNet: number; // actualNet + extraWage (worker take-home across both A/Cs)
}

export function computeWorkerPayroll(
  worker: Pick<
    Worker,
    | "worker_type"
    | "shift_wage_per_day"
    | "hourly_wage"
    | "piece_rate"
    | "esi_applicable"
    | "pf_applicable"
  >,
  actualInput: ActualWageInput,
  extraInput: ExtraWageInput,
  settings: Pick<PayrollSettings, "ot_multiplier" | "esi_rate" | "pf_rate">,
): WorkerPayrollResult {
  const actual = computeActualWage(worker, actualInput, settings);
  const extraWage = computeExtraWage(worker, extraInput, actual);
  return {
    ...actual,
    workerType: worker.worker_type,
    pieces: extraInput.pieces,
    extraWage,
    totalNet: money(actual.actualNet + extraWage),
  };
}
