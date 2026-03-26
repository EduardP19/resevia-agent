-- Migration to set up agent tracking tables

-- 1. Sessions table
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('voice', 'web', 'whatsapp')),
    client_identifier TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'handed_over')),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. Transcripts table
CREATE TABLE IF NOT EXISTS public.transcripts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('system', 'assistant', 'user')),
    content TEXT NOT NULL
);

-- 3. Business Profiles
CREATE TABLE IF NOT EXISTS public.business_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT NOT NULL,
    opening_hours TEXT,
    tone_of_voice TEXT DEFAULT 'professional and warm',
    services JSONB DEFAULT '[]'::jsonb
);

-- Enable RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

-- Simple Policies (Admin/Service Role only for now)
CREATE POLICY "Service role access" ON public.sessions USING (true);
CREATE POLICY "Service role access" ON public.transcripts USING (true);
CREATE POLICY "Service role access" ON public.business_profiles USING (true);
