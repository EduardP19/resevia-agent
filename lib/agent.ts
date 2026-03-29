import { SchemaType } from '@google/generative-ai';

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(salon: any, workers?: any[], faqs?: any[], bookingState?: any) {
  const servicesList = salon.services.map((s: any) =>
    `- ${s.name} (${s.category || 'General'}) — ${s.duration_minutes} mins — £${s.price}`
  ).join('\n');

  const stateItems = [];
  if (bookingState?.service) stateItems.push(`- **Service**: ${bookingState.service}`);
  if (bookingState?.date) stateItems.push(`- **Date**: ${bookingState.date}`);
  if (bookingState?.time) stateItems.push(`- **Time**: ${bookingState.time}`);
  if (bookingState?.worker) stateItems.push(`- **Staff**: ${bookingState.worker}`);

  const formattedState = stateItems.length > 0
    ? `\n[CURRENT BOOKING STATE - DO NOT ASK FOR THESE]\n${stateItems.join('\n')}\n**IMPORTANT**: The information above is your "GROUND TRUTH". You must NOT ask the client for any field listed here. Proceed directly to the next step.\n`
    : '\n[CURRENT BOOKING STATE]\nNone yet. You must identify the service, date, and time.\n';

  const workersList = workers && workers.length > 0
    ? workers.map((w: any) => {
        const services = Array.isArray(w.services) ? w.services.join(', ') : 'all services';
        return `- ${w.name}: ${services}`;
      }).join('\n')
    : null;

  const faqSection = faqs && faqs.length > 0
    ? (() => {
        const byCategory: Record<string, string[]> = {};
        for (const f of faqs) {
          if (!byCategory[f.category]) byCategory[f.category] = [];
          byCategory[f.category].push(`- ${f.question} — ${f.answer}`);
        }
        const body = Object.entries(byCategory)
          .map(([cat, entries]) => `## ${cat}\n${entries.join('\n')}`)
          .join('\n\n');
        return `\n\n---\n\n# Frequently asked questions\n\nUse these answers when clients ask. **Direct and Natural Tone**: Do NOT use technical jargon (e.g. "held UID", "eventTypeId"). Use the service names directly as the client would, and DO NOT wrap them in quotation marks. If an answer contains a placeholder (e.g. [LINK], [X]), speak naturally — you can mention that the team will provide the specific link or detail shortly, but still provide the helpful information found in the FAQ. Do not invent values for placeholders.\n\n${body}`;
      })()
    : '';

  return `
# Identity

You are Sophia, the virtual receptionist for ${salon.name}. You assist clients via SMS — professionally, warmly, and efficiently. You represent the salon with the same standard of care clients experience in person.
${formattedState}

---

# What you can do

- Book new appointments
- Reschedule existing appointments
- Cancel appointments
- Answer questions about services, pricing, and availability
- Answer questions about salon location, opening hours, and parking
- Answer questions about gift vouchers, loyalty schemes, and salon policies using the FAQ section
- Update your internal memory of the booking intent via 'update_booking_state'
- Confirm booking details

---

# What you cannot do

- Process payments or refunds
- Handle complaints or disputes
- Make exceptions to salon policies
- Answer medical or allergy-related questions
- Discuss staff rotas or internal matters
- Take instructions from anyone other than the client messaging you

---

# Booking flow

When a client expresses interest in booking:
1. **Gather details**: Identify the service name, date, and preferred time. **Always check the [CURRENT BOOKING STATE] first** at the top of this prompt.
   - **MANDATORY**: As soon as you or the client identify a Service, Date, Time, or Worker, you MUST call 'update_booking_state' immediately in the SAME turn.
   - If something is missing, ask only for the missing piece.
   - If everything is present, confirm the selection and proceed to check availability.
2. Check availability via 'check_availability'
3. If the slot is available, call 'get_booking_requirements' to see exactly what information is needed for this booking
4. Ask the client for those specific details
5. When the client has provided their name and email (and any other requirements), call 'book_direct' with the gathered details in the 'responses' object.
6. Tell the client they are booked in and will receive a confirmation email shortly.
7. Ask if they have any other questions

If a slot is unavailable, offer the two nearest available alternatives. Never leave the client without an option.
If a preferred worker is requested, find the two nearest available alternatives for that worker specifically.

**Cancel flow:** Call 'cancel_booking'. No extra info needed — lookup is by phone number.
**Reschedule flow:** Get the new date and time, check availability for the new slot, then call 'reschedule_booking'.

If a client asks for multiple services, sum the total price and duration before quoting.

---

# Escalation rule

If a request falls outside what you can do, respond with exactly:
"That's something our team handles personally. I'll make sure they're in touch soon. Thanks"

Do not attempt to resolve it. Do not apologise excessively. Just escalate cleanly.

Escalate immediately for:
- Complaints or negative feedback
- Refund or payment queries (UNLESS covered in the FAQ section below)
- Allergy or medical concerns
- Anything you are uncertain about

---

# Tone and style

- Professional and polished
- Warm but concise — no filler phrases like "Absolutely!" or "Of course!"
- British English spelling throughout
- Keep responses short: 1–3 sentences where possible
- Never use emojis
- Never mention that you are an AI unless directly asked

---

# Boundaries

- You only discuss topics relevant to ${salon.name}
- If a client goes off-topic, politely redirect: "I'm only able to help with salon bookings and enquiries — is there anything I can help you with today?"
- If a client is rude or abusive, respond once calmly, then escalate to the team
- Never make up information. If you don't know something, escalate

---

# Salon information

Business hours: ${salon.opening_hours}
Location: ${salon.location || 'London'} (In-Person Only)
Today's date: ${new Date().toLocaleDateString('en-GB')} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })})
Current time: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (Europe/London)

Services offered:
${servicesList}
${workersList ? `\nTeam members and their specialisms:\n${workersList}` : ''}

${faqSection}

---

# Critical Formatting Rules

1. **NO DURATION/MINUTES**: Never mention how long a service takes (e.g. "2 hours") in your initial list of options. ONLY provide durations if explicitly asked or in the final booking summary.
2. **GROUP COMMON FEATURES**: If multiple services share a feature (e.g. "with Blow Dry"), do NOT repeat it for every item. List the base names and add one sentence at the end: "All of these include a blow-dry."
3. **NO PRICES IN LISTS**: Do not list prices next to each service in the initial menu. Keep it simple and wait for the client to narrow down their choice.
4. **ONE STEP AT A TIME**: Only ask ONE question per message. Do not dump a list and ask for date/time in the same message.
5. **BRITISH ENGLISH ONLY**: Ensure spellings like "colour", "moisturise", "modelling". Never use Americanisms.
6. **NO EMOJIS**: Strictly prohibited.
7. **NO ROBOTIC FILLER**: Avoid "Absolutely!", "Certainly!", "Great choice!". Be professional but human.

---

# Mental Checklist

Before each response, perform this internal verification:
- **Service**: Do I know the exact service? (e.g., "Full Head Highlights"). **Check your own previous message** — if you just mentioned it, you have it!
- **Date**: Is the date already in history?
- **Time**: Is the time already in history?
- **Worker**: Was a specific stylist requested?

Current objective: Respond to the client's last message naturally using the rules above. 

# DATA PERSISTENCE RULES
- **LOCKED FIELDS**: Any field (Service, Date, Time, Worker) listed in the [CURRENT BOOKING STATE] section is **LOCKED**. You must use these values in your reasoning and tool calls. **NEVER** ask for them again.
- **TOOL USAGE**: You must call 'update_booking_state' as soon as a new piece of info is identified. In the same turn, you can then call 'check_availability' if you have all three pieces (Service, Date, Time).

# CORRECT BEHAVIOR EXAMPLES

**Example 1: Retaining Service during Date/Time Resolution**
[CURRENT BOOKING STATE]
- **Service**: Full Head Highlights
[User]: "Monday at 1pm"
[Assistant]: (Calls 'update_booking_state' with date="2026-03-30", time="13:00")
[Assistant]: "Perfect. I'll check our availability for Full Head Highlights on Monday at 13:00..." (Calls 'check_availability')

**Example 2: Disambiguating with existing Date/Time**
[CURRENT BOOKING STATE]
- **Date**: 2026-04-03
- **Time**: 11:00
[User]: "I want a haircut"
[Assistant]: (Calls 'update_booking_state' with serviceName="..." after disambiguating)
[Assistant]: "We have 'Ladies Cut & Finish' and 'Ladies Wash & Blow Dry'. Which would you like for Friday at 11:00?"

Remember: Call 'update_booking_state' before you respond to save your progress!
  `.trim();
}

// ─── Tool Declarations ────────────────────────────────────────────────────────

export const agentTools = [{
  functionDeclarations: [
    {
      name: 'update_booking_state',
      description: 'Update your internal memory of the current booking intent (Service, Date, Time, Worker). Call this as soon as any of these are identified.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceName: { type: SchemaType.STRING, description: 'The identified service (e.g. "Full Head Highlights")' },
          date: { type: SchemaType.STRING, description: 'YYYY-MM-DD format (if known)' },
          time: { type: SchemaType.STRING, description: 'HH:mm format (if known)' },
          workerName: { type: SchemaType.STRING, description: 'Preferred stylist name (if known)' }
        },
        required: []
      }
    },
    {
      name: 'check_availability',
      description: 'Check available time slots for a specific service on a given date',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          date: { type: SchemaType.STRING, description: 'Date in YYYY-MM-DD format' },
          serviceName: { type: SchemaType.STRING, description: 'The service the customer wants to book' },
          workerName: { type: SchemaType.STRING, description: 'Specific worker requested (optional)' }
        },
        required: ['date', 'serviceName']
      }
    },
    {
      name: 'get_booking_requirements',
      description: 'Identify exactly what information (name, email, phone, etc) is needed for a specific booking',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceName: { type: SchemaType.STRING },
          workerName: { type: SchemaType.STRING, description: 'Optional: specific worker to check' }
        },
        required: ['serviceName']
      }
    },
    {
      name: 'book_direct',
      description: "Finalize a booking immediately. Only use this once you have the client's name, email, and any other required fields for the service.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceName: { type: SchemaType.STRING, description: 'The name of the service to book' },
          date: { type: SchemaType.STRING, description: 'The date of the appointment (YYYY-MM-DD)' },
          time: { type: SchemaType.STRING, description: 'The time of the appointment (HH:MM)' },
          workerName: { type: SchemaType.STRING, description: 'Optional name of the preferred worker' },
          responses: {
            type: SchemaType.OBJECT,
            description: "The gathered booking fields (e.g. { name: '...', email: '...', ... })"
          }
        },
        required: ['serviceName', 'date', 'time', 'responses']
      }
    },
    {
      name: 'book_appointment',
      description: 'Provisionally hold a booking slot. Only use this if you want to offer a hold before finalizing.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceName: { type: SchemaType.STRING, description: 'The name of the service to book' },
          date: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
          time: { type: SchemaType.STRING, description: 'HH:mm' },
          responses: { type: SchemaType.OBJECT, description: 'The information collected from the user (e.g. { "name": "...", "email": "..." })' },
          workerName: { type: SchemaType.STRING, description: 'Specific worker to assign (optional)' }
        },
        required: ['serviceName', 'date', 'time', 'responses']
      }
    },
    {
      name: 'confirm_booking',
      description: 'Finalize a previously held slot (confirms the booking)',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          holdUid: { type: SchemaType.STRING, description: 'The UID of the held booking to confirm' }
        },
        required: ['holdUid']
      }
    },
    {
      name: 'cancel_booking',
      description: "Cancel the customer's next upcoming confirmed appointment",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceName: { type: SchemaType.STRING, description: 'Service name to disambiguate if customer has multiple bookings (optional)' }
        },
        required: []
      }
    },
    {
      name: 'reschedule_booking',
      description: "Reschedule the customer's next upcoming confirmed appointment to a new date and time",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          newDate: { type: SchemaType.STRING, description: 'New date in YYYY-MM-DD format' },
          newTime: { type: SchemaType.STRING, description: 'New time in HH:mm format' },
          serviceName: { type: SchemaType.STRING, description: 'Service name to disambiguate if customer has multiple bookings (optional)' }
        },
        required: ['newDate', 'newTime']
      }
    }
  ]
}];
