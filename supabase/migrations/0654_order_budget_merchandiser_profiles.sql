-- 0654 — WHO IS THE MERCHANDISER OF A BUDGET'S ORDERS, AS LOGINS (client
-- 2026-09-29, "End-to-End Approval Flow" §3: the MD's decision is sent "to
-- the assigned Merchandiser").
--
-- `notifyRequesterOfDecision` told only `approval_runs.requested_by` — whoever
-- pressed Submit, which is usually but not necessarily the order's
-- merchandiser. The merchandiser is `garment_order_amendments.merchandiser_id`,
-- an EMPLOYEE since 0478, and an employee reaches a login only through
-- `profiles.employee_code = employees.code` (the join 0478 / 0547 already use;
-- there is no `employees.profile_id`).
--
-- WHY A SECURITY DEFINER FUNCTION. The notifier runs as the APPROVER, and
-- `profiles_read_own` lets a user read only their own profile row — so the
-- join cannot be done from the app. This returns ids and nothing else (the
-- same shape of exception `creator_names()` makes for names), and only for
-- active profiles.
--
-- EMPTY IS A REAL ANSWER TODAY. On 2026-09-30 none of the 5 orders carrying a
-- merchandiser resolved to a login: no profile holds a matching
-- `employee_code`. The caller therefore still notifies the requester, and
-- de-duplicates — this adds the merchandiser, it never replaces the requester.
-- Linking a merchandiser's login is setting their Employee Code on the user.

create or replace function public.order_budget_merchandiser_profiles(p_budget uuid)
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $$
  select distinct p.id
    from public.order_budget_orders o
    join public.garment_order_amendments a on a.id = o.garment_order_id
    join public.employees e on e.id = a.merchandiser_id
    join public.profiles p
      on nullif(btrim(p.employee_code), '') is not null
     and lower(btrim(p.employee_code)) = lower(btrim(e.code))
   where o.budget_id = p_budget
     and coalesce(p.is_active, true);
$$;

comment on function public.order_budget_merchandiser_profiles(uuid) is
  '0654: the active login profiles of the merchandisers of a budget''s orders (employee → profiles.employee_code). Ids only; used to send the MD''s decision to the merchandiser.';

revoke all on function public.order_budget_merchandiser_profiles(uuid) from public, anon;
grant execute on function public.order_budget_merchandiser_profiles(uuid) to authenticated;
