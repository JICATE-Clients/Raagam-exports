-- 0728 · Sample Costing — a SAVED costing is Under Progress (user 2026-10-14,
--        screenshot 3475: "Pending is the SMP; right after creating the
--        costing, a new tab Under Progress in the Costing child").
--
-- 0725 put a "Send to Buyer" step between Save and Under Progress. The user's
-- flow has none: Pending = a sample not costed yet; the moment its costing is
-- saved it is Under Progress (with the buyer, negotiating); then Approved /
-- Rejected on the buyer's answer. So `save_sample_costing` now stamps
-- `submitted` (Under Progress) on any save that is not a draft. Two cases keep
-- Draft: a save AS a draft, and a Sample Revision's proposed costing (0716 —
-- its guard refuses `submitted` outside the revision functions).
--
-- Extended IN PLACE from the live 0725 body: two `replace()`s, each required
-- to match exactly once. The one saved-but-Draft sample sheet is moved too.

do $do$
declare
  v_def text;
  a1 text := $a$  if v_opp is null then
    raise exception 'Choose the Sample No before saving the costing.'$a$;
  b1 text := $b$  -- 0728: a NEW costing that is saved (not as a draft) starts Under Progress.
  if v_parent is null and v_id is null then
    v_start := case when v_draft then 'draft' else 'submitted' end;
    if (public.sample_open_revision(v_opp)).id is not null then
      v_start := 'draft';
    end if;
  end if;

  if v_opp is null then
    raise exception 'Choose the Sample No before saving the costing.'$b$;
  a2 text := $a$      status              = case when v_status = 'submitted' then 'submitted' else 'draft' end,$a$;
  b2 text := $b$      -- 0728: saved = Under Progress, unless a draft save or a Sample Revision's proposal.
      status              = case
                              when v_status <> 'submitted' and (public.sample_open_revision(v_opp)).id is not null then 'draft'
                              when v_status = 'submitted' or not v_draft then 'submitted'
                              else 'draft' end,$b$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_sample_costing';
  if position('0728' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then raise exception '0728: anchor 1 not found once'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception '0728: anchor 2 not found once'; end if;
  execute replace(replace(v_def, a1, b1), a2, b2);
end
$do$;

update public.cost_sheets c
   set status = 'submitted', submitted_at = coalesce(c.submitted_at, c.updated_at, c.created_at)
 where c.costing_type = 'sample' and c.status = 'draft' and not coalesce(c.is_draft, false)
   and (public.sample_open_revision(c.opportunity_id)).id is null;
