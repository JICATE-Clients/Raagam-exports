-- ============================================================================
-- Raagam ERP — 0389  Garment Rejection Rule: make a tier COMPUTABLE, and let a
--                    Garment PPM point at one
--
-- The rule master (0264) has stored tiers since it was built — range label,
-- From, To, Rejection Allowance — and nothing has ever been able to calculate
-- from them, for one reason: `rejection_allowance` is a single bare numeric with
-- no way to say what it MEANS. The client's own rule needs both kinds at once:
--
--   order 1 – 15     + 3 PIECES        2 ordered     →  5
--   order 16 – 100   + 8 PERCENT       50 ordered    → 54
--   order 101 +      + 5 PERCENT       1,000 ordered → 1,050
--
-- A rule holding "3", "8", "5" cannot tell the first from the other two, so the
-- tiers could be typed in and never used. `allowance_type` is the missing half.
--
-- THE RULE HANGS OFF THE PPM HEADER, not off each quantity line: the operator
-- picks it once per document ("select a Garment Rejection Rule from a dropdown")
-- and every SC line beneath is measured by the same rule. Nullable, because a
-- PPM raised before this existed has no rule and must keep opening.
--
-- Nothing is backfilled and nothing needs to be: the live database holds ZERO
-- rules and zero rule lines, checked before writing this. `default 'percent'` is
-- therefore only for a hand-inserted row — it is the commoner of the two, and it
-- is `not null` so a tier can never be silently uncomputable again, which is the
-- whole defect being fixed.
--
-- Note `range_label` is deliberately left alone. It is a free-text caption the
-- operator writes ("1 TO 15") and it is never parsed — from_value/to_value
-- decide, and lib/masters/rejection-rule.ts reads only those.
-- ============================================================================

alter table public.garment_rejection_rule_lines
  add column if not exists allowance_type text not null default 'percent'
    check (allowance_type in ('flat', 'percent'));

comment on column public.garment_rejection_rule_lines.allowance_type is
  'What `rejection_allowance` means on this tier: flat = extra PIECES, '
  'percent = a share of the order quantity. One rule mixes both (0389).';

-- ---------------------------------------------------------------------------
-- THE PPM HALF IS GUARDED, and the guard is not defensive habit — it is load
-- bearing. `public.garment_ppms` DOES NOT EXIST in this database. The Planning
-- PPM migrations (0368–0372) are files in this repo that were never applied
-- here: 0332_drop_planning_module dropped the module and the later planning
-- migrations have never been run against it. `select ... like '%ppm%'` returns
-- nothing, and an unguarded `alter table` here fails the whole migration with
-- "relation public.garment_ppms does not exist".
--
-- So this runs when planning is present and stands down when it is not, which
-- makes the file correct in both databases rather than correct in neither. The
-- app-side wiring of Garment PPM is deliberately NOT in this change for the same
-- reason — there is nothing to wire it to yet.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.garment_ppms') is not null then
    alter table public.garment_ppms
      add column if not exists rejection_rule_id uuid
        references public.garment_rejection_rules(id);

    comment on column public.garment_ppms.rejection_rule_id is
      'Which Garment Rejection Rule sizes this PPM''s quantity lines. Picked '
      'once per document; every SC line under it uses the same rule (0389).';

    create index if not exists idx_garment_ppms_rejection_rule
      on public.garment_ppms(rejection_rule_id);
  end if;
end $$;
