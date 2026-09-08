#!/usr/bin/env node
import 'dotenv/config';

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const [rawKey, inlineValue] = arg.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function usage() {
  console.log(`Usage:
  npm run provision:phone -- --salon-id <uuid> --phone <+E164> [options]

Options:
  --base-url <url>                    App URL to call. Defaults to APP_BASE_URL or http://localhost:3001.
  --whatsapp-number <+E164>           Use a different WhatsApp sender number.
  --no-whatsapp                       Set whatsapp_number to null.
  --no-db                             Do not update business_profiles.
  --no-twilio                         Do not configure Twilio SMS/voice webhooks.
  --incoming-phone-number-sid <sid>   Use a known Twilio IncomingPhoneNumber SID.
  --twilio-account-sid <sid>          Twilio account/subaccount SID for this number.
  --twilio-auth-token <token>         Twilio auth token for this number.
  --persist-twilio-credentials        Store the passed Twilio credentials on the salon.
`);
}

function pick(args, key) {
  return args[key] === true ? undefined : args[key];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const salonId = pick(args, 'salonId');
  const phoneNumber = pick(args, 'phone');
  const secret = process.env.OPERATOR_PROVISIONING_SECRET;

  if (!salonId || !phoneNumber || !secret) {
    usage();
    if (!secret) {
      console.error('Missing OPERATOR_PROVISIONING_SECRET in the environment.');
    }
    process.exit(1);
  }

  const baseUrl = pick(args, 'baseUrl') || process.env.APP_BASE_URL || 'http://localhost:3001';
  const url = new URL('/api/internal/provision-phone', baseUrl);
  const enableWhatsApp = args.noWhatsapp ? false : undefined;
  const whatsappNumber = args.noWhatsapp ? null : pick(args, 'whatsappNumber');

  const body = {
    salonId,
    phoneNumber,
    ...(whatsappNumber !== undefined ? { whatsappNumber } : {}),
    ...(enableWhatsApp !== undefined ? { enableWhatsApp } : {}),
    ...(args.noDb ? { updateDatabase: false } : {}),
    ...(args.noTwilio ? { configureTwilio: false } : {}),
    ...(pick(args, 'incomingPhoneNumberSid')
      ? { twilioIncomingPhoneNumberSid: pick(args, 'incomingPhoneNumberSid') }
      : {}),
    ...(pick(args, 'twilioAccountSid') ? { twilioAccountSid: pick(args, 'twilioAccountSid') } : {}),
    ...(pick(args, 'twilioAuthToken') ? { twilioAuthToken: pick(args, 'twilioAuthToken') } : {}),
    ...(args.persistTwilioCredentials ? { persistTwilioCredentials: true } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    console.error(payload?.error || `Provisioning failed with HTTP ${res.status}.`);
    if (payload?.details) console.error(JSON.stringify(payload.details, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
