-- ============================================================================
-- 0747 — Resolve Hub: the tracking RPCs take the token's HASH, and the outbox
--        drain learns which complaints are sensitive.
--
-- 1. rh_track_complaint / rh_track_withdraw took the raw 43-char token, so it
--    reached Postgres — statement logs, pg_stat_statements, error context. The
--    server now sends sha256(token) as 64 lowercase hex and the RPCs compare it
--    straight to tracking_token_hash; the raw token never enters the database
--    after the submit that minted it. An IN parameter cannot be renamed by
--    `create or replace`, so the old (p_token) functions are dropped.
-- 2. rh_outbox_claim returns `is_sensitive` (the complaint category's flag;
--    false for Broken and digest rows) so the drain never prints a sensitive
--    complaint's subject in an alert. A new OUT column changes the return type,
--    so the function is dropped and re-created.
-- ============================================================================

drop function public.rh_track_complaint(text);
drop function public.rh_track_withdraw(text);

create function public.rh_track_complaint(p_token_hash text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  t public.rh_tickets;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into t from public.rh_tickets x
   where x.tracking_token_hash = p_token_hash and x.kind = 'complaint';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'ref_no', t.ref_no, 'subject', t.title, 'status', t.status, 'created_at', t.created_at,
    'first_response_at', t.first_response_at, 'resolved_at', t.resolved_at,
    'withdrawn_at', t.withdrawn_at, 'resolution_message', t.resolution_message);
end;
$$;

create function public.rh_track_withdraw(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tickets;
begin
  if p_token_hash is not null and p_token_hash ~ '^[0-9a-f]{64}$' then
    select * into t from public.rh_tickets x
     where x.tracking_token_hash = p_token_hash and x.kind = 'complaint'
     for update;
  end if;
  if t.id is null then
    raise exception 'This tracking link is not recognised.' using errcode = 'P0001';
  end if;
  if t.status not in ('open', 'assigned', 'in_progress', 'escalated') then
    raise exception 'This complaint is already % and can no longer be withdrawn.', t.status using errcode = 'P0001';
  end if;
  update public.rh_tickets set status = 'withdrawn', withdrawn_at = now() where id = t.id;
  insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status)
  values (t.id, null, 'withdrawn', t.status, 'withdrawn');
  return jsonb_build_object('status', 'withdrawn');
end;
$$;

revoke all on function public.rh_track_complaint(text) from public, anon, authenticated;
revoke all on function public.rh_track_withdraw(text) from public, anon, authenticated;
grant execute on function public.rh_track_complaint(text) to service_role;
grant execute on function public.rh_track_withdraw(text) to service_role;

drop function public.rh_outbox_claim(int);

create function public.rh_outbox_claim(p_limit int default 50)
returns table (id uuid, activity_id uuid, ticket_id uuid, location_id uuid, event_key text,
               recipient_id uuid, channel text, attempts int, ref_no text, title text,
               location_name text, action text, note text, meta jsonb, is_sensitive boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with c as (
    select o.id from public.rh_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  ), u as (
    update public.rh_outbox o set next_attempt_at = now() + interval '5 minutes'
      from c where o.id = c.id
    returning o.*
  )
  select u.id, u.activity_id, u.ticket_id, u.location_id, u.event_key, u.recipient_id, u.channel,
         u.attempts, t.ref_no, t.title, l.name, a.action, a.note, a.meta,
         coalesce(cat.is_sensitive, false)
    from u
    join public.rh_ticket_activity a on a.id = u.activity_id
    left join public.rh_tickets t on t.id = u.ticket_id
    left join public.rh_complaint_categories cat on cat.id = t.category_id
    left join public.locations l on l.id = u.location_id
   order by u.created_at;
end;
$$;

revoke all on function public.rh_outbox_claim(int) from public, anon, authenticated;
grant execute on function public.rh_outbox_claim(int) to service_role;
