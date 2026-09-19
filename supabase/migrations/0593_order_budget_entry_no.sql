-- 0593 — A budget's Entry No is a plain serial: 1, 2, 3 … (2026-09-19)
--
-- `order_budgets.code` has been the Entry No since 0428 and NOTHING ever
-- filled it: no default, no trigger, every row NULL, so the Budget screen's
-- Entry No box was always blank. The client's instruction (from the ERP
-- recordings, 2026-09-19) is a simple auto-incrementing serial, no year and no
-- prefix, unlike the planning budgets' `assign_code('BDG', …)`.
--
-- MAX + 1 UNDER A LOCK, NOT A SEQUENCE. A sequence burns a number on every
-- failed insert, and a budget whose save was refused would leave a gap the
-- operator reads as a deleted budget. The advisory lock makes two saves at the
-- same moment take turns; the unique index is the backstop.
--
-- SECURITY DEFINER because a unit's user may not see another unit's budgets
-- (location RLS), and a max() over the rows they CAN see would hand out a
-- number another unit already holds. It reads nothing but `code`.
--
-- A code already given (an import, a hand-set number) is kept. Only a NULL or
-- blank code is numbered.

create or replace function public.assign_order_budget_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    perform pg_advisory_xact_lock(hashtext('order_budgets.code'));
    select coalesce(max(code::bigint), 0) + 1
      into new.code
      from public.order_budgets
     where code ~ '^[0-9]+$';
  end if;
  return new;
end;
$$;

-- AGENTS.md "Function grants": both grants, one statement.
revoke all on function public.assign_order_budget_code() from public, anon;

drop trigger if exists trg_ob_assign_code on public.order_budgets;
create trigger trg_ob_assign_code
  before insert on public.order_budgets
  for each row execute function public.assign_order_budget_code();

create unique index if not exists uq_order_budgets_code
  on public.order_budgets (code)
  where code is not null;

comment on column public.order_budgets.code is
  'Entry No — a plain serial (1, 2, 3 …) assigned on insert by trg_ob_assign_code (0593).';
