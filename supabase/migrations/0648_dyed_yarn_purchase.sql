-- ============================================================================
-- Raagam ERP — 0648 DYED YARN PURCHASE: yarn bought already dyed (client spec
-- 2026-09-26, "Yarn Sourcing: Dyed Stage ➔ Yarn Purchase" + the costing rule
-- "DYED YARN PURCHASE Costing Rule").
--
-- Market-dyed yarn (standard shades, a YD stripe colour) enters at the DYED
-- stage. Until now DYED could only OPEN with YARN DYEING or CONVERSION, and
-- YARN PURCHASE cannot also open DYED: a process is the base of at most ONE
-- stage (0611's `uq_process_fabric_stages_one_base`). So it is its own process,
-- the yarn twin of DYED FABRIC PURCHASE.
--
-- THE COSTING RULE NEEDS NO NEW FLAG. "Purchase rate covers yarn + dyeing;
-- dyeing process cost = 0": it is `is_cloth_purchase` (0583 · 0612), which the
-- Budget already skips as a process line (a purchase is the yarn line, never a
-- job charge). The per-shade YARN DYEING charge is the other half — the report
-- leaves a bought-dyed yarn out of its YARN DYEING block (code, same commit),
-- which is where the Budget's per-shade dyeing lines are read from.
--
-- Matched by name only to seed; every reader goes by the flags.
-- ============================================================================

insert into public.processes (name, for_yarn, is_cloth_purchase)
select 'DYED YARN PURCHASE', true, true
where not exists (select 1 from public.processes where upper(trim(name)) = 'DYED YARN PURCHASE');

update public.processes
   set for_yarn = true, is_cloth_purchase = true
 where upper(trim(name)) = 'DYED YARN PURCHASE';

-- DYED YARN PURCHASE → DYED, base (0611's stage matching: code or name).
insert into public.process_fabric_stages (process_id, stage_id, is_base)
select p.id, s.id, true
  from public.processes p
  join public.config_lookups s
    on s.kind = 'fabric_stage'
   and (lower(s.code) = 'dyed' or upper(s.name) = 'DYED')
 where upper(trim(p.name)) = 'DYED YARN PURCHASE'
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.stage_id = s.id)
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.is_base);

do $$
begin
  if not exists (
    select 1
      from public.processes p
      join public.process_fabric_stages x on x.process_id = p.id and x.is_base
      join public.config_lookups s on s.id = x.stage_id
     where upper(trim(p.name)) = 'DYED YARN PURCHASE' and p.for_yarn and p.is_cloth_purchase
       and (lower(s.code) = 'dyed' or upper(s.name) = 'DYED')
  ) then
    raise exception '0648: DYED YARN PURCHASE is not seeded as the base of DYED';
  end if;
end $$;
