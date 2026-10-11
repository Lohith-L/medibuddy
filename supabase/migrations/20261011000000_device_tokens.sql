-- Migration: device_tokens table for FCM push notifications
-- Run this in the Supabase Dashboard → SQL Editor
--
-- This table stores one FCM token per device per user.
-- On Android the token comes from Firebase Cloud Messaging.
-- RLS ensures users can only read/write their own tokens.

create table if not exists public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null,
  platform    text not null check (platform in ('android', 'ios', 'web')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, token)
);

-- Enable RLS
alter table public.device_tokens enable row level security;

-- Users can only manage their own tokens
create policy "Users can insert own device tokens"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can select own device tokens"
  on public.device_tokens for select
  using (auth.uid() = user_id);

create policy "Users can delete own device tokens"
  on public.device_tokens for delete
  using (auth.uid() = user_id);

create policy "Users can update own device tokens"
  on public.device_tokens for update
  using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger device_tokens_updated_at
  before update on public.device_tokens
  for each row execute function public.set_updated_at();
