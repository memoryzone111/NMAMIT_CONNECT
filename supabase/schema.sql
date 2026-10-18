-- NMAMIT CONNECT starter schema.
-- Run in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.displays (
  id text primary key,
  name text not null default 'NMAMIT LED',
  pair_code text not null unique,
  controller_token text not null,
  is_active boolean not null default true,
  playback_state text not null default 'playing' check (playback_state in ('playing','paused')),
  loop_mode text not null default 'playlist' check (loop_mode in ('off','one','playlist')),
  current_index integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  display_id text not null references public.displays(id) on delete cascade,
  title text not null,
  media_url text not null,
  media_type text not null check (media_type in ('image','video')),
  duration_seconds integer not null default 10 check (duration_seconds between 1 and 3600),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists playlist_items_display_position_idx
  on public.playlist_items(display_id, position);

alter table public.displays enable row level security;
alter table public.playlist_items enable row level security;

-- The initial starter exposes active display and playlist reads to anon clients.
-- Replace these broad read policies with authenticated/Edge Function policies before production.
drop policy if exists "active display read" on public.displays;
create policy "active display read" on public.displays
  for select to anon, authenticated using (is_active = true);

drop policy if exists "playlist read" on public.playlist_items;
create policy "playlist read" on public.playlist_items
  for select to anon, authenticated using (
    exists (select 1 from public.displays d where d.id = display_id and d.is_active = true)
  );

-- Mutations are deliberately not granted to anon by SQL policies. The demo controller
-- includes a clear setup boundary: secure production writes should be moved to an Edge Function.
-- Do NOT enable unrestricted anon insert/update/delete policies for a public signage controller.

insert into storage.buckets (id, name, public)
values ('signage-media', 'signage-media', true)
on conflict (id) do nothing;

-- Public read access only for the signage-media bucket.
drop policy if exists "public signage media read" on storage.objects;
create policy "public signage media read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'signage-media');

-- Storage upload policy is intentionally not granted to anon. For production uploads,
-- use authenticated users or an Edge Function that verifies a display/controller token.
