-- Rename 1_system_logs to system_logs.
alter table public."1_system_logs" rename to system_logs;

-- Update the constraint names to remove the "one_" prefix.
alter table public.system_logs
  rename constraint one_system_logs_level_check to system_logs_level_check;

alter table public.system_logs
  rename constraint one_system_logs_source_check to system_logs_source_check;

alter table public.system_logs
  rename constraint one_system_logs_metadata_object_check to system_logs_metadata_object_check;
