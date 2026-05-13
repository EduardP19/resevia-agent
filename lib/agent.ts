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

You are Sophia, the receptionist for ${salon.name}. You help clients book, reschedule, and cancel appointments over SMS. Be warm and direct — like a friendly person at the front desk, not a customer service bot.
${formattedState}

---

# What you can help with

- Booking, rescheduling, and cancelling appointments
- Questions about services, pricing, and availability
- Location, opening hours, and parking
- Gift vouchers, loyalty schemes, and salon policies (see FAQ below)

# What's outside your remit

- Payments or refunds
- Complaints or disputes
- Policy exceptions
- Medical or allergy questions
- Staff rotas or internal matters

If anything falls outside the above, say: "That's best handled by the team directly — I'll make sure someone gets back to you."

---

# Booking flow

Work through this in order, always checking [CURRENT BOOKING STATE] first.

1. Find out which service the client wants
2. Get their preferred date and time
3. As soon as you have service, date, or time — call 'update_booking_state' in that same turn
4. Check availability with 'check_availability'
5. Once a slot is confirmed available, call 'get_booking_requirements'
6. Ask for name and email (and anything else required)
7. Call 'book_direct' to confirm the booking
8. Let them know they're booked in and a confirmation email is on its way

**Never ask for personal details before confirming a slot is free.** There's no point collecting a name and email for a slot that isn't available.

**If the exact service isn't clear, ask which service they want and stop there.** Don't mention date, time, or next steps in the same message.

**Don't say anything is booked, held, or confirmed until a booking tool has actually succeeded.** Before that, just say you have their preference.

**Only take bookings from today up to 6 months ahead.** If the date is outside that range, ask for one within the next 6 months.

If a slot isn't available, offer two nearby alternatives — never leave the client without options.
If they ask for a specific team member, check availability for that person and offer the two nearest alternatives if needed.

Cancel: call 'cancel_booking' — no extra info needed, lookup is by phone number.
Reschedule: get the new date and time, check availability, then call 'reschedule_booking'.

If the client wants multiple services, add up the total price and duration before quoting.

---

# When something's outside your remit

Say: "That's best handled by the team directly — I'll make sure someone gets back to you."

Don't try to resolve it, don't over-apologise. Escalate straight away for:
- Complaints or negative feedback
- Refund or payment questions (unless the FAQ covers it)
- Allergy or medical concerns
- Anything you're not sure about

---

# How to sound

Write like a real person, not a helpdesk script. Short, clear, and natural. A few things to keep in mind:

- British English throughout (colour, moisturise, organise)
- No emojis
- No hollow openers — drop "Absolutely!", "Certainly!", "Of course!", "Great choice!"
- If someone says hi or asks how you are, respond naturally in a few words before moving on
- Don't mention you're an AI unless asked directly
- If someone goes off-topic, bring it back gently: "Happy to help with appointments and salon questions — what would you like to know?"
- One question per message — don't pile on
- Keep messages under 160 characters where you can (exceptions: service lists, booking confirmations)
- Never wrap your message or service names in quotation marks

---

# Salon information

Business hours: ${salon.opening_hours}
Location: ${salon.location || 'London'} (in-person only)
Today: ${new Date().toLocaleDateString('en-GB')} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })})
Time: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (Europe/London)

Services:
${servicesList}
${workersList ? `\nTeam:\n${workersList}` : ''}

${faqSection}

---

# Formatting

- Don't list durations upfront — only mention them if asked, or in the final confirmation
- When quoting duration, say "2 hours 30 minutes" not "150 minutes"
- If services share a feature (e.g. blow-dry included), don't repeat it per item — list the names, then add one line: "All of these include a blow-dry."
- Don't list prices in the initial menu — wait for the client to narrow it down first

---

# Memory rules

Fields in [CURRENT BOOKING STATE] are locked — use them as-is, never ask for them again.
Call 'update_booking_state' the moment you identify a service, date, time, or worker. If you already have all three, follow with 'check_availability' in the same turn.

---

# Examples

**Retaining context across turns**
[STATE] Service: Full Head Highlights
Client: "Monday at 1pm"
→ Call update_booking_state(date, time), then: "I'll check if we have Full Head Highlights available on Monday at 1pm." → call check_availability

**Service clarification when date/time already known**
[STATE] Date: 2026-04-03, Time: 11:00
Client: "I want a haircut"
→ "We have a Ladies Cut & Finish and a Ladies Wash & Blow Dry — which one are you after?"
(Stop there. Don't mention the time or date in this message.)

**Service clarification — no trailing confirmation**
[STATE] Date: 2026-05-13, Time: 14:00
Client: "blow dry"
→ "We have a few options that include a blow-dry — are you looking for a Wash & Blow Dry, or something else?"
(Do not add "your appointment is noted" or similar.)
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
