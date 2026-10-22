alter table public.devices add column if not exists raw_pir_high boolean;
alter table public.devices add column if not exists raw_pir_edges bigint;
alter table public.devices add column if not exists sensor_ready boolean;
alter table public.devices add column if not exists sensor_armed boolean;
alter table public.devices add column if not exists suppressed_alerts bigint;
alter table public.devices add column if not exists free_heap bigint;

create table if not exists public.device_telemetry (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  log_type text not null check (log_type in ('heartbeat', 'motion_start', 'motion_end')),
  received_at timestamptz not null default now(),
  device_epoch bigint,
  uptime_seconds bigint,
  wifi_rssi integer,
  free_heap bigint,
  motion_active boolean not null default false,
  monitoring_active boolean,
  sensor_ready boolean,
  sensor_armed boolean,
  raw_pir_high boolean,
  raw_pir_edges bigint,
  suppressed_alerts bigint,
  firmware_version text
);

create index if not exists device_telemetry_device_time_idx
  on public.device_telemetry (device_id, received_at desc);

alter table public.device_telemetry enable row level security;
revoke all on public.device_telemetry from anon, authenticated;
grant all on public.device_telemetry to service_role;
grant usage, select on sequence public.device_telemetry_id_seq to service_role;

update public.device_config
set heartbeat_interval_seconds = 5,
    updated_at = now()
where device_id = 'vigia-esp32-01';

notify pgrst, 'reload schema';
