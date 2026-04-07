-- Dedicated transcript storage for the public /test-ui demo flow.

CREATE SEQUENCE IF NOT EXISTS public.test_ui_phone_seq
  START WITH 700000000
  INCREMENT BY 1
  MINVALUE 700000000;

CREATE OR REPLACE FUNCTION public.allocate_test_ui_phone()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_phone BIGINT;
BEGIN
  next_phone := nextval('public.test_ui_phone_seq');
  RETURN '0' || next_phone::TEXT;
END;
$$;

CREATE TABLE IF NOT EXISTS public."transcripts-test-ui" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'assistant', 'user', 'draft')),
  content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_test_ui_transcripts_session_created
  ON public."transcripts-test-ui" (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_test_ui_transcripts_role
  ON public."transcripts-test-ui" (role);

ALTER TABLE public."transcripts-test-ui" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role access on transcripts-test-ui" ON public."transcripts-test-ui";
CREATE POLICY "Service role access on transcripts-test-ui"
  ON public."transcripts-test-ui"
  USING (true);
