-- ============================================================================
-- Raagam ERP — 0837 Pulse: an online chat event carries its Google Meet link
--
-- User 2026-11-12: "google meet link varala". A chat 📎 Event whose Location is
-- blank or says it is online ("ONLINE", "Google Meet", "video call") is now
-- created in Google Calendar WITH a Meet link (lib/comms/card-actions.ts,
-- wantsMeet). Google puts the link in every guest's invite; this column keeps
-- it on the chat event too, so the card can show "Join Google Meet".
--
-- Written only by the server (service role) after Google answers, like 0823's
-- google_event_id beside it. Members read it through 0776's existing policies.
-- NEEDS 0823 APPLIED FIRST.
--
-- ROLLBACK:
--   alter table public.comm_events drop column google_meet_link;
-- ============================================================================

alter table public.comm_events
  add column if not exists google_meet_link text;
