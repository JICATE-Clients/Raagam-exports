-- ============================================================================
-- Raagam ERP — 0332 DROP entire Planning module
--
-- The Planning module was built from generic ERP patterns instead of the
-- VB.NET source of truth. Peer review confirmed forms, UI, and business logic
-- do not match. Dropping all planning tables, sequences, RLS policies, and
-- reversing cross-module modifications so the module can be rebuilt correctly
-- from the decompiled Planning_UI (703 forms).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reverse cross-module modifications (quote_costings from 0278)
-- ---------------------------------------------------------------------------
drop policy if exists quote_costings_planning_read on public.quote_costings;
drop policy if exists quote_costings_planning_approve on public.quote_costings;

alter table public.quote_costings
  drop column if exists approved_by,
  drop column if exists approved_at,
  drop column if exists approval_reason;

alter table public.quote_costings drop constraint if exists quote_costings_status_check;
alter table public.quote_costings add constraint quote_costings_status_check
  check (status in ('draft','finalised'));

-- ---------------------------------------------------------------------------
-- 2. Drop all planning tables (in dependency order — children first)
-- ---------------------------------------------------------------------------

-- Phase 5: Capacity & Production Planning (0338)
drop table if exists public.production_plan_orders cascade;
drop table if exists public.production_plans cascade;
drop table if exists public.capacity_plan_orders cascade;
drop table if exists public.capacity_plans cascade;

-- Phase 4: Fabric Orders & Domestic Production (0336, 0337)
drop table if exists public.domestic_prod_plan_sizes cascade;
drop table if exists public.domestic_prod_plan_styles cascade;
drop table if exists public.domestic_production_plans cascade;
drop table if exists public.fabric_order_dye_colors cascade;
drop table if exists public.fabric_order_sizes cascade;
drop table if exists public.fabric_order_combos cascade;
drop table if exists public.fabric_order_details cascade;
drop table if exists public.fabric_order_styles cascade;
drop table if exists public.fabric_orders cascade;

-- Phase 3: Material Excess Plan & Fabric Consumption (0335)
drop table if exists public.fabric_consumption_sizes cascade;
drop table if exists public.fabric_consumption_lines cascade;
drop table if exists public.fabric_consumption_records cascade;
drop table if exists public.material_excess_plan_sizes cascade;
drop table if exists public.material_excess_plan_items cascade;
drop table if exists public.material_excess_plans cascade;

-- Phase 2: Indent Approval (0334)
drop table if exists public.indent_conversion_items cascade;
drop table if exists public.indent_conversions cascade;
drop table if exists public.indent_approval_items cascade;
drop table if exists public.indent_approvals cascade;

-- Phase 1: Color/Print, Material Rates, General Stocks (0332, 0333)
drop table if exists public.general_stock_item_classes cascade;
drop table if exists public.general_stock_groups cascade;
drop table if exists public.material_rate_items cascade;
drop table if exists public.material_rate_entries cascade;
drop table if exists public.color_print_detail_lines cascade;
drop table if exists public.color_print_details cascade;

-- BOM Amendment Lines (0340)
drop table if exists public.bom_amendment_lines cascade;

-- PPM Receipt Completions (0276)
drop table if exists public.ppm_receipt_completions cascade;

-- PPM Cancellations (0275)
drop table if exists public.ppm_cancellations cascade;

-- TA Plan (0271)
drop table if exists public.ta_plan_activities cascade;
drop table if exists public.ta_plan_docs cascade;

-- Product Development (0031)
drop table if exists public.pd_products cascade;
drop table if exists public.pd_requests cascade;

-- Stock Completions (0030)
drop table if exists public.stock_completions cascade;

-- PPM Issues (0029)
drop table if exists public.ppm_issue_lines cascade;
drop table if exists public.ppm_issues cascade;

-- Material Excess (0028)
drop table if exists public.material_excess cascade;

-- Process Allocations (0027)
drop table if exists public.process_allocations cascade;

-- IWO BOMs (0026)
drop table if exists public.iwo_bom_items cascade;
drop table if exists public.iwo_boms cascade;

-- SQ Notes (0025) — including closure columns from 0277
drop table if exists public.sq_allocations cascade;
drop table if exists public.sq_notes cascade;

-- BOM Amendments (0023)
drop table if exists public.bom_amendments cascade;

-- Budget Amendments (0022)
drop table if exists public.budget_amendments cascade;

-- Shipment Plans (0021)
drop table if exists public.shipment_plan_orders cascade;
drop table if exists public.shipment_plans cascade;

-- Material Shortages (0020)
drop table if exists public.material_shortages cascade;

-- Process Planning (0012)
drop table if exists public.process_job_receipts cascade;
drop table if exists public.process_jobs cascade;

-- Core Planning (0007)
drop table if exists public.budget_lines cascade;
drop table if exists public.budget_orders cascade;
drop table if exists public.budgets cascade;
drop table if exists public.material_bom_items cascade;
drop table if exists public.material_boms cascade;
drop table if exists public.fabric_bom_processes cascade;
drop table if exists public.fabric_bom_components cascade;
drop table if exists public.fabric_boms cascade;

-- ---------------------------------------------------------------------------
-- 3. Drop all planning sequences
-- ---------------------------------------------------------------------------
drop sequence if exists public.seq_budget;
drop sequence if exists public.seq_process_job;
drop sequence if exists public.seq_material_shortage;
drop sequence if exists public.seq_shipment_plan;
drop sequence if exists public.seq_budget_amendment;
drop sequence if exists public.seq_bom_amendment;
drop sequence if exists public.seq_sq_note;
drop sequence if exists public.seq_iwo_bom;
drop sequence if exists public.seq_process_allocation;
drop sequence if exists public.seq_material_excess;
drop sequence if exists public.seq_ppm_issue;
drop sequence if exists public.seq_stock_completion;
drop sequence if exists public.seq_pd_request;
drop sequence if exists public.seq_ta_plan_doc;
drop sequence if exists public.seq_ppm_cancellation;
drop sequence if exists public.seq_ppm_receipt_completion;
drop sequence if exists public.seq_color_print_detail;
drop sequence if exists public.seq_material_rate;
drop sequence if exists public.seq_general_stock;
drop sequence if exists public.seq_indent_conversion;
drop sequence if exists public.seq_material_excess_plan;
drop sequence if exists public.seq_fabric_consumption;
drop sequence if exists public.seq_fabric_order;
drop sequence if exists public.seq_domestic_prod_plan;
drop sequence if exists public.seq_capacity_plan;
drop sequence if exists public.seq_production_plan;

-- ---------------------------------------------------------------------------
-- 4. Clean up: remove 'planning' from modules config if present
-- ---------------------------------------------------------------------------
-- (module permission entries will be cleaned up when Planning is rebuilt)
