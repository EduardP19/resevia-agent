# Phone Number Onboarding

This flow provisions a salon's SMS/voice number in one repeatable step:

- updates `business_profiles.twilio_number`
- updates `business_profiles.whatsapp_number` unless WhatsApp is disabled
- configures the Twilio IncomingPhoneNumber SMS webhook
- configures the Twilio IncomingPhoneNumber voice webhook for missed-call follow-up
- returns the WhatsApp webhook URL and smoke-test checklist

## Prerequisites

- `OPERATOR_PROVISIONING_SECRET` is set on the app.
- The app has Twilio credentials globally, or the salon has `twilio_account_sid` / encrypted `twilio_auth_token`, or you pass Twilio credentials for this run.
- The Twilio number is already purchased/hosted in the account whose credentials are being used.

## One-Command Provisioning

Run against production:

```bash
APP_BASE_URL=https://app.resevia.co.uk \
npm run provision:phone -- \
  --salon-id 00000000-0000-0000-0000-000000000000 \
  --phone +447886083430
```

If the new number is in a tenant-specific Twilio subaccount:

```bash
APP_BASE_URL=https://app.resevia.co.uk \
npm run provision:phone -- \
  --salon-id 00000000-0000-0000-0000-000000000000 \
  --phone +447886083430 \
  --twilio-account-sid ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --twilio-auth-token xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --persist-twilio-credentials
```

Useful options:

- `--incoming-phone-number-sid PN...` uses a known Twilio number SID instead of searching by phone number.
- `--whatsapp-number +44...` sets a different WhatsApp sender.
- `--no-whatsapp` sets `business_profiles.whatsapp_number` to null.
- `--no-twilio` updates Supabase only.
- `--no-db` configures Twilio only.

## Direct API

The CLI calls:

```bash
curl -X POST https://app.resevia.co.uk/api/internal/provision-phone \
  -H "Authorization: Bearer $OPERATOR_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "salonId": "00000000-0000-0000-0000-000000000000",
    "phoneNumber": "+447886083430"
  }'
```

## WhatsApp

The endpoint does not fully automate Twilio/Meta WhatsApp sender approval. After provisioning, confirm in Twilio that the WhatsApp sender uses:

```text
https://app.resevia.co.uk/api/whatsapp-webhook
```

Also confirm the approved Content template is usable for that sender. If a salon uses a different template, set `business_profiles.whatsapp_template_sid`.

## Smoke Test

After provisioning:

1. Send an SMS to the new number and confirm a salon session is created/continued.
2. Call the new number and confirm the missed-call follow-up is sent.
3. Send a WhatsApp message to the sender, if enabled, and confirm the session channel is `whatsapp`.
4. Send an outbound dashboard initiation and confirm the `costs` row receives delivery status updates through `/api/twilio/status`.

Status callbacks do not need a per-number webhook change: the app attaches `/api/twilio/status` to outbound sends at send time.
