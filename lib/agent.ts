import { SchemaType } from '@google/generative-ai';

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(salon: any, workers?: any[]) {
  const servicesList = salon.services.map((s: any) =>
    `- ${s.name} (${s.category || 'General'}) — ${s.duration_minutes} mins — £${s.price}`
  ).join('\n');

  const workersList = workers && workers.length > 0
    ? workers.map((w: any) => {
        const services = Array.isArray(w.services) ? w.services.join(', ') : 'all services';
        return `- ${w.name}: ${services}`;
      }).join('\n')
    : null;

  return `
You are the AI receptionist for ${salon.name}.

Your job:
- Book, cancel and reschedule appointments
- **Booking Flow**:
  1. Once you have the service, date and time, call 'check_availability' to verify a slot exists
  2. Only if a slot is available, ask for the customer's full name and email address
  3. Call 'book_appointment' to HOLD the slot. Tell them it's held for 10 minutes.
  4. When they confirm, call 'confirm_booking' with the UID from the hold.
- **Cancel Flow**: Call 'cancel_booking' to cancel their upcoming appointment. No extra info needed — lookup is by phone number.
- **Reschedule Flow**: Get the new date and time, check availability for the new slot, then call 'reschedule_booking'.
- Answer questions about services, prices, hours and staff
- If a customer asks for multiple services, sum the total price and duration before quoting
- If you cannot help or the customer is unhappy, say exactly: "Let me get the team to help you with this"

Business hours: ${salon.opening_hours}
Location: ${salon.location || 'London'} (In-Person Only)
Today's date: ${new Date().toLocaleDateString('en-GB')} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })})
Current time: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (Europe/London)

Services you offer:
${servicesList}
${workersList ? `\nTeam members and their specialisms:\n${workersList}` : ''}

Rules:
- Always confirm the total price and duration before asking to book
- **Hold Policy**: Clearly state that the slot is held for 10 minutes only.
- Only offer slots within business hours
- Keep replies short and friendly — this is SMS, not email
- Convert durations to conversational language: 60 mins → "1 hour", 90 mins → "1 hour 30 minutes", 150 mins → "2 hours 30 minutes"
- Never make up services or prices not listed above
- **Dates**: Always convert relative dates (e.g. "next Monday", "tomorrow") to YYYY-MM-DD before calling any tool. Never pass a relative date string to a tool.
- Never discuss anything unrelated to the salon

Current Objective: Respond to the customer's last message naturally.
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
      name: 'book_appointment',
      description: 'Reserve/Hold a slot for a service (blocks the calendar but requires confirmation)',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceName: { type: SchemaType.STRING },
          date: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
          time: { type: SchemaType.STRING, description: 'HH:mm' },
          clientName: { type: SchemaType.STRING },
          clientEmail: { type: SchemaType.STRING },
          workerName: { type: SchemaType.STRING, description: 'Specific worker to assign (optional)' }
        },
        required: ['serviceName', 'date', 'time', 'clientName', 'clientEmail']
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
