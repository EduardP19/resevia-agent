-- Store URL assignment param "t" for Sophia sandbox transcript rows.
ALTER TABLE IF EXISTS public."transcripts-sophia-sandbox"
  ADD COLUMN IF NOT EXISTS t TEXT;
