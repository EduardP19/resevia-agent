import { supabase } from '@/lib/supabase';
import { normalizeClientPhone, type ClientProfile } from '@/lib/client-profile';
import { safeLog } from '@/lib/logger';
import { z } from 'zod';

const contactUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(254).optional(),
}).refine(value => Object.values(value).some(Boolean));

export async function updateClientContact(salonId: string, rawPhone: string, fields: unknown) {
  const parsed = contactUpdateSchema.safeParse(fields);
  const phone = normalizeClientPhone(rawPhone);
  if (!parsed.success || !phone) throw new Error('Valid contact details and caller phone are required.');
  const { firstName, lastName, email } = parsed.data;
  const { data, error } = await supabase.from('clients').upsert({
    salon_id: salonId, phone,
    ...(firstName ? { first_name: firstName } : {}),
    ...(lastName ? { last_name: lastName } : {}),
    ...(email ? { email: email.toLowerCase() } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'salon_id,phone' }).select('*').single();
  if (error) throw error;
  return data as ClientProfile;
}

export async function getClientByPhone(salonId: string, rawPhone: string): Promise<ClientProfile | null> {
  const phone = normalizeClientPhone(rawPhone);
  if (!phone) return null;
  const { data, error } = await supabase.from('clients').select('*')
    .eq('salon_id', salonId).eq('phone', phone).maybeSingle();
  if (error) {
    safeLog({ type: 'error', level: 'error', category: 'system', event: 'client_lookup_failed',
      tenant_id: salonId, error: error.message });
    // Recognition must not interrupt a call if the database is temporarily unavailable.
    return null;
  }
  return data as ClientProfile | null;
}

/**
 * Records what an actual send attempt told us about this number's WhatsApp
 * reachability, so the next outbound message can skip a WhatsApp attempt that
 * is only going to fall back to SMS again.
 *
 * Never throws: this is bookkeeping attached to a message that has already been
 * delivered, and must not turn a successful send into a failed tool call.
 */
export async function recordClientWhatsAppAvailability(
  salonId: string,
  rawPhone: string,
  available: boolean
): Promise<void> {
  const phone = normalizeClientPhone(rawPhone);
  if (!salonId || !phone) return;
  const { error } = await supabase
    .from('clients')
    .update({
      whatsapp_available: available,
      whatsapp_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('salon_id', salonId)
    .eq('phone', phone);
  if (error) {
    safeLog({
      type: 'error', level: 'warning', category: 'system', event: 'client_whatsapp_flag_failed',
      tenant_id: salonId, error: error.message,
    });
  }
}
