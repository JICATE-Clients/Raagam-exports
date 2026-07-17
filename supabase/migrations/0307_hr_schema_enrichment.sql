-- ============================================================================
-- Raagam ERP — 0277 HR Schema Enrichment
-- Adds missing columns identified by comparing our Supabase schema against
-- the client's production SQL Server database (RAGAM). Prioritised by
-- payroll-criticality:
--   P0 — employee_categories (payroll computation engine)
--   P0 — working_hours (shift/OT/grace configuration)
--   P1 — employees (statutory IDs, payroll linkage, service history)
--   P1 — pf_esi_controls (compliance thresholds)
--   P2 — allowances, deductions, designations, departments, states, banks
-- ============================================================================

-- ==========================================================================
-- P0: EMPLOYEE_CATEGORIES — the payroll engine
-- Client's `Category` table has ~160 columns defining how salary, OT, PF,
-- ESI, leave, and weekly-off are calculated per employee category.
-- Our table currently has only 7 columns (name/type/blocked).
-- We add the essential payroll rule columns; PF/ESI component eligibility
-- is stored as JSONB arrays instead of 64 individual boolean columns.
-- ==========================================================================

alter table public.employee_categories

  -- Wage type & basic pay structure
  add column if not exists wages_type            text check (wages_type is null or wages_type in ('Monthly','Daily')),
  add column if not exists basic                 numeric(12,2),
  add column if not exists hra                   numeric(12,2),
  add column if not exists da                    numeric(12,2),
  add column if not exists transport             numeric(12,2),
  add column if not exists accommodation         numeric(12,2),
  add column if not exists amenities             numeric(12,2),
  add column if not exists canteen_per_day       numeric(12,2) default 0,

  -- Payroll flags
  add column if not exists loss_on_leave         boolean not null default false,
  add column if not exists allowance_applicable  boolean not null default false,
  add column if not exists pf_applicable         boolean not null default false,
  add column if not exists weekly_off_ot         boolean not null default false,
  add column if not exists separate_ot_salary    boolean not null default false,

  -- Hours-based conversion (OT calculation)
  add column if not exists hours_based_conv      boolean not null default false,
  add column if not exists reg_hours             numeric(6,2) default 8,
  add column if not exists ot_hours              numeric(6,2) default 8,
  add column if not exists reg_divisor           numeric(6,2) default 2,
  add column if not exists ot_divisor            numeric(6,2) default 2,
  add column if not exists ot_required           boolean not null default false,
  add column if not exists show_ot_in_hours      boolean not null default false,
  add column if not exists before_ot_hours       boolean not null default false,
  add column if not exists after_ot_hours        boolean not null default false,
  add column if not exists ot_hours_grace        integer default 0,

  -- Leave rules
  add column if not exists cl_max_per_month      smallint default 0,
  add column if not exists el_max_per_month      smallint default 0,
  add column if not exists cl_eligible_days      smallint default 0,
  add column if not exists max_leave_per_month_enabled boolean not null default false,
  add column if not exists max_leave_per_month   numeric(6,2) default 0,
  add column if not exists attendance_default_leave_type text,

  -- Weekly off rules
  add column if not exists is_no_weekly_off      boolean not null default false,
  add column if not exists wo_days               integer default 0,
  add column if not exists salary_with_weekly_off boolean not null default false,
  add column if not exists wo_previous_present_enabled boolean not null default false,
  add column if not exists wo_previous_present_days    integer default 0,

  -- Salary division (days per month)
  add column if not exists days_division_by_month boolean not null default false,
  add column if not exists days_if_28            numeric(6,2) default 0,
  add column if not exists days_if_29            numeric(6,2) default 0,
  add column if not exists days_if_30            numeric(6,2) default 0,
  add column if not exists days_if_31            numeric(6,2) default 0,

  -- Permission rules
  add column if not exists permission_hours_per_month numeric(6,2) default 0,
  add column if not exists permission_hours_per_day   numeric(6,2) default 0,

  -- Holiday eligibility
  add column if not exists absent_days_for_holiday_eligible numeric(6,2) default 0,
  add column if not exists holiday_eligible_enabled        boolean not null default false,

  -- Incentive
  add column if not exists present_without_leave_incentive_enabled boolean not null default false,
  add column if not exists present_without_leave_incentive_days    numeric(6,2) default 0,

  -- PF/ESI component eligibility (modernised from 64 booleans)
  -- Each is an array of allowance component names eligible for PF/ESI
  -- e.g. ['Basic','DA','HRA'] — replaces IsBasic_PF_L1, IsDA_PF_L1, etc.
  add column if not exists pf_components_l1  text[] not null default '{}',
  add column if not exists pf_components_l2  text[] not null default '{}',
  add column if not exists esi_components_l1 text[] not null default '{}',
  add column if not exists esi_components_l2 text[] not null default '{}',

  -- L2 specific salary rules
  add column if not exists salary_with_lop_days_l1      boolean not null default false,
  add column if not exists salary_with_lop_days_l2      boolean not null default false,
  add column if not exists is_no_weekly_off_l2          boolean not null default false,
  add column if not exists days_division_by_month_l2    boolean not null default false;


-- ==========================================================================
-- P0: WORKING_HOURS — shift/OT/grace configuration
-- Client's ShiftMaster has 128 columns with L1/L2/L3 labor levels,
-- next-day flags, grace periods, OT rules, batch linkage, incentives.
-- Our table has 15 columns (basic time slots only).
-- ==========================================================================

alter table public.working_hours

  -- Shift identification
  add column if not exists shift_name         text,
  add column if not exists batch_code         text,
  add column if not exists shift_no           text,

  -- Next-day flags (for overnight shifts)
  add column if not exists in_next_day        boolean not null default false,
  add column if not exists out_next_day       boolean not null default false,

  -- Grace / late thresholds
  add column if not exists late_after         time,
  add column if not exists late_after_next_day boolean not null default false,
  add column if not exists exit_before        time,
  add column if not exists exit_before_next_day boolean not null default false,

  -- Break next-day flags
  add column if not exists lunch_break_from_next_day boolean not null default false,
  add column if not exists lunch_break_to_next_day   boolean not null default false,

  -- Additional breaks
  add column if not exists break1_from        time,
  add column if not exists break1_to          time,
  add column if not exists break1_required    boolean not null default false,
  add column if not exists break2_from        time,
  add column if not exists break2_to          time,
  add column if not exists break2_required    boolean not null default false,

  -- Punch acceptance windows
  add column if not exists in_time_start      time,
  add column if not exists in_time_end        time,
  add column if not exists out_time_start     time,
  add column if not exists out_time_end       time,

  -- OT configuration
  add column if not exists is_ot_shift        boolean not null default false,
  add column if not exists shift_hours        numeric(6,2),
  add column if not exists is_fixed_hours     boolean not null default false,
  add column if not exists ot_break_hours     numeric(6,2) default 0,

  -- Hours-to-shift based OT
  add column if not exists hours_to_shift_ot        boolean not null default false,
  add column if not exists hours_for_one_shift      numeric(6,2) default 0,
  add column if not exists one_shift_value          numeric(6,2) default 0,
  add column if not exists hours_for_off_shift      numeric(6,2) default 0,
  add column if not exists off_shift_value          numeric(6,2) default 0,

  -- Quarter-based OT
  add column if not exists hours_for_first_quarter  numeric(6,2) default 0,
  add column if not exists first_quarter_value      numeric(6,2) default 0,
  add column if not exists hours_for_second_quarter numeric(6,2) default 0,
  add column if not exists second_quarter_value     numeric(6,2) default 0,

  -- Shift incentive
  add column if not exists shift_incentive_enabled  boolean not null default false,
  add column if not exists shift_incentive_per_day  numeric(12,2) default 0,

  -- OT incentive
  add column if not exists ot_incentive_enabled     boolean not null default false,
  add column if not exists ot_incentive_per_day     numeric(12,2) default 0,
  add column if not exists min_ot_hour_for_incentive numeric(6,2) default 0,

  -- Staff special grace
  add column if not exists staff_special_grace      integer default 0,
  add column if not exists staff_special_grace_enabled boolean not null default false,

  -- L2 level times (biometric-level shift definition)
  add column if not exists l2_in_time         time,
  add column if not exists l2_out_time        time,
  add column if not exists l2_late_after      time,
  add column if not exists l2_in_grace        numeric(6,2),
  add column if not exists l2_out_grace       numeric(6,2),
  add column if not exists l2_ot_in_time      time,
  add column if not exists l2_ot_out_time     time,
  add column if not exists l2_ot_in_grace     numeric(6,2),
  add column if not exists l2_ot_out_grace    numeric(6,2),
  add column if not exists l2_lunch_out_time  time,
  add column if not exists l2_lunch_out_grace numeric(6,2),
  add column if not exists l2_lunch_in_time   time,
  add column if not exists l2_lunch_in_grace  numeric(6,2),
  add column if not exists l2_grace_active    boolean not null default false,
  add column if not exists l2_ot_break_hours  numeric(6,2) default 0;


-- ==========================================================================
-- P1: EMPLOYEES — statutory IDs, payroll linkage, service history
-- ==========================================================================

alter table public.employees

  -- Employment basics
  add column if not exists doj                date,           -- Date of joining
  add column if not exists emp_type           text,           -- Permanent/Contract/Trainee
  add column if not exists ticket_no          text,           -- Legacy employee ticket number

  -- Shift/batch/section assignment
  add column if not exists shift_id           uuid references public.working_hours(id) on delete set null,
  add column if not exists batch_code         text,
  add column if not exists section_code       text,
  add column if not exists weekly_off         text default 'SUNDAY',

  -- Statutory IDs
  add column if not exists pf_exists          boolean not null default false,
  add column if not exists pf_no              text,
  add column if not exists esi_no             text,
  add column if not exists uan                text,
  add column if not exists pan_no             text,
  add column if not exists aadhar_no          text,

  -- Salary bank details
  add column if not exists pay_mode           text check (pay_mode is null or pay_mode in ('Bank','Cash')),
  add column if not exists bank_name          text,
  add column if not exists bank_acc_no        text,

  -- Parent details (client stores both father and mother)
  add column if not exists father_name        text,
  add column if not exists mother_name        text,
  add column if not exists spouse_name        text,
  add column if not exists spouse_occupation  text,
  add column if not exists mobile             text,

  -- Exit/rejoin
  add column if not exists releave_date       date,
  add column if not exists releave_reason     text,
  add column if not exists rejoin_date        date,

  -- Individual OT overrides (per-employee override of category rules)
  add column if not exists indv_hours_based_conv boolean not null default false,
  add column if not exists indv_reg_hours     numeric(6,2) default 8,
  add column if not exists indv_ot_hours      numeric(6,2) default 8,
  add column if not exists indv_ot_required   boolean not null default false,

  -- Leave balances
  add column if not exists cl_fixed           numeric(6,2) default 0,
  add column if not exists cl_utilised        numeric(6,2) default 0,
  add column if not exists el_fixed           numeric(6,2) default 0,
  add column if not exists el_utilised        numeric(6,2) default 0,
  add column if not exists ml_fixed           numeric(6,2) default 0,
  add column if not exists ml_utilised        numeric(6,2) default 0,

  -- Contractor/grade linkage
  add column if not exists contractor_code    text,
  add column if not exists grade_code         text,

  -- Document checklist flags
  add column if not exists has_birth_cert     boolean not null default false,
  add column if not exists has_passport       boolean not null default false,
  add column if not exists has_driving_license boolean not null default false,
  add column if not exists has_medical_cert   boolean not null default false,
  add column if not exists has_aadhar_card    boolean not null default false,
  add column if not exists has_voter_id       boolean not null default false,
  add column if not exists has_pan_card       boolean not null default false,
  add column if not exists has_ration_card    boolean not null default false;

-- Indexes for new employee FK columns
create index if not exists idx_employees_shift on public.employees(shift_id);


-- ==========================================================================
-- P1: PF_ESI_CONTROLS — compliance thresholds
-- ==========================================================================

alter table public.pf_esi_controls

  -- EPF/EPS split (Indian PF law: employer PF splits into EPF + EPS)
  add column if not exists epf_pct            numeric(6,2) default 0,    -- Employer EPF %
  add column if not exists eps_pct            numeric(6,2) default 0,    -- Employer EPS (Pension) %

  -- Salary ceilings (statutory limits)
  add column if not exists pf_salary_limit    numeric(12,2) default 0,   -- PF wage ceiling (₹15,000)
  add column if not exists esi_salary_limit   numeric(12,2) default 0,   -- ESI wage ceiling (₹21,000)

  -- Other compliance parameters
  add column if not exists age_limit_eps      integer default 58,         -- EPS age limit
  add column if not exists min_work_days      integer default 0,          -- Min days for PF/ESI eligibility
  add column if not exists days_for_pf_esi    integer default 0,          -- Days calculation basis
  add column if not exists days_wages_for_sal integer default 0,          -- Salary days basis
  add column if not exists conv_earn          boolean not null default false, -- Conveyance in earnings

  -- PF account type codes (A/c 1, 2, 10, 21, 22)
  add column if not exists ac_1              numeric(6,2) default 0,
  add column if not exists ac_2              numeric(6,2) default 0,
  add column if not exists ac_10             numeric(6,2) default 0,
  add column if not exists ac_21             numeric(6,2) default 0,
  add column if not exists ac_22             numeric(6,2) default 0;


-- ==========================================================================
-- P2: ALLOWANCES — L1/L2 labor level flags + alias
-- ==========================================================================

alter table public.allowances
  add column if not exists alias_name        text,
  add column if not exists l1                boolean not null default false,
  add column if not exists l2                boolean not null default false;

-- blocked → inactive (already done in live DB but not in migration)
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'allowances' and column_name = 'blocked'
  ) then
    alter table public.allowances rename column blocked to inactive;
  end if;
end $$;
alter table public.allowances
  add column if not exists inactive boolean not null default false;


-- ==========================================================================
-- P2: DEDUCTIONS — L1/L2 labor level flags + alias
-- ==========================================================================

alter table public.deductions
  add column if not exists alias_name        text,
  add column if not exists l1                boolean not null default false,
  add column if not exists l2                boolean not null default false;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'deductions' and column_name = 'blocked'
  ) then
    alter table public.deductions rename column blocked to inactive;
  end if;
end $$;
alter table public.deductions
  add column if not exists inactive boolean not null default false;


-- ==========================================================================
-- P3: DESIGNATIONS — min wage
-- ==========================================================================

alter table public.designations
  add column if not exists min_wage          numeric(12,2);

-- blocked → inactive already done in live DB
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'designations' and column_name = 'blocked'
  ) then
    alter table public.designations rename column blocked to inactive;
  end if;
end $$;


-- ==========================================================================
-- P3: DEPARTMENTS — strength (sanctioned headcount)
-- ==========================================================================

alter table public.departments
  add column if not exists strength          integer;

-- blocked → inactive already done in live DB
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'departments' and column_name = 'blocked'
  ) then
    alter table public.departments rename column blocked to inactive;
  end if;
end $$;


-- ==========================================================================
-- P3: STATES — country FK (client has Country_Id on State)
-- ==========================================================================

alter table public.states
  add column if not exists country_id uuid references public.countries(id) on delete set null;

create index if not exists idx_states_country on public.states(country_id);


-- ==========================================================================
-- P3: BANKS — own_bank flag
-- ==========================================================================

alter table public.banks
  add column if not exists own_bank boolean not null default false;
