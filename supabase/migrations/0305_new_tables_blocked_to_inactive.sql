-- ============================================================================
-- Raagam ERP — 0305 Rename blocked → inactive on 0278 tables
-- Aligns the 13 new master tables (created in 0278_new_master_tables) with
-- the rest of the codebase after 0299_masters_blocked_to_inactive renamed
-- the column on all pre-existing master tables.
-- ============================================================================

alter table public.our_banks rename column blocked to inactive;
alter table public.divisions rename column blocked to inactive;
alter table public.seasons rename column blocked to inactive;
alter table public.brands rename column blocked to inactive;
alter table public.size_groups rename column blocked to inactive;
alter table public.size_group_sizes rename column blocked to inactive;
alter table public.shade_groups rename column blocked to inactive;
alter table public.shades rename column blocked to inactive;
alter table public.colors rename column blocked to inactive;
alter table public.zones rename column blocked to inactive;
alter table public.bins rename column blocked to inactive;
alter table public.certifications rename column blocked to inactive;
alter table public.certification_validities rename column blocked to inactive;
