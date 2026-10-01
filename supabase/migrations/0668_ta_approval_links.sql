-- ============================================================================
-- Raagam ERP — 0668 Buyer approval by link (doc/order/digitalisation-plan.md §4)
--
-- The merchandiser emails the buyer a link for ONE T&A approval (lab dip, PP
-- sample, …). The buyer opens it with no login, presses Approve or Rework, and
-- the T&A row updates itself with the buyer's name, the time and the comment.
--
-- ## THE TOKEN IS NEVER STORED
--
-- `token_hash` is the sha-256 (hex) of a 32-byte random token. The token lives
-- only in the email (and, once, on the merchandiser's screen to copy). A leaked
-- table therefore opens no approval page. The reminder email cannot repeat the
-- link for the same reason — it points the buyer at the first email instead.
--
-- ## THE DECISION IS ONE FUNCTION, AND ONLY THE SERVER MAY CALL IT
--
-- `ta_link_decide` is SECURITY DEFINER and granted to `service_role` ONLY — not
-- `anon`, not `authenticated` (AGENTS.md "Function grants"). The public page
-- calls it through the admin client after the server has hashed the token; the
-- token is the authorisation, so the function trusts nothing else. It locks the
-- link and the approval row, refuses a used / expired / superseded link, and
-- for Rework writes the history snapshot AND resets the live row in one
-- transaction — the two-write gap `markApprovalRework` records in its own
-- header does not exist on this path.
--
-- A STAFF DECISION WINS. If the merchandiser marks the row by hand (or a newer
-- version is sent), the row is no longer `sent` at the link's version and the
-- link answers "already answered" — it never overwrites a person.
-- ============================================================================

-- ---------- 1. who decided, on the live row --------------------------------
alter table public.garment_order_amendment_ta_approvals
  add column if not exists decided_by_name  text,
  add column if not exists decision_comment text,
  add column if not exists decided_at       timestamptz,
  add column if not exists decided_via      text;

alter table public.garment_order_amendment_ta_approvals
  drop constraint if exists goa_ta_approvals_decided_via_chk;
alter table public.garment_order_amendment_ta_approvals
  add constraint goa_ta_approvals_decided_via_chk check (decided_via is null or decided_via in ('link', 'staff'));

comment on column public.garment_order_amendment_ta_approvals.decided_via is
  '0668: how the last decision arrived — ''link'' (the buyer, through ta_link_decide) or ''staff''. NULL on rows decided before 0668 or by the worklist buttons.';

-- ---------- 2. the links ----------------------------------------------------
create table if not exists public.ta_approval_links (
  id               uuid primary key default gen_random_uuid(),
  approval_row_id  uuid not null references public.garment_order_amendment_ta_approvals(id) on delete cascade,
  amendment_id     uuid not null references public.garment_order_amendments(id) on delete cascade,
  -- The approval row's active_version when the link was sent. A rework bumps
  -- it, so a link to version 1 can never decide version 2.
  version          integer not null,
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  recipient_email  text not null check (length(recipient_email) between 3 and 320),
  recipient_name   text,
  message          text,
  -- [{ "path": "<amendment>/<row>/links/<uuid>.pdf", "name": "...", "mime": "..." }]
  -- in the private `order-approval-docs` bucket; shown through short signed URLs.
  files            jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  status           text not null default 'open'
                   check (status in ('open', 'approved', 'rework', 'expired', 'revoked', 'superseded')),
  expires_at       timestamptz not null,
  email_sent_at    timestamptz,
  reminder_sent_at timestamptz,
  decided_at       timestamptz,
  decided_by_name  text,
  decision_comment text,
  created_by       uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_ta_approval_links_row on public.ta_approval_links(approval_row_id);
-- One live link per approval row: sending a new one revokes the old first.
create unique index if not exists uq_ta_approval_links_open
  on public.ta_approval_links(approval_row_id) where status = 'open';

alter table public.ta_approval_links enable row level security;

drop policy if exists ta_approval_links_read   on public.ta_approval_links;
drop policy if exists ta_approval_links_insert on public.ta_approval_links;
drop policy if exists ta_approval_links_update on public.ta_approval_links;

create policy ta_approval_links_read on public.ta_approval_links
  for select to authenticated using (public.has_permission('orders', 'view'));
create policy ta_approval_links_insert on public.ta_approval_links
  for insert to authenticated with check (public.has_permission('orders', 'edit'));
-- Revoking an older link and stamping email_sent_at. No delete policy: a link
-- is history, the same stance as the approval history table (0544).
create policy ta_approval_links_update on public.ta_approval_links
  for update to authenticated
  using (public.has_permission('orders', 'edit'))
  with check (public.has_permission('orders', 'edit'));

comment on table public.ta_approval_links is
  '0668: one emailed buyer-approval link per (T&A approval row, version). token_hash = sha256 hex; the token itself is never stored. Decided only through ta_link_decide (service_role).';

-- ---------- 3. the decision -------------------------------------------------
create or replace function public.ta_link_decide(
  p_token_hash text,
  p_decision   text,
  p_name       text,
  p_comment    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.ta_approval_links%rowtype;
  v_row     public.garment_order_amendment_ta_approvals%rowtype;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_decision not in ('approved', 'rework') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  if v_name is null or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if p_decision = 'rework' and v_comment is null then
    return jsonb_build_object('ok', false, 'reason', 'comment_required');
  end if;
  if v_comment is not null and length(v_comment) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'comment_too_long');
  end if;

  select * into v_link from public.ta_approval_links
   where token_hash = p_token_hash
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_link.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', v_link.status);
  end if;
  if v_link.expires_at < now() then
    update public.ta_approval_links set status = 'expired' where id = v_link.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_row from public.garment_order_amendment_ta_approvals
   where id = v_link.approval_row_id
   for update;
  if not found or v_row.status <> 'sent' or v_row.active_version <> v_link.version then
    update public.ta_approval_links set status = 'superseded' where id = v_link.id;
    return jsonb_build_object('ok', false, 'reason', 'superseded');
  end if;

  if p_decision = 'approved' then
    update public.garment_order_amendment_ta_approvals
       set status               = 'approved',
           actual_received_date = v_today,
           decided_by_name      = v_name,
           decision_comment     = v_comment,
           decided_at           = now(),
           decided_via          = 'link'
     where id = v_row.id;
  else
    -- The same snapshot markApprovalRework writes (0544/0555 columns), then the
    -- same reset — here inside one transaction.
    insert into public.garment_order_amendment_ta_approval_history (
      source_row_id, amendment_id, approval_id, version, target_date,
      actual_sent_date, actual_sent_time, actual_received_date,
      proof_path, proof_reference, mime_type, size_bytes, status, remarks
    ) values (
      v_row.id, v_row.amendment_id, v_row.approval_id, v_row.active_version, v_row.target_date,
      v_row.actual_sent_date, v_row.actual_sent_time, v_today,
      v_row.proof_path, v_row.proof_reference, v_row.mime_type, v_row.size_bytes, 'rework',
      'BUYER (' || v_name || '): ' || v_comment
    );
    update public.garment_order_amendment_ta_approvals
       set status               = 'pending',
           active_version       = v_row.active_version + 1,
           actual_sent_date     = null,
           actual_sent_time     = null,
           actual_received_date = null,
           proof_path           = null,
           proof_reference      = null,
           mime_type            = null,
           size_bytes           = null,
           decided_by_name      = v_name,
           decision_comment     = v_comment,
           decided_at           = now(),
           decided_via          = 'link'
     where id = v_row.id;
  end if;

  update public.ta_approval_links
     set status           = p_decision,
         decided_at       = now(),
         decided_by_name  = v_name,
         decision_comment = v_comment
   where id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'decision', p_decision,
    'approval_row_id', v_row.id,
    'amendment_id', v_row.amendment_id,
    'approval_id', v_row.approval_id
  );
end;
$$;

revoke all on function public.ta_link_decide(text, text, text, text) from public, anon, authenticated;
grant execute on function public.ta_link_decide(text, text, text, text) to service_role;

comment on function public.ta_link_decide(text, text, text, text) is
  '0668: the buyer''s decision on an emailed approval link. service_role only — the caller hashes the token; the hash is the authorisation.';

-- ---------- 4. assertions ---------------------------------------------------
do $assert$
begin
  if has_function_privilege('anon', 'public.ta_link_decide(text, text, text, text)', 'execute') then
    raise exception '0668: ta_link_decide is executable by anon';
  end if;
  if has_function_privilege('authenticated', 'public.ta_link_decide(text, text, text, text)', 'execute') then
    raise exception '0668: ta_link_decide is executable by authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.ta_link_decide(text, text, text, text)', 'execute') then
    raise exception '0668: ta_link_decide is not executable by service_role';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ta_approval_links'::regclass) then
    raise exception '0668: RLS is off on ta_approval_links';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'garment_order_amendment_ta_approvals'
       and column_name = 'decided_via'
  ) then
    raise exception '0668: decided_via missing';
  end if;
end;
$assert$;
