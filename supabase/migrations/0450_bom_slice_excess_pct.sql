-- =============================================================================
-- 0450 — The wastage buffer becomes per attribute value
--
-- Client, 2026-08-21: "no of item and no of pcs, excess % also in common field —
-- we need it only for attribute based." Items and Pcs were already per row
-- (0442); this is the third figure joining them, and it is legacy's per-sub-row
-- "Allowance %" under the name this app already uses.
--
-- NULLABLE, AND NULL MEANS INHERIT — the same contract `no_of_items` and
-- `per_pieces` have carried since 0442, and the reason none of the three is
-- defaulted to 0: a default makes "not answered" indistinguishable from
-- "answered with zero", and the line's own figure would stop reaching the row.
--
-- `consumptionFor` composes it PER FIELD beside the other two, so a row that
-- types a buffer and no ratio still inherits the ratio. Since the client also
-- asked for a per-size split under a row, that composition now runs TWICE — size
-- box, then the row it sits under, then the line — which works only because the
-- function returns the shape it takes.
--
-- THE SAME 0-100 RANGE the line's own `excess_pct` carries (0418), so a row
-- cannot express a buffer the engine would refuse with "Wastage must be between
-- 0 and 100".
-- =============================================================================

alter table public.material_bom_amendment_item_slices
  add column if not exists excess_pct numeric(6,2);

comment on column public.material_bom_amendment_item_slices.excess_pct is
  'The wastage buffer for THIS attribute value (0450) — legacy''s per-sub-row '
  'Allowance %. NULLABLE, and NULL means INHERIT the line''s own, the same '
  'contract no_of_items and per_pieces have carried since 0442.';

alter table public.material_bom_amendment_item_slices
  drop constraint if exists chk_mba_slice_excess_pct;
alter table public.material_bom_amendment_item_slices
  add constraint chk_mba_slice_excess_pct
  check (excess_pct is null or (excess_pct >= 0 and excess_pct <= 100));

do $assert$
begin
  -- NULLABLE is the whole contract. A NOT NULL column cannot say "inherit".
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_item_slices'
       and column_name = 'excess_pct'
       and is_nullable = 'YES'
  ) then
    raise exception '0450: excess_pct is missing or NOT NULL — NULL is how "inherit the line" is expressed';
  end if;

  -- The range holds, proved rather than read off the definition.
  begin
    insert into public.material_bom_amendment_item_slices (item_line_id, sno, excess_pct)
    values (gen_random_uuid(), 1, 250);
    raise exception '0450: a 250 percent buffer inserted — the range check is not doing its job';
  exception
    when check_violation then null;   -- the CHECK held, which is the assertion
    when others then null;            -- a FK refused first; fine
  end;
end $assert$;
