# Cal.com API Reference — Resevia Integration

> **Purpose**: Battle-tested reference for the Cal.com v2 API as used by Resevia.
> Every endpoint, payload, and gotcha below was verified on **2026-03-26**.

---

## 1. Authentication & Base URL

| Setting | Value |
|---------|-------|
| **Base URL** | `https://api.cal.eu/v2` |
| **Header** | `Authorization: Bearer <CAL_COM_API_KEY>` |
| **API Version Header** | `cal-api-version: 2024-08-13` |

> [!CAUTION]
> Eduard's account is on **cal.eu** (EU region). Using `api.cal.com` will return `401 Unauthorized`.

---

## 2. Event Types

### List Event Types
```
GET /event-types
```
Returns all event types for the authenticated user. Key fields:
- `id` — The numeric ID needed for bookings (e.g., `237850`)
- `slug` — URL slug (e.g., `15min`)
- `length` — Default duration in minutes

### Get Single Event Type
```
GET /event-types/{id}
```

### Update Event Type (Enable Multi-Duration)
```
PATCH /event-types/{id}
```
> [!IMPORTANT]
> To use `lengthInMinutes` per booking, the event type **must** have multiple durations enabled.
> Set this via the Cal.com UI: Event Type → Basics → "Allow multiple durations" toggle → add durations.
> The v2 PATCH endpoint for event types may not work with all API versions. **Use the UI for this.**

**Current Portal Config:**
- **Event Type ID**: `237850`
- **Title**: "Resevia Booking Portal"
- **Slug**: `service-booking`
- **Booking URL**: `https://cal.eu/eduard.resevia/service-booking`

**Hold Event (No Emails):**
- **Event Type ID**: `238175`
- **Title**: "Resevia Booking Portal"
- **Slug**: `hold-booking`
- **Booking URL**: `https://cal.eu/eduard.resevia/hold-booking`
- **Purpose**: Temporary slot hold during conversation — no client emails sent

---

## 3. Creating Bookings (Dynamic Injection)

### Endpoint
```
POST /bookings
```

### Confirmed Working Payload
```json
{
  "eventTypeId": 237850,
  "start": "2026-03-30T13:00:00Z",
  "lengthInMinutes": 30,
  "attendee": {
    "name": "Client Name",
    "email": "client@example.com",
    "timeZone": "Europe/London",
    "language": "en"
  },
  "metadata": {
    "service": "Blow Dry",
    "price": "£75"
  }
}
```

### Critical Rules

> [!CAUTION]
> **DST Handling**: The `start` field MUST be in **UTC** (with `Z` suffix).
> If the user says "14:00" and the date is in BST (UTC+1), send `13:00:00Z`.
> Use this conversion in TypeScript:
> ```typescript
> const localDate = new Date(`${date}T${time}:00`);
> const utcMs = localDate.getTime();
> const londonDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'Europe/London' }));
> const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
> const offsetMs = londonDate.getTime() - utcDate.getTime();
> const utcStart = new Date(utcMs - offsetMs);
> const startISO = utcStart.toISOString(); // Correct UTC time
> ```

> [!WARNING]
> **API version `2024-08-13`**: `timeZone` and `language` go INSIDE `attendee`, NOT at the top level.
> Putting them at the top level returns: `"property timeZone should not exist"`.

> [!WARNING]
> **`metadata` is required** — even if empty, send `"metadata": {}`. Omitting it causes a `500 Internal Server Error`.

> [!IMPORTANT]
> **`lengthInMinutes`** only works if the event type has "Allow multiple durations" enabled.
> Without it: `"Can't specify 'lengthInMinutes' because event type does not have multiple possible lengths"`.

### Response (Success)
Key fields from `data`:
- `id` — Numeric booking ID
- `uid` — String UID (needed for cancel/reschedule)
- `status` — `"accepted"`
- `start` / `end` — UTC timestamps
- `duration` — Minutes
- `metadata` — Your custom metadata echoed back

---

## 4. Cancelling Bookings

### Endpoint
```
POST /bookings/{uid}/cancel
```

> [!CAUTION]
> Use the **`uid`** (string like `qvoPJQLUZsGBRkhn1x2wrM`), NOT the numeric `id`.
> Using the numeric ID returns `404 Not Found`.

### Payload
```json
{
  "cancellationReason": "Reason for cancellation"
}
```

> [!WARNING]
> `cancellationReason` is **required**. Sending `{}` returns `"Cancellation reason is required"`.

---

## 5. Rescheduling Bookings

### Reschedule (Change Time Only)
```
POST /bookings/{uid}/reschedule
```
This only changes the **start time**. You cannot change `lengthInMinutes` via reschedule.

### Change Duration (Cancel + Rebook)

> [!IMPORTANT]
> Cal.com v2 does **NOT** support updating the duration of an existing booking.
> To change duration: **cancel the old booking → create a new one** with the new `lengthInMinutes`.
> This is instant and seamless — two API calls back-to-back.

---

## 6. Availability / Slots

### Endpoint
```
GET /slots/available
```
> [!NOTE]
> The path is `/slots/available`, NOT `/slots`. Using `/slots` returns `404`.

### Query Parameters
```
?startTime=2026-03-30T00:00:00Z&endTime=2026-03-30T23:59:59Z&eventTypeId=237850
```

---

## 6. Error Quick Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Invalid API Key` | Wrong base URL | Use `api.cal.eu` not `api.cal.com` |
| `timeZone should not exist` | `timeZone` at top level | Move inside `attendee` |
| `metadata must be an object` | `metadata` omitted | Always send `"metadata": {}` |
| `Can't specify lengthInMinutes` | Single-duration event | Enable "Allow multiple durations" in UI |
| `lengthInMinutes is not one of possible lengths` | Duration not in allowed list | Add duration in Cal.com UI |
| `Booking with uid=NUMERIC not found` | Used numeric ID for cancel | Use string `uid` instead |
| `Cancellation reason is required` | Empty cancel body | Include `cancellationReason` |

---

## 7. Resevia Architecture

```
User SMS → AI Agent → Supabase (service lookup) → Cal.com v2 (injection)
                         ↓
                  duration: 30 min
                  price: £75
                         ↓
              Cal.com POST /bookings
              lengthInMinutes: 30
```

**One generic event type. All services injected dynamically. Zero Cal.com maintenance.**
