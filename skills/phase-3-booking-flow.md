# SKILL: Resevia — Phase 3: Booking Flow

## Purpose
Add full booking capability to the agent — slot checking, quoting, confirming, writing to Google Calendar, and handling cancellations and reschedules. Phase 2 must be complete and tested before starting this.

---

## Repo
- **resevia-agent**
- New files go in `/lib/booking/`

---

## What Gets Built in This Phase
1. Service lookup + price/duration calculation
2. Google Calendar freebusy query
3. Slot filtering + formatting
4. Booking confirmation + Calendar event write
5. Supabase booking record save
6. Cancel and reschedule flow

---

## File Structure

```
/lib
  /booking
    services.ts     ← look up services, sum price + duration
    calendar.ts     ← Google Calendar freebusy + event write
    slots.ts        ← filter and format available slots
    confirm.ts      ← write booking to Calendar + Supabase
    cancel.ts       ← cancel or reschedule existing booking
```

---

## Task 1 — Service Lookup (`/lib/booking/services.ts`)

When the customer requests services by name, the agent must:
1. Match requested service names against the salon's service list in Supabase (fuzzy match acceptable)
2. Sum total price across all matched services
3. Sum total duration in minutes across all matched services
4. Return a formatted quote string

```typescript
interface ServiceSummary {
  services: Service[]
  totalPrice: number
  totalDurationMins: number
  quoteText: string  // e.g. "Cut & Blow Dry — 1h 30m — £55 total"
}

export async function resolveServices(
  salonId: string,
  requestedNames: string[]
): Promise<ServiceSummary>
```

### Quote format
```
{service1} + {service2} — {X}h {Y}m — £{total}
```
Examples:
- `Cut & Blow Dry — 1h 30m — £55`
- `Colour + Toner + Blow Dry — 3h — £120`

The agent confirms this quote with the customer before asking for a slot preference.

---

## Task 2 — Google Calendar Freebusy (`/lib/booking/calendar.ts`)

Query the salon's Google Calendar for busy times on a given day, then infer free slots.

```typescript
export async function getFreeBusySlots(
  calendarId: string,
  date: string,          // YYYY-MM-DD
  timezone: string
): Promise<{ start: string; end: string }[]>  // returns busy periods
```

### Using the Google Calendar freebusy API
```
POST https://www.googleapis.com/calendar/v3/freeBusy
{
  "timeMin": "{date}T00:00:00Z",
  "timeMax": "{date}T23:59:59Z",
  "timeZone": "{timezone}",
  "items": [{ "id": "{calendarId}" }]
}
```

Authenticate with the service account JWT (same credentials from Phase 1).

---

## Task 3 — Slot Filtering (`/lib/booking/slots.ts`)

Convert busy periods into available slots, filtered against business hours and service duration.

```typescript
export function getAvailableSlots(
  busyPeriods: { start: string; end: string }[],
  businessHours: { open: string; close: string },  // e.g. "09:00", "18:00"
  durationMins: number,
  date: string,
  timezone: string
): string[]  // returns array of start times, e.g. ["09:00", "11:30", "14:00"]
```

### Rules
- Only return slots within business hours
- Slot must be long enough for the combined service duration + 15 min buffer
- Return a maximum of 3 options
- If no slots available, return empty array — agent tells customer to try another day
- Round to 30-minute increments (09:00, 09:30, 10:00, etc.)

---

## Task 4 — Booking Confirmation (`/lib/booking/confirm.ts`)

Once the customer confirms a slot:

```typescript
export async function confirmBooking(params: {
  salonId: string
  conversationId: string
  customerName: string
  customerPhone: string
  serviceIds: string[]
  totalPrice: number
  startTime: Date
  durationMins: number
  calendarId: string
  timezone: string
}): Promise<{ bookingId: string; googleEventId: string }>
```

### Steps
1. Calculate `endTime = startTime + durationMins`
2. Write event to Google Calendar:
   ```
   POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
   {
     "summary": "{customerName} — {service names}",
     "description": "Booked via Resevia. Total: £{price}",
     "start": { "dateTime": "{startTime}", "timeZone": "{timezone}" },
     "end": { "dateTime": "{endTime}", "timeZone": "{timezone}" }
   }
   ```
3. Save booking record to Supabase `bookings` table
4. Return `bookingId` and `googleEventId`

### Confirmation message to customer
```
Booked! {service names} on {day} at {time}. Total: £{price}. See you then!
```

---

## Task 5 — Cancel and Reschedule (`/lib/booking/cancel.ts`)

### Cancel flow
1. Look up booking by `customer_phone` + `salon_id` where `status = 'confirmed'`
2. If found: delete event from Google Calendar using `googleEventId`
3. Update booking `status = 'cancelled'` in Supabase
4. Confirm cancellation to customer

```typescript
export async function cancelBooking(
  customerPhone: string,
  salonId: string,
  calendarId: string
): Promise<boolean>
```

### Reschedule flow
1. Cancel existing booking (as above)
2. Run slot lookup for new date/time (Task 3)
3. Confirm new booking (Task 4)
4. New booking record created in Supabase — old one marked `rescheduled`

### Edge cases
- Customer has no upcoming booking → agent replies: "I can't find an upcoming booking for your number. Want to make a new one?"
- Multiple bookings → ask customer which one they mean (by date/service)

---

## Booking Conversation Flow (reference)

```
Customer: "I'd like a cut and blow dry Saturday"
  ↓
Agent looks up services → sums £55 / 90 mins
Agent: "That's a Cut & Blow Dry — 1h 30m, £55 total. Saturday works great.
        I have 10:00, 11:30 or 2:00 — which suits you?"
  ↓
Customer: "2pm please"
  ↓
Agent: "Can I take your name?"
Customer: "Sarah"
  ↓
Agent confirms → writes to Calendar → saves to Supabase
Agent: "Booked! Cut & Blow Dry on Saturday at 2:00pm. Total: £55. See you then!"
```

---

## Definition of Done
- [ ] Service lookup correctly sums price + duration for single and multiple services
- [ ] Freebusy query returns correct busy periods from Google Calendar
- [ ] Slot filter returns max 3 valid available slots within business hours
- [ ] Confirmed booking writes event to Google Calendar
- [ ] Booking record saved to Supabase with all fields populated
- [ ] Cancel removes Google Calendar event and updates Supabase status
- [ ] Reschedule creates new booking and marks old as rescheduled
- [ ] All edge cases handled (no slots, no booking found, multiple bookings)
- [ ] End-to-end booking test via SMS passes

Do NOT move to Phase 6 until a full booking — from SMS to Calendar — works end to end.
