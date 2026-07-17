-- ============================================================================
-- Raagam ERP — 0299 Master Data ▸ rename `blocked` → `inactive` everywhere
-- User request: replace the "Blocked" terminology with "Inactive" across the
-- whole application. Renames the `blocked` boolean column on every Master
-- Data table that has one. Deliberately excludes `garment_styles` and
-- `ta_styles` — those carry a `blocked` column too but belong to the Orders
-- module (Garment Orders ▸ Style master / TA Styles), out of scope here.
-- ============================================================================

alter table public.account_groups rename column blocked to inactive;
alter table public.account_heads rename column blocked to inactive;
alter table public.advance_loan_types rename column blocked to inactive;
alter table public.allowances rename column blocked to inactive;
alter table public.applicants rename column blocked to inactive;
alter table public.banks rename column blocked to inactive;
alter table public.categories rename column blocked to inactive;
alter table public.commodities rename column blocked to inactive;
alter table public.components rename column blocked to inactive;
alter table public.compositions rename column blocked to inactive;
alter table public.consignees rename column blocked to inactive;
alter table public.countries rename column blocked to inactive;
alter table public.courier_delivery_addresses rename column blocked to inactive;
alter table public.customers rename column blocked to inactive;
alter table public.deductions rename column blocked to inactive;
alter table public.departments rename column blocked to inactive;
alter table public.designations rename column blocked to inactive;
alter table public.destinations rename column blocked to inactive;
alter table public.employee_categories rename column blocked to inactive;
alter table public.employees rename column blocked to inactive;
alter table public.garment_rejection_rules rename column blocked to inactive;
alter table public.hostel_categories rename column blocked to inactive;
alter table public.hsn_details rename column blocked to inactive;
alter table public.leave_types rename column blocked to inactive;
alter table public.levies rename column blocked to inactive;
alter table public.master_vendors rename column blocked to inactive;
alter table public.material_attribute_lines rename column blocked to inactive;
alter table public.merchandising_teams rename column blocked to inactive;
alter table public.notifies rename column blocked to inactive;
alter table public.payment_terms rename column blocked to inactive;
alter table public.processes rename column blocked to inactive;
alter table public.receivable_terms rename column blocked to inactive;
alter table public.states rename column blocked to inactive;
