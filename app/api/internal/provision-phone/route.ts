import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { provisionSalonPhoneNumber } from '@/lib/phone-provisioning';
import { safeLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ProvisionPhoneSchema = z.object({
  salonId: z.string().uuid(),
  phoneNumber: z.string().min(1),
  whatsappNumber: z.string().min(1).nullable().optional(),
  enableWhatsApp: z.boolean().optional(),
  updateDatabase: z.boolean().optional(),
  configureTwilio: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  twilioIncomingPhoneNumberSid: z.string().min(1).optional(),
  twilioAccountSid: z.string().min(1).optional(),
  twilioAuthToken: z.string().min(1).optional(),
  persistTwilioCredentials: z.boolean().optional(),
});

function unauthorized(message: string, status = 401) {
  return NextResponse.json({ error: message }, { status });
}

function requireProvisioningSecret(req: NextRequest) {
  const expected = process.env.OPERATOR_PROVISIONING_SECRET;
  if (!expected) {
    return unauthorized('OPERATOR_PROVISIONING_SECRET is not configured.', 503);
  }

  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || null;
  const headerSecret = req.headers.get('x-provisioning-secret');
  const provided = bearer || headerSecret;

  if (provided !== expected) {
    return unauthorized('Invalid provisioning secret.');
  }

  return null;
}

export async function POST(req: NextRequest) {
  const authError = requireProvisioningSecret(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const parsed = ProvisionPhoneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid provisioning request.', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const data = parsed.data;
    const result = await provisionSalonPhoneNumber({
      salonId: data.salonId,
      phoneNumber: data.phoneNumber,
      whatsappNumber: data.whatsappNumber,
      enableWhatsApp: data.enableWhatsApp,
      updateDatabase: data.updateDatabase,
      configureTwilio: data.configureTwilio,
      baseUrl: data.baseUrl || req.nextUrl.origin,
      twilioIncomingPhoneNumberSid: data.twilioIncomingPhoneNumberSid,
      twilioAccountSid: data.twilioAccountSid,
      twilioAuthToken: data.twilioAuthToken,
      persistTwilioCredentials: data.persistTwilioCredentials,
    });

    safeLog({
      type: 'audit',
      level: 'info',
      category: 'dashboard',
      event: 'phone_number_provisioned',
      tenant_id: result.salon.id,
      phone_number: result.current.twilio_number,
      whatsapp_number: result.current.whatsapp_number,
      database_updated: result.current.database_updated,
      twilio_configured: result.twilioNumber.configured,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'phone_number_provisioning_failed',
      tenant_id: parsed.data.salonId,
      error: error?.message || String(error),
      stack: error?.stack,
    });

    return NextResponse.json(
      { error: error?.message || 'Phone provisioning failed.' },
      { status: 500 }
    );
  }
}
