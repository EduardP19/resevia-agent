# SKILL: Resevia — Phase 2: Core Agent

## Purpose
Build the SMS agent loop. This is the heart of Resevia — inbound SMS in, AI response out, conversation stored. Everything else builds on top of this.

---

## Repo
- **resevia-agent** (Next.js 14, App Router)
- Phase 1 infrastructure must be complete before starting this phase

---

## What Gets Built in This Phase
1. `/api/sms-webhook` — receives inbound SMS from Twilio
2. Salon + service loader — pulls config from Supabase per request
3. System prompt builder — constructs per-salon AI prompt dynamically
4. AI integration — model-agnostic, swappable
5. Conversation persistence — save full request/response to Supabase
6. SMS reply — sends response back via Twilio
7. Human handoff — detects trigger phrases, flags conversation

---

## File Structure

```
/app
  /api
    /sms-webhook
      route.ts        ← main webhook handler
/lib
  supabase.ts         ← Supabase client setup
  ai.ts               ← AI call wrapper (model-agnostic)
  twilio.ts           ← send SMS helper
  prompt.ts           ← system prompt builder
  handoff.ts          ← handoff detection logic
```

---

## Task 1 — `/api/sms-webhook/route.ts`

This route is called by Twilio on every inbound SMS.

### Logic flow
```
POST /api/sms-webhook
  ↓
Parse: From (customer phone), Body (message text), To (Twilio number)
  ↓
Look up salon by sms_number in Supabase
  ↓
Load or create conversation record for this customer_phone + salon_id
  ↓
Append new customer message to conversation.messages
  ↓
Load all services for this salon from Supabase
  ↓
Build system prompt (see Task 3)
  ↓
Call AI with full message history (see Task 4)
  ↓
Check for handoff trigger (see Task 7)
  ↓
Save updated conversation to Supabase (messages + raw_ai_response + token_usage)
  ↓
Send AI reply via Twilio SMS
  ↓
Return 200 OK (Twilio requires this)
```

### Message format in `conversations.messages` (JSONB array)
```json
[
  { "role": "user", "content": "Hi I'd like to book a cut", "timestamp": "2026-03-26T10:00:00Z" },
  { "role": "assistant", "content": "Hi! I'd love to help...", "timestamp": "2026-03-26T10:00:02Z" }
]
```

---

## Task 2 — Supabase Loader (`/lib/supabase.ts`)

```typescript
// Load salon by their Twilio SMS number
export async function getSalonBySmsNumber(smsNumber: string)

// Load or create conversation for a customer
export async function getOrCreateConversation(salonId: string, customerPhone: string)

// Load all services for a salon
export async function getServicesBySalon(salonId: string)

// Save updated conversation (messages + AI response + tokens)
export async function saveConversation(conversationId: string, update: ConversationUpdate)
```

Use the Supabase service role key for all server-side calls.

---

## Task 3 — System Prompt Builder (`/lib/prompt.ts`)

Build a dynamic system prompt per salon. The prompt must work with any AI model — do not use model-specific formatting.

### Prompt template

```
You are the AI receptionist for {salon_name}.

Your job:
- Book, cancel and reschedule appointments
- Answer questions about services, prices and hours
- Capture customer name and phone number for new enquiries
- If a customer asks for multiple services, sum the total price and duration before quoting
- If you cannot help or the customer is unhappy, say exactly: "Let me get {owner_name} to help you with this"

Business hours: {business_hours}
Location: {location}
Today's date: {current_date}
Current time: {current_time} ({timezone})

Services you offer:
{services_list}

Format for services_list:
- {name} ({category}) — {duration_mins} mins — £{price}

Rules:
- Always confirm the total price and duration before asking to book
- Only offer slots within business hours
- Keep replies short and friendly — this is SMS, not email
- Never make up services or prices not listed above
- Never discuss anything unrelated to the salon

Current conversation:
{message_history}
```

### Key rule
Do not hardcode "Claude" or any model name anywhere in the prompt or codebase. The AI is "the receptionist" — not a named model.

---

## Task 4 — AI Wrapper (`/lib/ai.ts`)

Model-agnostic wrapper. Swap model by changing env vars only — no code changes needed.

```typescript
interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AIResponse {
  reply: string
  raw: object        // full API response — stored in raw_ai_response
  tokens: {
    prompt: number
    completion: number
    total: number
  }
}

export async function callAI(
  systemPrompt: string,
  messages: AIMessage[]
): Promise<AIResponse>
```

### Implementation notes
- Use `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` from env vars
- Call the `/v1/chat/completions` endpoint (OpenAI-compatible — works with Claude via OpenAI SDK, GPT-4o, Gemini via proxy, etc.)
- Always pass `system` as the first message or as a `system` parameter depending on provider
- Store the full raw response object — do not strip it down
- Extract token counts from whatever field the provider uses (`usage.prompt_tokens`, `usage.input_tokens`, etc.) and normalise to `{ prompt, completion, total }`

---

## Task 5 — Twilio SMS Sender (`/lib/twilio.ts`)

```typescript
export async function sendSMS(to: string, body: string): Promise<void>
```

- Use `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` from env
- Max SMS length: 160 chars. If AI response is longer, split into multiple messages or truncate gracefully — do not send a broken mid-sentence message
- Log errors but do not throw — a failed SMS should not crash the webhook

---

## Task 6 — Conversation Save

After every AI response, update the conversation record:
```typescript
{
  messages: [...existingMessages, newUserMessage, newAssistantMessage],
  raw_ai_response: response.raw,
  token_usage: { prompt: x, completion: y, total: z },
  updated_at: new Date().toISOString(),
  error_log: null  // set to error string if something failed
}
```

If anything fails mid-flow (AI call, SMS send, etc.), catch the error, write it to `error_log`, and still return 200 to Twilio — otherwise Twilio will retry and the customer gets duplicate messages.

---

## Task 7 — Human Handoff (`/lib/handoff.ts`)

### Trigger phrases (check AI reply for these)
- "Let me get {owner_name} to help"
- "I'll pass you to the team"
- "someone will be in touch"

### On trigger
1. Set `conversations.state = 'handed_off'` in Supabase
2. Continue — the SMS still gets sent to the customer
3. Salon owner sees flagged conversation in dashboard (Phase 6)

```typescript
export function isHandoff(replyText: string): boolean
```

---

## Definition of Done
- [ ] `/api/sms-webhook` receives Twilio POST and returns 200
- [ ] Salon loaded correctly from Supabase by phone number
- [ ] Conversation created or continued correctly
- [ ] AI called with correct system prompt + full message history
- [ ] Full AI response saved to `raw_ai_response` and `token_usage` in Supabase
- [ ] SMS reply sent via Twilio
- [ ] Handoff detection working and updates conversation state
- [ ] Error logging in place — no silent failures
- [ ] Tested end-to-end with a real SMS to the Twilio number

Do NOT move to Phase 3 until end-to-end SMS test passes.
