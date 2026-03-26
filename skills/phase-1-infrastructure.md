# SKILL: Resevia — Phase 1: Infrastructure Setup

## Purpose
Set up all foundational infrastructure for the Resevia AI Receptionist. Complete every task in this file before touching any agent or booking logic. This phase is backend/config only — no UI, no code logic.

---

## Repo
- **resevia-agent** on ezwebone-ai GitHub account
- All environment variables in `.env.local` (never committed)

---

## Task 1 — Supabase Project

### Create project
- Go to supabase.com → New project
- Name: `resevia`
- Region: West EU (London)
- Save the project URL and anon key → `.env.local`

### Run this schema in the Supabase SQL editor

```sql
-- Salons
CREATE TABLE salons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sms_number TEXT,
  google_calendar_id TEXT,
  timezone TEXT DEFAULT 'Europe/London',
  business_hours JSONB,
  created_at TIMESTAMP DEFAULT now()
);

-- Services
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  duration_mins INT NOT NULL,
  price NUMERIC NOT NULL,
  description TEXT
);

-- Conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES salons(id),
  customer_phone TEXT NOT NULL,
  channel TEXT DEFAULT 'sms',
  state TEXT DEFAULT 'active', -- active | resolved | handed_off | flagged
  messages JSONB DEFAULT '[]',
  raw_ai_response JSONB,       -- full API response object (model-agnostic)
  token_usage JSONB,           -- { prompt_tokens, completion_tokens, total_tokens }
  error_log TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES salons(id),
  conversation_id UUID REFERENCES conversations(id),
  customer_name TEXT,
  customer_phone TEXT NOT NULL,
  service_ids JSONB,           -- array of service UUIDs
  total_price NUMERIC,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  status TEXT DEFAULT 'confirmed', -- confirmed | cancelled | rescheduled
  google_event_id TEXT,
  reminder_sent BOOLEAN DEFAULT false
);
```

### Notes
- `raw_ai_response` is named generically — not model-specific — works with any AI provider
- `token_usage` stores raw JSON — field names vary by provider, just store whatever the API returns

---

## Task 2 — Twilio Account

### Setup steps
1. Create account at twilio.com (use supp.ezweb@gmail.com)
2. Provision a UK SMS number (+44) in the console
3. Save: Account SID, Auth Token, Phone Number → `.env.local`
4. Set SMS webhook URL to `https://your-vercel-url.vercel.app/api/sms-webhook` (HTTP POST)
   - Leave blank for now — update after first Vercel deploy

### Environment variables
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

---

## Task 3 — Google Calendar API

### Setup steps
1. Go to console.cloud.google.com → New project → name: `resevia`
2. Enable the **Google Calendar API**
3. Create a **Service Account**:
   - Name: `resevia-agent`
   - Role: Editor
   - Download JSON key file → save securely, never commit
4. Extract `client_email` and `private_key` from JSON key → `.env.local`

### Create a test salon calendar
1. Go to calendar.google.com → Create new calendar → name: `Test Salon`
2. Share with service account email — give "Make changes to events" permission
3. Copy calendar ID from calendar settings → use when inserting test salon into Supabase

### Environment variables
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

### Verify it works
Run a quick script to confirm the service account can list events on the test calendar before moving on.

---

## Full `.env.local` template

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Google Calendar
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

# AI — model-agnostic (swap key + model name as needed, works with any provider)
AI_API_KEY=
AI_MODEL=
AI_BASE_URL=
```

---

## Definition of Done
- [ ] Supabase project created, all 4 tables exist with correct schema
- [ ] Twilio account active, UK SMS number provisioned
- [ ] Google Cloud project created, Calendar API enabled, service account created
- [ ] Test salon calendar created and shared with service account
- [ ] All credentials saved in `.env.local`
- [ ] Google Calendar read test passes

Do NOT move to Phase 2 until all items above are ticked.
