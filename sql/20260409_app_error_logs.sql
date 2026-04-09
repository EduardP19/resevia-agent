-- Centralized application error logs
CREATE TABLE IF NOT EXISTS public.app_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL DEFAULT 'error',
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  path TEXT,
  method TEXT,
  session_id UUID,
  salon_id UUID,
  client_identifier TEXT,
  user_agent TEXT,
  runtime TEXT
);

CREATE INDEX IF NOT EXISTS app_error_logs_created_at_idx
  ON public.app_error_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS app_error_logs_source_idx
  ON public.app_error_logs (source);
