-- ============================================================================
-- Raagam ERP — 0276 Planning ▸ Garmenting PPM Receipt Completion
-- Additive sub-module (legacy EDP2: Planning ▸ Materials-Garment Orders ▸
-- "Garmenting PPM receipt completion"). Line-level receipts against a PPM are
-- already captured via ppm_issue_lines.received_qty; this document closes an
-- issued PPM's receipts as complete (who / when / note) and, on completion,
-- flips the parent ppm_issues row 'issued' → 'received' (the documented sibling
-- of the bare inline receivePpm). Gated by the EXISTING 'planning' permission.
-- ============================================================================

create sequence if not exists public.seq_ppm_receipt_completion;
create table if not exists public.ppm_receipt_completions (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                   -- PRC-0001
  ppm_issue_id  uuid not null references public.ppm_issues(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  note          text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_prc_code before insert on public.ppm_receipt_completions
  for each row execute function public.assign_code('PRC','public.seq_ppm_receipt_completion');
create trigger trg_prc_updated before update on public.ppm_receipt_completions
  for each row execute function public.set_updated_at();
create index if not exists idx_prc_ppm on public.ppm_receipt_completions(ppm_issue_id);

do $$
declare t text;
begin
  foreach t in array array['ppm_receipt_completions'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
