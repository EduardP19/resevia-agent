-- Add dashboard_event as a valid source so client-side analytics can be
-- persisted in 1_system_logs alongside server-side operational logs.
alter table public."1_system_logs"
  drop constraint one_system_logs_source_check;

alter table public."1_system_logs"
  add constraint one_system_logs_source_check
    check (source in (
      'edge_function',
      'whatsapp_webhook',
      'sms_webhook',
      'ai_call',
      'auth',
      'billing',
      'cron',
      'dashboard_event'
    ));
