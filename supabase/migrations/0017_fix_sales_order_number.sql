-- ============================================================================
-- Raagam ERP — 0017 Fix sales-order code generation
-- The generic public.assign_code() trigger assigns NEW.code, but sales_orders
-- names its human-readable code column `order_number` (not `code`). Inserting an
-- order therefore raised:  record "new" has no field "code".
--
-- sales_orders is the ONLY table that deviates from the `code` convention, so we
-- give it a dedicated BEFORE INSERT trigger function instead of complicating the
-- generic assign_code() that 18 other tables rely on. Numbering continues to use
-- the existing public.seq_sales_order sequence, so codes stay consistent.
-- ============================================================================

create or replace function public.assign_order_number()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number :=
      'SO-' || lpad(nextval('public.seq_sales_order')::text, 4, '0');
  end if;
  return new;
end;
$$;

-- Replace the mis-wired trigger (was calling assign_code -> NEW.code).
drop trigger if exists trg_so_code on public.sales_orders;
create trigger trg_so_code before insert on public.sales_orders
  for each row execute function public.assign_order_number();
