-- 0764 · ABOVE-BUDGET POs THROUGH MY APPROVALS, AND THE APPROVER'S SIGNATURE (user 2026-10-28)
--
-- Two decisions, both the user's:
--
--   1. "Route all above-budget and unbudgeted PO requests into the centralized
--      /approvals inbox." Until now such a PO went `pending_approval` (0737) and the MD
--      was sent a push that opened the PO page, where `approvePo` / `rejectPo` /
--      `declinePo` wrote the status directly. The `purchase_order` workflow and its
--      catch-all flow (0503, → Managing Director) existed and nothing started them.
--      Now the save starts a run, and the run's end writes the PO — here, inside
--      `approval_apply_terminal`, the way every other document is decided.
--
--   2. "When an authorized user clicks Approve, capture a permanent snapshot of that
--      approver's digital signature image and store it against the PO record."
--      Each login uploads its own signature (My Profile); approving a PO copies the
--      approver's CURRENT signature path onto the PO. Signature files are never
--      overwritten or deleted (no update / delete policy below), so a path frozen on
--      a PO keeps pointing at the image that was current the day it was approved,
--      even after the approver uploads a new one.
--
-- WHAT THE RUN'S ENDS MEAN FOR A PO
--   completed → approved, approved_by / approved_at, signature snapshot. Print unlocks.
--   rejected  → draft, with the MD's reason in the notes ("Request Rework" — the
--               engine's one negative end, as on the budget). The Purchase Manager
--               revises and sends it again. Closing a PO for good is still the PO
--               page's Reject (`declinePo`), which ends the run this same way first.
--   cancelled → draft (the requester withdrew it).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists signature_path text;
comment on column public.profiles.signature_path is
  'This login''s signature image in the private `signatures` bucket (0764). Set only by set_my_signature().';

alter table public.purchase_orders
  add column if not exists approver_signature_path text;
comment on column public.purchase_orders.approver_signature_path is
  'The approver''s signature as it was when they approved this PO (0764) — printed on the PO. Never updated after.';

-- ---------------------------------------------------------------------------
-- 2. The private signature bucket
-- ---------------------------------------------------------------------------
-- PRIVATE, unlike `company-assets` (0589): a public signature URL is a signature
-- anyone can paste onto a document. The print reads it server-side with a
-- short-lived signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Each login writes and reads ONLY its own folder (`<uid>/…`). No update and no
-- delete policy: a signature file is immutable, which is what makes a path
-- frozen on a PO a real snapshot.
drop policy if exists "signatures_insert_own" on storage.objects;
create policy "signatures_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "signatures_read_own" on storage.objects;
create policy "signatures_read_own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 3. Setting one's own signature
-- ---------------------------------------------------------------------------
create or replace function public.set_my_signature(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- Only a file in the caller's own folder — never someone else's signature.
  if p_path is not null and split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'That signature file is not yours' using errcode = '42501';
  end if;
  update public.profiles set signature_path = p_path where id = auth.uid();
end;
$$;
revoke all on function public.set_my_signature(text) from public, anon;
grant execute on function public.set_my_signature(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The decision, applied to the PO
-- ---------------------------------------------------------------------------
create or replace function public.purchase_order_apply_decision(
  p_po uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_rows int;
begin
  if p_run_status = 'cancelled' then
    update public.purchase_orders
       set status = 'draft', updated_at = now()
     where id = p_po and status = 'pending_approval';
    return;
  end if;
  if p_run_status not in ('completed', 'rejected') then
    return;
  end if;

  if p_run_status = 'completed' then
    update public.purchase_orders po
       set status                  = 'approved',
           approved_by             = p_actor,
           approved_at             = now(),
           approver_signature_path = (select pr.signature_path from public.profiles pr where pr.id = p_actor),
           updated_at              = now()
     where po.id = p_po and po.status = 'pending_approval';
  else
    update public.purchase_orders po
       set status     = 'draft',
           notes      = concat_ws(E'\n', nullif(po.notes, ''), 'MD: ' || coalesce(nullif(trim(p_remark), ''), '(no reason given)')),
           updated_at = now()
     where po.id = p_po and po.status = 'pending_approval';
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception
      'Purchase order % is not waiting for approval, so this decision could not be applied. Reload it — it may already have been decided another way.',
      p_po using errcode = '55000';
  end if;
end;
$function$;
revoke all on function public.purchase_order_apply_decision(uuid, text, uuid, text) from public, anon, authenticated;

-- approval_apply_terminal: ONE branch added to the LIVE body, before its final
-- refusal — never retyped (the 0718b / 0720b idiom).
do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''purchase_orders'' then\n'
                || E'        perform public.purchase_order_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''purchase_orders''' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0764: approval_apply_terminal final refusal not found';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;
