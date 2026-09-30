alter table public.device_config add column if not exists monitoring_enabled boolean not null default true;
alter table public.device_config add column if not exists schedule_enabled boolean not null default false;
alter table public.device_config add column if not exists weekly_schedule jsonb not null default '[]'::jsonb;
alter table public.devices add column if not exists config_version text;
alter table public.devices add column if not exists monitoring_active boolean;
notify pgrst, 'reload schema';
