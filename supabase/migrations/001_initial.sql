create extension if not exists pgcrypto with schema extensions;

create table if not exists public.dashboard_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  username text not null unique,
  password_hash text not null,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.devices (
  device_id text primary key,
  display_name text not null default 'Vigía ESP32',
  last_seen timestamptz,
  wifi_rssi integer,
  uptime_seconds bigint,
  firmware_version text,
  local_ip inet,
  motion_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.device_config (
  device_id text primary key references public.devices(device_id) on delete cascade,
  heartbeat_interval_seconds integer not null default 15 check (heartbeat_interval_seconds between 5 and 3600),
  alert_cooldown_seconds integer not null default 10 check (alert_cooldown_seconds between 5 and 3600),
  pir_pin integer not null default 27,
  sensor_type text not null default 'HC-SR501',
  sensor_range_cm integer not null default 700,
  sensor_angle_deg integer not null default 120,
  ap_ssid text not null default 'Vigia-ESP32',
  updated_at timestamptz not null default now()
);

create table if not exists public.motion_events (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  event_type text not null check (event_type in ('motion_start', 'motion_end')),
  occurred_at timestamptz not null default now(),
  device_epoch bigint,
  uptime_seconds bigint,
  received_at timestamptz not null default now()
);

create index if not exists motion_events_device_time_idx
  on public.motion_events (device_id, occurred_at desc);

alter table public.dashboard_users enable row level security;
alter table public.devices enable row level security;
alter table public.device_config enable row level security;
alter table public.motion_events enable row level security;

revoke all on public.dashboard_users, public.devices, public.device_config, public.motion_events from anon, authenticated;
grant all on public.dashboard_users, public.devices, public.device_config, public.motion_events to service_role;
grant usage, select on sequence public.motion_events_id_seq to service_role;

create or replace function public.authenticate_dashboard_user(p_username text, p_password text)
returns table(user_id uuid, full_name text, username text, role text)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.full_name, u.username, u.role
  from public.dashboard_users as u
  where lower(u.username) = lower(trim(p_username))
    and extensions.crypt(p_password, u.password_hash) = u.password_hash
  limit 1;
$$;

revoke all on function public.authenticate_dashboard_user(text, text) from public, anon, authenticated;
grant execute on function public.authenticate_dashboard_user(text, text) to service_role;

insert into public.dashboard_users (full_name, username, password_hash, role)
values ('Jose Fernando Campero', 'admin', extensions.crypt('admin', extensions.gen_salt('bf', 12)), 'admin')
on conflict (username) do update
set full_name = excluded.full_name,
    role = excluded.role;

insert into public.devices (device_id, display_name)
values ('vigia-esp32-01', 'Vigía ESP32 principal')
on conflict (device_id) do update set display_name = excluded.display_name;

insert into public.device_config (
  device_id, heartbeat_interval_seconds, alert_cooldown_seconds, pir_pin,
  sensor_type, sensor_range_cm, sensor_angle_deg, ap_ssid
)
values ('vigia-esp32-01', 15, 10, 27, 'HC-SR501', 700, 120, 'Vigia-ESP32')
on conflict (device_id) do update set
  heartbeat_interval_seconds = excluded.heartbeat_interval_seconds,
  alert_cooldown_seconds = excluded.alert_cooldown_seconds,
  pir_pin = excluded.pir_pin,
  sensor_type = excluded.sensor_type,
  sensor_range_cm = excluded.sensor_range_cm,
  sensor_angle_deg = excluded.sensor_angle_deg,
  ap_ssid = excluded.ap_ssid,
  updated_at = now();
