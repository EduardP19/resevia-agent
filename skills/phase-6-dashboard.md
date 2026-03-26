# SKILL: Resevia — Phase 6: Dashboard

## Purpose
Build the Resevia operator dashboard. Two roles: salon owner (read-only view of their data) and developer (full debug access across all salons). Phases 1–3 must be complete — this dashboard reads data they produce.

---

## Repo
- **resevia-website** (Next.js 14, App Router)
- Dashboard lives at `/dashboard/*` routes in the same Next.js app as the marketing site

---

## What Gets Built in This Phase
1. Supabase Auth setup — email/password, two roles
2. Login page
3. Next.js middleware — route protection + role-based routing
4. Salon owner dashboard
5. Developer dashboard (extends salon owner view)

---

## File Structure

```
/app
  /login
    page.tsx
  /dashboard
    /salon
      page.tsx              ← overview stats
      /conversations
        page.tsx            ← conversations list
        /[id]
          page.tsx          ← conversation thread + booking detail
      /bookings
        page.tsx
      /services
        page.tsx
    /dev
      page.tsx              ← dev overview (all salons)
      /conversations
        page.tsx
        /[id]
          page.tsx          ← thread + debug panel
      /stats
        page.tsx
/components
  /dashboard
    ConversationThread.tsx
    BookingTable.tsx
    StatsCard.tsx
    DebugPanel.tsx          ← developer only
    SalonSelector.tsx       ← developer only
/middleware.ts              ← auth + role routing
/lib
  auth.ts                   ← Supabase auth helpers
```

---

## Task 1 — Supabase Auth Setup

### Configuration
- Provider: Email/password only
- No self-signup — accounts created manually by Eduard in Supabase dashboard
- Role stored in user metadata: `{ role: 'salon_owner' | 'developer', salon_id: 'uuid' }`
  - `salon_id` only applies to salon_owner role — links them to their Supabase salon record

### Environment variables (already in `.env.local` from Phase 1)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

### To create a user (do this in Supabase dashboard)
1. Authentication → Users → Invite user
2. After creation, edit user metadata to add role + salon_id

---

## Task 2 — Login Page (`/app/login/page.tsx`)

- Simple email + password form
- On success: redirect based on role
  - `salon_owner` → `/dashboard/salon`
  - `developer` → `/dashboard/dev`
- On failure: show inline error ("Incorrect email or password")
- No "forgot password" in V1
- Styling: Tailwind only, match Resevia brand colours

---

## Task 3 — Middleware (`/middleware.ts`)

Runs on every `/dashboard/*` request.

```typescript
// Pseudocode
if (!session) redirect('/login')
if (path.startsWith('/dashboard/dev') && role !== 'developer') redirect('/dashboard/salon')
if (path.startsWith('/dashboard/salon') && role !== 'salon_owner' && role !== 'developer') redirect('/login')
```

Salon owners cannot access `/dashboard/dev/*` routes under any circumstances.

---

## Task 4 — Salon Owner View

### Overview (`/dashboard/salon`)
Four stat cards:
- Bookings today
- Bookings this week
- Open conversations (state = 'active')
- Flagged conversations (state = 'flagged')

Simple number display — no charts in V1.

### Conversations (`/dashboard/salon/conversations`)

Table columns: Customer phone | Last message preview | Status badge | Date

Status badge colours:
- `active` → blue dot
- `resolved` → green dot
- `handed_off` → amber dot
- `flagged` → red dot

Filters: All | Active | Resolved | Flagged

Click row → opens `/dashboard/salon/conversations/[id]`

### Conversation Thread (`/dashboard/salon/conversations/[id]`)
- Chat UI: customer messages on left, agent messages on right
- Each message shows timestamp in salon's local timezone
- "Flag for follow-up" button → sets `state = 'flagged'` via Supabase
- "Mark resolved" button → sets `state = 'resolved'`
- If a booking exists for this conversation, show a booking summary card below the thread:
  - Service(s), date/time, total price, status badge

### Bookings (`/dashboard/salon/bookings`)
Table columns: Customer name | Service(s) | Date & time | Total price | Status badge

Status badge colours:
- `confirmed` → green
- `cancelled` → red
- `rescheduled` → amber

Filter by: date range, status. Read-only in V1.

### Services (`/dashboard/salon/services`)
Table: Name | Category | Duration | Price
Read-only in V1.

---

## Task 5 — Developer View

Everything in salon owner view plus:

### Salon selector (top of every page)
- Dropdown showing all salons from Supabase `salons` table
- Loaded using service role key
- Switching salon reloads the page data for that salon

### Extended conversation thread (`/dashboard/dev/conversations/[id]`)
Below the chat thread, show a collapsible debug panel (`<DebugPanel />`):

**Section 1: AI Response**
- `raw_ai_response` displayed as syntax-highlighted JSON
- Collapsible — collapsed by default

**Section 2: Token Usage**
- Simple table: Prompt tokens | Completion tokens | Total tokens
- Show estimated cost if token rates are known (optional)

**Section 3: Error Log**
- Only shown if `error_log` is not null
- Red background, monospace font

**Section 4: Conversation State**
- Editable dropdown: active | resolved | handed_off | flagged
- "Save" button → writes directly to Supabase
- Uses service role key

### System Stats (`/dashboard/dev/stats`)
All-time numbers across all salons:
- Total conversations
- Total bookings
- Total tokens used (sum of `token_usage.total` across all conversations)
- Error rate (conversations with non-null `error_log` ÷ total conversations, shown as %)

---

## UI Rules
- Desktop-first, but must work at 768px minimum width
- Tailwind only — no UI component libraries
- Empty states: always show a message when a table is empty ("No conversations yet")
- Loading states: skeleton loaders, not spinners
- All timestamps displayed in salon's local timezone (from `salons.timezone`)
- Developer-only UI elements must never render for `salon_owner` role — check role server-side, not client-side

---

## Code Standards
- TypeScript throughout
- Data fetching in Server Components where possible
- Supabase service role key only used server-side — never exposed to client
- Salon owner queries must include `salon_id` filter — never return other salons' data
- No raw SQL — use Supabase JS client query builder

---

## Definition of Done
- [ ] Supabase Auth configured, test user created for each role
- [ ] Login page works, redirects correctly by role
- [ ] Middleware blocks unauthenticated + wrong-role access
- [ ] Salon owner can see their conversations, bookings, services and stats
- [ ] Flag and resolve buttons work and update Supabase
- [ ] Developer can switch between salons
- [ ] Debug panel shows raw AI response, token usage, error log
- [ ] Developer can edit conversation state and save
- [ ] System stats page loads correctly
- [ ] Salon owner cannot access any developer routes
