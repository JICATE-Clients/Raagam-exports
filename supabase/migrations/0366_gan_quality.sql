-- ============================================================================
-- Raagam ERP -- 0357 GAN Quality Checks
-- From VB.NET FrmMAT_GAN_Qly, FrmFN_GANQuality — detailed per-parameter
-- quality inspection for GRN line items. Extends basic QC (pass/fail).
-- ============================================================================

create sequence if not exists public.seq_gan;

create table if not exists public.gan_quality_checks (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  grn_id          uuid not null references public.grns(id),
  grn_line_id     uuid references public.grn_line_items(id),
  item_id         uuid references public.items(id),
  status          text not null default 'pending'
                    check (status in ('pending','in_progress','completed')),
  overall_result  text check (overall_result in ('pass','fail','conditional')),
  checked_by      uuid references public.profiles(id),
  checked_at      timestamptz,
  notes           text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_gan_code before insert on public.gan_quality_checks
  for each row execute function public.assign_code('GAN','public.seq_gan');
create trigger trg_gan_updated before update on public.gan_quality_checks
  for each row execute function public.set_updated_at();
create index if not exists idx_gan_grn on public.gan_quality_checks(grn_id);
create index if not exists idx_gan_line on public.gan_quality_checks(grn_line_id);

create table if not exists public.gan_quality_parameters (
  id              uuid primary key default gen_random_uuid(),
  check_id        uuid not null references public.gan_quality_checks(id) on delete cascade,
  parameter_name  text not null,
  method          text,
  spec_min        numeric(14,4),
  spec_max        numeric(14,4),
  actual_value    text,
  unit            text,
  result          text check (result in ('pass','fail')),
  size_label      text,
  notes           text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_ganp_check on public.gan_quality_parameters(check_id);
create trigger trg_ganp_updated before update on public.gan_quality_parameters
  for each row execute function public.set_updated_at();

-- RLS
do $$
declare t text;
begin
  foreach t in array array['gan_quality_checks','gan_quality_parameters'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('materials_purchase','edit'))
        with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
  end loop;
end $$;
