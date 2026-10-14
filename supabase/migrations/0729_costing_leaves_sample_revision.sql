-- 0729 · Sample Costing no longer goes through a Sample Revision
--        (user 2026-10-14: "This is the proposed costing of Sample Revision
--        SMP-REV/26-27/0001 … Send it to the MD from the revision — remove this,
--        because there is no approval, just the status updated as approved").
--
-- 0725 gave the costing its own Revise and took the MD out of it; the Sample
-- Revision picker went to Sample Info only. Three 0716 leftovers still tied a
-- costing to a revision and the MD:
--
--   1. guard_sample_costing_revision refused Under Progress / Approved on a
--      revision's PROPOSED costing outside the revision functions — so that
--      costing could never take the buyer's answer. Now a no-op (the trigger
--      stays attached, so a later migration can find and re-create it).
--   2. save_sample_costing (0725 / 0728) kept a costing DRAFT while any
--      revision was open on its sample. With revisions now Sample Info only,
--      that held an ordinary new costing back from Under Progress. The three
--      tests become `false` (replaced in place, each counted).
--   3. Costing-only revisions still open (SMP-REV/26-27/0001, kinds
--      {costing}) are CLOSED as abandoned WITHOUT the revert — the revert would
--      delete the proposed costing and the details typed into it. Its proposed
--      sheet simply stays what it already is: the next Rev of that costing.
--      Then it is a saved costing like any other, so it moves to Under Progress.

-- 1 ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_sample_costing_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- 0729: a costing is no longer decided by a Sample Revision or the MD; its
  -- status is the buyer's answer (0725). Nothing to refuse.
  return new;
end;
$function$;

-- 2 ─────────────────────────────────────────────────────────────────────────
do $do$
declare
  v_def text;
  v_old text := '(public.sample_open_revision(v_opp)).id is not null';
begin
  select pg_get_functiondef('public.save_sample_costing'::regproc) into v_def;
  if position('0729' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 3 then
    raise exception '0729: expected the open-revision test 3 times in save_sample_costing';
  end if;
  execute replace(v_def, v_old, 'false /* 0729: no revision holds a costing to Draft */');
end
$do$;

-- 3 ─────────────────────────────────────────────────────────────────────────
update public.sample_revisions r
   set status = 'abandoned',
       decided_at = now(),
       decision_remark = 'Closed 2026-10-14 (0729): a costing is revised by its own Revise now — the proposed costing stays as its next Rev.',
       updated_at = now()
 where r.status = 'draft'  -- a pending one has an MD run in flight; none exists today
   and not ('sample_info' = any (r.kinds));

update public.cost_sheets c
   set status = 'submitted', submitted_at = coalesce(c.submitted_at, c.updated_at, c.created_at)
 where c.costing_type = 'sample' and c.status = 'draft' and not coalesce(c.is_draft, false);
