-- Phone notifications (Web Push) for staff, plus a server-only store for app-level secrets.

-- One row per browser/phone that allowed notifications. Only the server reads and writes it.
create table if not exists public.push_subscriptions(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_id uuid not null,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete cascade
);
create index if not exists push_subscriptions_staff_idx on public.push_subscriptions(organisation_id, staff_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- App-level secrets the server generates itself (the Web Push signing key). Values are encrypted by the app.
create table if not exists public.app_secrets(
  name text primary key,
  sealed jsonb not null,
  public_value text,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Reminders can now also go out as a phone notification.
alter table public.availability_message_attempts drop constraint if exists availability_message_attempts_channel_check;
alter table public.availability_message_attempts add constraint availability_message_attempts_channel_check check (channel in ('whatsapp_provider','manual_whatsapp','push'));

-- One row per notification that must only go out once (e.g. "your shift starts in 2 hours").
create table if not exists public.push_deliveries(
  key text primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
