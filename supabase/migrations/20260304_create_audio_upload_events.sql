create table if not exists public.audio_upload_events (
  id bigint generated always as identity primary key,
  object_path text not null,
  public_url text not null,
  file_name text not null,
  content_type text not null,
  payload_version integer null,
  duration_ms integer null,
  size_bytes bigint null,
  mime_type text null,
  extension text null,
  recorded_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audio_upload_events_created_at
  on public.audio_upload_events (created_at desc);

create index if not exists idx_audio_upload_events_object_path
  on public.audio_upload_events (object_path);

alter table public.audio_upload_events enable row level security;

drop policy if exists "audio_upload_events_select_authenticated" on public.audio_upload_events;
create policy "audio_upload_events_select_authenticated"
  on public.audio_upload_events
  for select
  to authenticated
  using (true);
