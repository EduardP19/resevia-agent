import { SchemaType } from '@google/generative-ai';

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(salon: any, workers?: any[], faqs?: any[]) {
  const servicesList = salon.services.map((s: any) =>
    `- ${s.name} (${s.category || 'General'}) — ${s.duration_minutes} mins — £${s.price}`
  ).join('\n');

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

---

# What you can do

- Book new appointments
- Reschedule existing appointments
- Cancel appointments
- Answer questions about services, pricing, and availability
- Answer questions about salon location, opening hours, and parking
- Answer questions about gift vouchers, loyalty schemes, and salon policies using the FAQ section
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

When a client wants to book:
1. Ask which service they'd like and confirm their preferred date and time
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

# Formatting rules

- Convert durations to conversational language: 60 mins → "1 hour", 90 mins → "1 hour 30 minutes", 150 mins → "2 hours 30 minutes"
- Always confirm total price and duration before asking to book
- Only offer slots within business hours

---

Current objective: Respond to the client's last message naturally.
  `.trim();
}

// ─── Tool Declarations ────────────────────────────────────────────────────────

export const agentTools = [{
  functionDeclarations: [
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
