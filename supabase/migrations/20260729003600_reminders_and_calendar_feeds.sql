-- Smart reminders and personal calendar feeds.

-- When the automatic (or "remind now") WhatsApp nudge went out to someone who had not answered yet.
alter table public.availability_request_recipients add column if not exists reminded_at timestamptz;

-- One subscribable calendar link per person. Only the hash is stored; making a new link replaces the old one.
-- No policies: only the server (service role) reads or writes this table.
create table if not exists public.staff_calendar_feeds(
  staff_id uuid primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete cascade
);
alter table public.staff_calendar_feeds enable row level security;
revoke all on public.staff_calendar_feeds from anon, authenticated;
