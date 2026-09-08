import twilio from 'twilio';
import { encrypt, decrypt } from '@/lib/crypto';
import { supabase } from '@/lib/supabase';

type BusinessProfileTwilioFields = {
  id: string;
  name: string | null;
  twilio_number: string | null;
  whatsapp_number: string | null;
  twilio_account_sid: string | null;
  twilio_auth_token: string | null;
};

type ProvisionPhoneParams = {
  salonId: string;
  phoneNumber: string;
  whatsappNumber?: string | null;
  enableWhatsApp?: boolean;
  updateDatabase?: boolean;
  configureTwilio?: boolean;
  baseUrl: string;
  twilioIncomingPhoneNumberSid?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  persistTwilioCredentials?: boolean;
};

type TwilioCredentialResolution = {
  accountSid: string;
  authToken: string;
  source: 'request' | 'tenant' | 'global';
};

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizeProvisionedPhoneNumber(value: string, fieldName = 'phoneNumber') {
  const trimmed = (value || '').trim();
  if (!trimmed) throw new Error(`${fieldName} is required.`);

  const plusIndex = trimmed.indexOf('+');
  const normalized =
    plusIndex >= 0
      ? `+${trimmed.slice(plusIndex + 1).replace(/\D/g, '')}`
      : `+${trimmed.replace(/\D/g, '')}`;

  if (!E164_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be an E.164 number, for example +447886083430.`);
  }

  return normalized;
}

function normalizeBaseUrl(value: string) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('baseUrl must be an http(s) URL.');
  }
  return parsed.origin;
}

function webhookUrls(baseUrl: string) {
  const origin = normalizeBaseUrl(baseUrl);
  return {
    sms: new URL('/api/sms-webhook', origin).toString(),
    voice: new URL('/api/twilio/voice', origin).toString(),
    whatsapp: new URL('/api/whatsapp-webhook', origin).toString(),
    status: process.env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/twilio/status', origin).toString(),
  };
}

function readStoredTwilioAuthToken(value: string) {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

function resolveTwilioCredentials(
  salon: BusinessProfileTwilioFields,
  params: Pick<ProvisionPhoneParams, 'twilioAccountSid' | 'twilioAuthToken'>
): TwilioCredentialResolution | null {
  if (params.twilioAccountSid && params.twilioAuthToken) {
    return {
      accountSid: params.twilioAccountSid,
      authToken: params.twilioAuthToken,
      source: 'request',
    };
  }

  if (salon.twilio_account_sid && salon.twilio_auth_token) {
    return {
      accountSid: salon.twilio_account_sid,
      authToken: readStoredTwilioAuthToken(salon.twilio_auth_token),
      source: 'tenant',
    };
  }

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      source: 'global',
    };
  }

  return null;
}

async function getIncomingPhoneNumber(
  client: ReturnType<typeof twilio>,
  phoneNumber: string,
  incomingPhoneNumberSid?: string
) {
  if (incomingPhoneNumberSid) {
    const incoming = await client.incomingPhoneNumbers(incomingPhoneNumberSid).fetch();
    const fetchedPhone = normalizeProvisionedPhoneNumber(incoming.phoneNumber, 'incomingPhoneNumber.phoneNumber');
    if (fetchedPhone !== phoneNumber) {
      throw new Error(
        `Twilio IncomingPhoneNumber SID ${incomingPhoneNumberSid} belongs to ${fetchedPhone}, not ${phoneNumber}.`
      );
    }
    return incoming;
  }

  const matches = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 20 });
  return matches.find((item: any) => item.phoneNumber === phoneNumber) || null;
}

export async function provisionSalonPhoneNumber(params: ProvisionPhoneParams) {
  const phoneNumber = normalizeProvisionedPhoneNumber(params.phoneNumber);
  const enableWhatsApp = params.enableWhatsApp !== false;
  const whatsappNumber =
    params.whatsappNumber === null
      ? null
      : params.whatsappNumber
        ? normalizeProvisionedPhoneNumber(params.whatsappNumber, 'whatsappNumber')
        : enableWhatsApp
          ? phoneNumber
          : null;
  const urls = webhookUrls(params.baseUrl);
  const updateDatabase = params.updateDatabase !== false;
  const configureTwilio = params.configureTwilio !== false;

  const { data: salon, error: salonError } = await supabase
    .from('business_profiles')
    .select('id, name, twilio_number, whatsapp_number, twilio_account_sid, twilio_auth_token')
    .eq('id', params.salonId)
    .single();

  if (salonError || !salon) {
    throw new Error(`Salon ${params.salonId} was not found in business_profiles.`);
  }

  const previous = {
    twilio_number: salon.twilio_number,
    whatsapp_number: salon.whatsapp_number,
    twilio_account_sid: salon.twilio_account_sid ? 'set' : 'unset',
  };

  let updatedSalon: BusinessProfileTwilioFields | null = null;
  if (updateDatabase) {
    const updatePayload: Record<string, string | null> = {
      twilio_number: phoneNumber,
      whatsapp_number: whatsappNumber,
    };

    if (params.persistTwilioCredentials) {
      if (!params.twilioAccountSid || !params.twilioAuthToken) {
        throw new Error('persistTwilioCredentials requires twilioAccountSid and twilioAuthToken.');
      }
      updatePayload.twilio_account_sid = params.twilioAccountSid;
      updatePayload.twilio_auth_token = encrypt(params.twilioAuthToken);
    }

    const { data, error } = await supabase
      .from('business_profiles')
      .update(updatePayload)
      .eq('id', params.salonId)
      .select('id, name, twilio_number, whatsapp_number, twilio_account_sid, twilio_auth_token')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to update business_profiles.');
    }
    updatedSalon = data;
  }

  const effectiveSalon = updatedSalon || salon;
  const warnings: string[] = [
    'WhatsApp sender setup is not fully automated here. Confirm the Twilio WhatsApp sender uses the WhatsApp webhook URL and that the template is approved for the sender.',
    'Outbound status callbacks are set per message by the app; no per-number status webhook is needed.',
  ];

  let twilioNumber:
    | {
        configured: true;
        credentialSource: TwilioCredentialResolution['source'];
        sid: string;
        phoneNumber: string;
        smsUrl: string;
        voiceUrl: string;
        smsApplicationSid?: string | null;
        voiceApplicationSid?: string | null;
      }
    | { configured: false; reason: string };

  if (configureTwilio) {
    const credentials = resolveTwilioCredentials(effectiveSalon, params);
    if (!credentials) {
      throw new Error(
        'Twilio credentials are missing. Set tenant Twilio credentials, global Twilio env vars, or pass twilioAccountSid/twilioAuthToken.'
      );
    }

    const client = twilio(credentials.accountSid, credentials.authToken);
    const incomingNumber = await getIncomingPhoneNumber(client, phoneNumber, params.twilioIncomingPhoneNumberSid);
    if (!incomingNumber) {
      throw new Error(`Could not find ${phoneNumber} in the resolved Twilio account.`);
    }

    const updated = await client.incomingPhoneNumbers(incomingNumber.sid).update({
      smsUrl: urls.sms,
      smsMethod: 'POST',
      voiceUrl: urls.voice,
      voiceMethod: 'POST',
    });

    if (updated.smsApplicationSid) {
      warnings.push(
        `Twilio number ${phoneNumber} has smsApplicationSid=${updated.smsApplicationSid}; Twilio may ignore smsUrl until that application is cleared or updated.`
      );
    }
    if (updated.voiceApplicationSid) {
      warnings.push(
        `Twilio number ${phoneNumber} has voiceApplicationSid=${updated.voiceApplicationSid}; Twilio may ignore voiceUrl until that application is cleared or updated.`
      );
    }

    twilioNumber = {
      configured: true,
      credentialSource: credentials.source,
      sid: updated.sid,
      phoneNumber: updated.phoneNumber,
      smsUrl: updated.smsUrl,
      voiceUrl: updated.voiceUrl,
      smsApplicationSid: updated.smsApplicationSid || null,
      voiceApplicationSid: updated.voiceApplicationSid || null,
    };
  } else {
    twilioNumber = { configured: false, reason: 'configureTwilio=false' };
  }

  return {
    salon: {
      id: effectiveSalon.id,
      name: effectiveSalon.name,
    },
    previous,
    current: {
      twilio_number: phoneNumber,
      whatsapp_number: whatsappNumber,
      database_updated: updateDatabase,
    },
    webhooks: urls,
    twilioNumber,
    warnings,
    nextChecks: [
      `Send an SMS to ${phoneNumber}; it should create or continue an SMS session for this salon.`,
      `Call ${phoneNumber}; it should reject the call and send the missed-call WhatsApp/SMS follow-up.`,
      whatsappNumber
        ? `Send a WhatsApp message to ${whatsappNumber}; it should hit /api/whatsapp-webhook and continue on channel=whatsapp.`
        : 'WhatsApp is disabled for this salon; dashboard initiation will use SMS only.',
    ],
  };
}
