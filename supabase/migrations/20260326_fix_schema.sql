-- Add salon_id column to sessions for proper multi-salon isolation
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS salon_id UUID REFERENCES public.business_profiles(id);

-- Add twilio_number to business_profiles for multi-salon SMS routing
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS twilio_number TEXT;

-- Fix the status constraint to match what the code uses
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_status_check;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('active', 'completed', 'handed_over'));

-- Create bookings table (hold/confirm flow + ghosting tracking)
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  cal_booking_uid TEXT NOT NULL,
  cal_booking_id BIGINT,
  salon_id UUID REFERENCES public.business_profiles(id),
  customer_phone TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  service_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  start_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'held' CHECK (status IN ('held', 'confirmed', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role access" ON public.bookings USING (true);

-- Index for ghosting cron query performance
CREATE INDEX IF NOT EXISTS bookings_status_expires_idx ON public.bookings (status, expires_at);
CREATE INDEX IF NOT EXISTS sessions_salon_phone_idx ON public.sessions (salon_id, client_identifier);
