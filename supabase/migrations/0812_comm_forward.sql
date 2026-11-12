-- ============================================================================
-- 0812 — Pulse: forward a photo to other chats (user 2026-11-05, the "forward
-- an image" board: a round ↪ beside a photo, pick chats, Send; the copy arrives
-- marked "Forwarded").
--
-- WHAT THE DATABASE OWNS HERE IS ONLY THE MARK. The forward itself is ordinary
-- sending: lib/comms/forward-actions.ts copies each photo's bytes into the
-- target conversation's folder (a NEW key — comm_attachments.storage_path is
-- unique, and deleting the original deletes its bytes, so two messages must
-- never share one object), writes the comm_upload_checks row for the copy, and
-- calls comm_send_message unchanged. So membership, archived chats, blocks and
-- every attachment rule are enforced exactly as for a typed message.
--
--   1. comm_messages.forwarded — false for every existing row.
--   2. comm_mark_forwarded(message) — sets it on the CALLER's own, live
--      message. A label, not a permission: the worst a caller can do is call
--      their own message forwarded.
--
-- ROLLBACK: drop function public.comm_mark_forwarded(uuid);
--           alter table public.comm_messages drop column forwarded;
-- The app reads the column through a separate query that tolerates its absence.
-- ============================================================================

alter table public.comm_messages
  add column if not exists forwarded boolean not null default false;

create or replace function public.comm_mark_forwarded(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comm_messages m
     set forwarded = true
   where m.id = p_message
     and m.author_id = public.comm_actor()
     and m.deleted_at is null;
  if not found then
    raise exception 'That message could not be marked as forwarded.' using errcode = '42501';
  end if;
end $$;

revoke all on function public.comm_mark_forwarded(uuid) from public, anon;
grant execute on function public.comm_mark_forwarded(uuid) to authenticated;
