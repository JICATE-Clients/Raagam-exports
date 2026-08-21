-- 0453 — which TA Style template a plan was built from.
--
-- `ta_styles` + `ta_style_activities` (0133) is the reusable ladder: an ordered
-- list of activities, each with a predecessor and a `days_required`.
-- `ta_plan_docs` + `ta_plan_activities` (0271 · 0401) is the document a planner
-- fills in for one order. Until now NOTHING connected the two — the template
-- existed, the plan existed, and the only way to get one into the other was to
-- retype it. This column is the link.
--
-- ## THE COPY IS A SNAPSHOT, AND THIS COLUMN DOES NOT CHANGE THAT
--
-- Applying a template WRITES its rows into `ta_plan_activities` and the plan
-- then owns them. A later edit to the template does not reach back: a plan is a
-- commitment with real dates on it, and a template edit silently moving them is
-- how a floor comes to work to dates nobody agreed. Re-applying is deliberate.
--
-- So this column is PROVENANCE, not a live reference. It answers "where did this
-- ladder come from", which nothing could answer before: a template found to be
-- wrong could not be traced to the plans built on it, and no screen could offer
-- to re-apply because it did not know what to re-apply.
--
-- ## `on delete set null`, NEVER cascade
--
-- Deleting a template must not delete plans built from it — they hold real
-- dates against real orders and the template is only where their rows started.
-- The plan keeps its ladder and forgets its origin, which is the honest outcome:
-- the provenance genuinely is gone.
alter table public.ta_plan_docs
  add column if not exists ta_style_id uuid references public.ta_styles(id) on delete set null;

comment on column public.ta_plan_docs.ta_style_id is
  'The TA Style template this plan''s activity ladder was copied from. PROVENANCE ONLY - the copy is a snapshot and a later template edit never reaches the plan. NULL means the ladder was typed by hand or its template has since been deleted.';

-- "Which plans came from this template" is the question the column exists to
-- answer, so it is indexed. Partial: the overwhelming majority of rows will be
-- hand-typed plans carrying NULL, and those are never the answer.
create index if not exists ta_plan_docs_ta_style_id_idx
  on public.ta_plan_docs (ta_style_id)
  where ta_style_id is not null;
