-- ============================================================================
-- Raagam ERP — 0018 Orders ▸ Customer Colour Cards
-- Additive sub-module of the existing Orders module (legacy EDP2:
-- Sales ▸ Garment Orders ▸ "Define customer color cards").
--
-- A colour card is a buyer-approved palette (many colours) reused across that
-- buyer's orders. Gated by the existing 'orders' permission — no new module.
-- Follows the `code` + assign_code() convention (see 0017 for why `code`).
-- ============================================================================

-- ---------- colour cards (buyer-scoped palette header) ----------
create sequence if not exists public.seq_color_card;
create table if not exists public.color_cards (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,                                   -- CC-0001 (assign_code)
  buyer_id    uuid not null references public.buyers(id),
  name        text not null,
  season      text,
  status      text not null default 'active'
                check (status in ('active','archived')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_color_card_code before insert on public.color_cards
  for each row execute function public.assign_code('CC','public.seq_color_card');
create trigger trg_color_card_updated before update on public.color_cards
  for each row execute function public.set_updated_at();
create index if not exists idx_color_cards_buyer  on public.color_cards(buyer_id);
create index if not exists idx_color_cards_status on public.color_cards(status);

-- ---------- individual colours on a card ----------
create table if not exists public.color_card_colors (
  id            uuid primary key default gen_random_uuid(),
  color_card_id uuid not null references public.color_cards(id) on delete cascade,
  name          text not null,                               -- e.g. "Navy"
  code          text,                                        -- buyer ref / Pantone, e.g. "19-3920 TCX"
  hex           text,                                        -- optional swatch #RRGGBB
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ccc_card on public.color_card_colors(color_card_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['color_cards','color_card_colors'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
